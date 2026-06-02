import fs from "fs/promises";

import { serve, upgradeWebSocket } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import { WebSocketServer } from "ws";

import { threads } from "./threads.js";
import { codex } from "./codex.js";

const app = new Hono();

// Block any local server access so that untrusted agents can't access other threads or the agent manager server itself.
app.use("*", async (c, next) => {
  const connInfo = getConnInfo(c);
  const remoteAddr = connInfo.remote.address;

  if (["localhost", "127.0.0.1", "::1", undefined].includes(remoteAddr)) {
    return c.text("Forbidden", 403);
  }
  return next();
});

app.get("/thread/:threadId", upgradeWebSocket(async (c) => {

  const threadId = c.req.param("threadId") ?? "";
  const thread = threads.getOrCreateThread(threadId);

  console.log(`Thread ${threadId}:`, thread);
  let unsubscribe = () => {};
  
  return {
    onOpen: async (event, ws) => {
      unsubscribe = thread.subscribe((event) => {
        ws.send(JSON.stringify(event));
      });

      await thread.connect().catch((err) => {
        console.error(err);
      });

      ws.send(JSON.stringify({
        type: "thread.connected",
        threadId: thread.id,
      }));
    },
    onMessage: (event, ws) => {
      try {
        const data = JSON.parse(event.data.toString());
        if (data.type === "abort") {
          if (typeof data.from !== "string" || !data.from) {
            ws.send(JSON.stringify({
              type: "request.error",
              message: "abort requests require a non-empty from field",
            }));
            return;
          }
          thread.abort(data.from);
          return;
        } else if (data.type === "prompt") {
          if (typeof data.message !== "string") {
            ws.send(JSON.stringify({
              type: "request.error",
              message: "prompt requests require a string message field",
            }));
            return;
          }
          if (typeof data.from !== "string" || !data.from) {
            ws.send(JSON.stringify({
              type: "request.error",
              message: "prompt requests require a non-empty from field",
            }));
            return;
          }
          thread.prompt(data.message, data.from);
          return;
        } else if (data.type === "events.get") {
          const limit = Number.isInteger(data.limit) ? Math.max(1, Math.min(data.limit, 500)) : undefined;
          const offset = Number.isInteger(data.offset) ? Math.max(0, data.offset) : undefined;
          ws.send(JSON.stringify({
            type: "thread.events",
            threadId: thread.id,
            limit,
            offset,
            events: thread.getEvents({ limit, offset }),
          }));
          return;
        }
      } catch (err) {
        console.error("Error handling message:", err);
      }
    },
    onClose: () => {
      unsubscribe();
    }
  };
}));

app.get("/codex-login", upgradeWebSocket(async (c) => {
  return {
    onOpen: async (event, ws) => {
      const login = codex.login();
      login.output.subscribe((event) => {
        ws.send(JSON.stringify({
          type: "codex.login.output",
          ...event
        }));
      });

      login.process.on("error", (err) => {
        ws.send(JSON.stringify({
          type: "codex.login.error",
          message: err.message,
        }));
      });

      login.process.on("close", (code, signal) => {
        ws.send(JSON.stringify({
          type: "codex.login.exit",
          code,
          signal,
        }));
      });
    },
    onMessage: (event, ws) => {
      // No messages expected from client for this endpoint
    }
  };
}));

app.get("/publickey", async (c) => {
  const publicKeyPath = `${process.env.SSH_KEY_PATH}.pub`;
  const publicKey = await fs.readFile(publicKeyPath, "utf-8");
  return c.json({ key: publicKey });
});

app.use("*", async (c) => {
  return c.text("Not found", 404);
});

export function startAgentServer(port = 80) {
  const wss = new WebSocketServer({ noServer: true });
  serve({
    fetch: app.fetch,
    port: port,
    websocket: {
      server: wss,
    },
  }, info => {
    console.log(`Server running on port ${info.port}`);
  });
}
