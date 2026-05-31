import { fork, ChildProcess } from 'child_process';
import { readdirSync } from 'fs';
import fs from 'fs/promises';
import net from 'net';
import crypto from 'crypto';
import path from 'path';

import { ThreadEvent } from '@openai/codex-sdk';

import { appDir, threadsDir, mcpSocketsDir } from './paths.js';
import { PubSub } from './PubSub.js';

export const AGENTS_GID = parseInt(process.env.AGENTS_GID ?? "");
if (isNaN(AGENTS_GID)) {
  console.error("AGENTS_GID environment variable is not set or is not a valid number.");
  process.exit(1);
}

class Thread extends PubSub<ThreadEvent> {
  id: number;
  threadDir: string;
  workspaceDir: string;
  private _uid: number;
  private _mcpSocketPath: string;
  private _childProcess?: Promise<ChildProcess>;

  constructor(id: number) {
    super();
    this.id = id;
    this.threadDir = path.join(threadsDir, `agent-${id}`);
    this.workspaceDir = path.join(this.threadDir, "workspace");

    this._uid = 10000 + id;
    this._mcpSocketPath = path.join(mcpSocketsDir, `${crypto.randomUUID()}.sock`);
  }

  async connect() {
    if (this._childProcess) {
      throw new Error(`Thread ${this.id} is already connected.`);
    }

    this._childProcess = this._createAgentWorker();
    const worker = await this._childProcess;

    worker.on('message', async (message: ThreadEvent) => {
      console.log(`Received message from thread ${this.id}:`, message);

      if (message.type === "thread.started") {
        const threadIdFile = path.join(this.threadDir, "thread_id");
        await fs.writeFile(threadIdFile, message.thread_id);
        await fs.chown(threadIdFile, this._uid, this._uid);
        await fs.chmod(threadIdFile, 0o400);
      }

      this.publish(message);
    });

    worker.send({
      type: 'init',
      mcpSocketPath: this._mcpSocketPath
    });
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
        HOME: this.workspaceDir,
        MCP_SOCKET_PATH: this._mcpSocketPath,
      },
    });
  }

  private async _setupWorkspace() {
    await fs.mkdir(this.workspaceDir, { recursive: true });
    await fs.chown(this.workspaceDir, this._uid, this._uid);
  }

  private _setupMcpSocket() {
    return new Promise<net.Server>((resolve, reject) => {
      const server = net.createServer((socket) => {
        socket.on('data', (data) => {
          const message = data.toString();
          console.log(`Received message from thread ${this.id}: ${message}`);
        });
      });

      server.on('error', (err) => {
        console.error(`Error in MCP socket for thread ${this.id}:`, err);
        reject(err);
      });

      server.listen(this._mcpSocketPath, async () => {
        await fs.chown(this._mcpSocketPath, this._uid, this._uid);
        await fs.chmod(this._mcpSocketPath, 0o600);
        resolve(server);
      });
    });
  }

  async abort() {
    const worker = await this._childProcess;
    if (!worker) {
      throw new Error(`Thread ${this.id} is not connected.`);
    }

    worker.send({ type: 'abort' });
  }

  async prompt(message: string) {
    const worker = await this._childProcess;
    if (!worker) {
      throw new Error(`Thread ${this.id} is not connected.`);
    }

    worker.send({ type: 'prompt', message });
  }
}

class Threads {
  private _agents: (Thread | null)[];

  constructor() {
    this._agents = [];
    const existingAgents = readdirSync(threadsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && dirent.name.startsWith('agent-'))
      .map(dirent => parseInt(dirent.name.split('-')[1], 10))
      .filter(id => !isNaN(id))
      .sort((a, b) => a - b);

    for (const id of existingAgents) {
      while (this._agents.length < id) {
        this._agents.push(null);
      }
      this._agents.push(new Thread(id));
    }
  }

  createThread() {
    const id = this._agents.length;
    const thread = new Thread(id);
    this._agents.push(thread);
    return thread;
  }

  getThread(id: number) {
    return this._agents[id];
  }
}

export const threads = new Threads();