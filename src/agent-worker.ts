import { readFileSync } from "fs";
import path from "path";

import { Codex, ThreadOptions } from "@openai/codex-sdk";
import { z } from "zod";

import { defaultThreadConfig, mergeThreadCodexOptions, threadConfigSchema, ThreadConfig } from "./lib/thread-config.js";

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

const threadOptions: ThreadOptions = {
  skipGitRepoCheck: true,
  workingDirectory: process.cwd(),
};

let latestConfig: ThreadConfig = defaultThreadConfig();

function createThread(config: ThreadConfig) {
  const codex = new Codex(mergeThreadCodexOptions(config, MCP_SOCKET_PATH!));
  const threadIdFile = path.join(process.env.HOME ?? "", "thread_id");

  try {
    const threadId = readFileSync(threadIdFile, "utf-8").trim();
    if (threadId) {
      return codex.resumeThread(threadId, threadOptions);
    }
  } catch (error) {
    console.error("Could not resume thread:", error);
  }

  return codex.startThread(threadOptions);
}

function withPromptAttribution(message: string, from: string) {
  return `[${from}]\n${message}`;
}

type AsyncTask<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}
class AsyncQueue<T> {
  tasks: AsyncTask<T>[] = [];
  isProcessing = false;

  enqueue(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      // Store the task and its independent controllers in a flat array.
      this.tasks.push({ task, resolve, reject });
      this.process();
    });
  }

  async process() {
    // Prevent multiple workers from processing at the same time.
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.tasks.length > 0) {
      const { task, resolve, reject } = this.tasks.shift()!;
      console.log(`Processing task. Remaining queue length: ${this.tasks.length}`);
      
      try {
        const result = await task();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }

    this.isProcessing = false;
    console.log("All tasks processed, queue is now empty.");
  }
}

const messageQueue = new AsyncQueue<void>();
let abortSignalController: Promise<AbortController> | undefined;

const messageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("abort"),
  }),
  z.object({
    type: z.literal("config"),
    config: threadConfigSchema,
  }),
  z.object({
    type: z.literal("prompt"),
    from: z.string(),
    message: z.string(),
    turnId: z.string(),
  }),
]);

process.on("message", async (message) => {
  let parsedMessage: z.infer<typeof messageSchema>;
  try {
    parsedMessage = messageSchema.parse(message);
  } catch (error) {
    console.error("Received invalid message:", message);
    return;
  }
  console.log("Received message:", parsedMessage);

  if (parsedMessage.type === "config") {
    latestConfig = parsedMessage.config;
    return;
  }

  const abortController = await abortSignalController;
  if (parsedMessage.type === "abort") {
    abortController?.abort();
  } else if (parsedMessage.type === "prompt") {
    abortController?.abort(); // Abort any existing task before starting a new one.
    messageQueue.enqueue(async () => {
      console.log("Handling prompt:", parsedMessage.message);
      const newAbortController = new AbortController();
      let resolveAbortLock: () => void = () => {};
      abortSignalController = new Promise((resolve) => {
        resolveAbortLock = () => resolve(newAbortController);
      });

      try {
        const thread = createThread(latestConfig);
        const { events } = await thread.runStreamed(withPromptAttribution(parsedMessage.message, parsedMessage.from), {
          signal: newAbortController.signal,
        });

        for await (const event of events) {
          if (event.type === "item.completed") {
            resolveAbortLock();
          }

          process.send!({
            ...event,
            turnId: parsedMessage.turnId,
          });
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
          console.log("Thread execution aborted.");
          process.send!({
            type: "turn.abort",
            turnId: parsedMessage.turnId,
          });
        } else if (error instanceof Error) {
          console.error("Error during thread execution:", error);
          process.send!({
            type: "turn.error",
            turnId: parsedMessage.turnId,
            error: {
              name: error.name,
              message: error.message,
            },
          });
        } else {
          console.error("Unknown error during thread execution:", error);
          process.send!({
            type: "turn.error",
            turnId: parsedMessage.turnId,
            error: {
              name: "UnknownError",
              message: String(error),
            },
          });
        }
      } finally {
        resolveAbortLock();
      }
    });
  }
});
