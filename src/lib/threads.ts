import { fork, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import net from 'net';
import crypto from 'crypto';
import path from 'path';

import { Input, TurnOptions } from '@openai/codex-sdk';

import { appDir, threadsDir } from './paths.js';
import { PubSub } from './PubSub.js';
import { createIpcServer } from './ipc-server.js';
import { getOrCreateThread, getThreadEvents, recordThreadEvent, setCodexThreadId, ThreadRecord } from './database.js';
import { randomStr } from './utils.js';
import { SharedThreadEvent } from './thread-events.js';

export const AGENTS_GID = parseInt(process.env.AGENTS_GID ?? "");
if (isNaN(AGENTS_GID)) {
  console.error("AGENTS_GID environment variable is not set or is not a valid number.");
  process.exit(1);
}

const { CODEX_HOME, MCP_SOCKETS_DIR } = process.env;
if (!CODEX_HOME) {
  console.error("CODEX_HOME environment variable is not set.");
  process.exit(1);
}
if (!MCP_SOCKETS_DIR) {
  console.error("MCP_SOCKETS_DIR environment variable is not set.");
  process.exit(1);
}

type WithoutRecordFields<T> = T extends unknown ? Omit<T, "id" | "timestamp"> : never;
type UnrecordedSharedThreadEvent = WithoutRecordFields<SharedThreadEvent>;

class Thread extends PubSub<SharedThreadEvent> {
  id: number;
  stringId: string;
  threadDir: string;
  workspaceDir: string;
  private codexDir: string;
  private _uid: number;
  private _mcpSocketPath: string;
  private _childProcess?: Promise<ChildProcess>;

  constructor(record: ThreadRecord) {
    super();
    this.id = record.id;
    this.stringId = record.stringId;
    this.threadDir = path.join(threadsDir, `agent-${this.id}`);
    this.workspaceDir = path.join(this.threadDir, "workspace");
    this.codexDir = path.join(this.threadDir, ".codex");

    this._uid = 10000 + this.id;
    this._mcpSocketPath = path.join(MCP_SOCKETS_DIR!, `${crypto.randomUUID()}.sock`);
  }

  async connect() {
    if (this._childProcess) {
      throw new Error(`Thread ${this.id} is already connected.`);
    }

    this._childProcess = this._createAgentWorker();
    const worker = await this._childProcess;

    worker.on('message', async (message: UnrecordedSharedThreadEvent) => {
      console.log(`Received message from thread ${this.id}:`, message);
      const event = this.recordAndPublish(message);

      if (event.type === "thread.started") {
        const threadIdFile = path.join(this.threadDir, "thread_id");
        await fs.writeFile(threadIdFile, event.thread_id);
        await fs.chown(threadIdFile, this._uid, this._uid);
        await fs.chmod(threadIdFile, 0o400);
        setCodexThreadId(this.id, event.thread_id);
      }
    });
  }

  private recordAndPublish(event: UnrecordedSharedThreadEvent) {
    const sharedEvent = {
      ...event,
      id: randomStr(5),
      timestamp: new Date(),
    } as SharedThreadEvent;

    recordThreadEvent(this.id, sharedEvent);
    this.publish(sharedEvent);
    return sharedEvent;
  }

  private async _createAgentWorker() {
    await this._setupWorkspace();
    await this._setupMcpSocket();

    const workerScript = path.join(appDir, 'dist/agent-worker.js');
    return fork(workerScript, {
      uid: this._uid,
      gid: AGENTS_GID,
      cwd: this.workspaceDir,
      env: {
        PATH: process.env.PATH,
        HOME: this.threadDir,
        CODEX_HOME: this.codexDir,
        WORKSPACE_DIR: this.workspaceDir,
        MCP_SOCKET_PATH: this._mcpSocketPath,
      },
    });
  }

  private async _setupWorkspace() {
    await fs.mkdir(this.workspaceDir, { recursive: true });
    await fs.chown(this.workspaceDir, this._uid, this._uid);

    await fs.mkdir(this.codexDir, { recursive: true });
    await fs.chown(this.codexDir, this._uid, this._uid);

    const threadIdFile = path.join(this.threadDir, "thread_id");
    try {
      const existingThreadId = await fs.readFile(threadIdFile, "utf-8");
      setCodexThreadId(this.id, existingThreadId.trim());
    } catch {}
    
    const rootAuthPath = path.join(CODEX_HOME!, "auth.json");
    const localAuthPath = path.join(this.codexDir, "auth.json");
    try {
      await fs.access(localAuthPath);
      // The file already exists in the thread's codex directory, no need to create a symlink
      return;
    } catch {}

    try {
      await fs.symlink(rootAuthPath, localAuthPath);
      await fs.chown(localAuthPath, this._uid, this._uid);
    } catch (err) {
      console.error(`Error creating symlink for auth.json in thread ${this.id}:`, err);
    }
  }

  private _setupMcpSocket() {
    return new Promise<net.Server>((resolve, reject) => {
      const server = createIpcServer({
        id: this.id,
        workspaceDir: this.workspaceDir,
        uid: this._uid,
      });

      server.listen(this._mcpSocketPath, async () => {
        await fs.chown(this._mcpSocketPath, this._uid, this._uid);
        await fs.chmod(this._mcpSocketPath, 0o600);
        resolve(server);
      });
    });
  }

  async abort(from: string) {
    this.recordAndPublish({
      type: "input.abort",
      from,
    });

    const worker = await this._childProcess;
    if (!worker) {
      throw new Error(`Thread ${this.id} is not connected.`);
    }

    worker.send({ type: 'abort' });
  }

  async prompt(message: string, from: string) {
    const worker = await this._childProcess;
    if (!worker) {
      throw new Error(`Thread ${this.id} is not connected.`);
    }

    const turnId = randomStr(5);
    const prompt: Input = message;
    const options: TurnOptions = {};

    this.recordAndPublish({
      type: "input.prompt.queued",
      turnId,
      from,
      prompt,
      options,
    });
    this.recordAndPublish({
      type: "input.prompt",
      turnId,
      from,
      prompt,
      options,
    });

    worker.send({ type: 'prompt', message, turnId });
  }

  getEvents(options?: { limit?: number; offset?: number }) {
    return getThreadEvents(this.id, options);
  }
}

class Threads {
  private _threadsByStringId = new Map<string, Thread>();

  getOrCreateThread(stringId: string) {
    const cachedThread = this._threadsByStringId.get(stringId);
    if (cachedThread) {
      return cachedThread;
    }

    const record = getOrCreateThread(stringId);
    const thread = new Thread(record);
    this._threadsByStringId.set(stringId, thread);
    return thread;
  }
}

export const threads = new Threads();
