import { readFileSync } from "fs";
import path from "path";

import { Codex, ThreadOptions } from "@openai/codex-sdk";
import { z } from "zod";

import { appDir, codexDir } from "./lib/paths.js";


if (!process.send || process.getuid!() < 10000) {
  console.error("This script may only be run as a child process.");
  process.exit(1);
}

const { MCP_SOCKET_PATH } = process.env;
if (!MCP_SOCKET_PATH) {
  console.error("MCP_SOCKET_PATH environment variable is not set.");
  process.exit(1);
}
delete process.env.MCP_SOCKET_PATH; // Remove from env to prevent access by child processes

const codex = new Codex({
  config: {
    mcp_servers: {
      'root_proxy': {
        command: 'node',
        args: [path.join(appDir, 'dist/mcp.js')],
        default_tools_approval_mode: 'approve',
        env: {
          MCP_SOCKET_PATH
        }
      }
    },
    sandbox_mode: 'danger-full-access',
    approval_policy: 'on-request',
    approvals_reviewer: 'auto_review',
  },
  env: {
    CODEX_HOME: codexDir
  }
});


const threadOptions: ThreadOptions = {
  skipGitRepoCheck: true,
  workingDirectory: process.env.HOME
}

let thread = codex.startThread(threadOptions);
try {
  const threadIdFile = path.join(process.env.HOME ?? "", "../thread_id");
  const threadId = readFileSync(threadIdFile, "utf-8");
  thread = codex.resumeThread(threadId, threadOptions);
} catch (error) {
  console.error("Could not resume thread:", error);
}

type AsyncTask<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
}
class AsyncQueue<T> {
  tasks: AsyncTask<T>[] = [];
  isProcessing = false;

  enqueue(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      // 1. Store the task and its independent controllers in a flat array
      this.tasks.push({ task, resolve, reject });
      this.process();
    });
  }

  async process() {
    // Prevent multiple workers from processing at the same time
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.tasks.length > 0) {
      // 2. Shift items out of the array completely, breaking memory references
      const { task, resolve, reject } = this.tasks.shift()!;
      
      try {
        const result = await task();
        resolve(result);
      } catch (error) {
        reject(error); // Prevents hidden unhandled promise leaks
      }
    }

    // 3. Reset state cleanly once the array is empty
    this.isProcessing = false;
  }
}

const messageQueue = new AsyncQueue();
let abortSignalController: Promise<AbortController> | undefined;

const messageSchema = z.object({
  type: z.literal("abort"),
}).or(z.object({
  type: z.literal("prompt"),
  message: z.string(),
}));

process.on('message', async (message) => {
  let parsedMessage: z.infer<typeof messageSchema>;
  try {
    parsedMessage = messageSchema.parse(message);
  } catch (error) {
    console.error("Received invalid message:", message);
    return;
  }

  const abortController = await abortSignalController;
  if (parsedMessage.type === "abort") {
    abortController?.abort();
  } else if (parsedMessage.type === "prompt") {
    abortController?.abort(); // Abort any existing task before starting a new one
    messageQueue.enqueue(async () => {
      const newAbortController = new AbortController();
      let resolveAbortLock: () => void = () => {};
      abortSignalController = new Promise((resolve) => {
        resolveAbortLock = () => resolve(newAbortController);
      });

      const { events } = await thread.runStreamed(parsedMessage.message, {
        signal: newAbortController.signal,
      });

      for await (const event of events) {
        console.log("Thread event:", event);
        if (event.type === "item.completed") {
          resolveAbortLock();
        }

        process.send!(event);
      }
    });
  }
});