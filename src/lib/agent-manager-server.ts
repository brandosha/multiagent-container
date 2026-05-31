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

  const threadId = c.req.param("threadId");
  let thread = threads.getThread(parseInt(threadId ?? ""));

  if (threadId === "new") {
    thread = threads.createThread();
  }

  console.log(`Thread ${threadId}:`, thread);
  
  return {
    onOpen: async (event, ws) => {
      if (!thread) {
        ws.close(1008, "Invalid thread ID");
        return;
      }
      
      thread.subscribe((event) => {
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
      if (!thread) {
        ws.close(1008, "Invalid thread ID");
        return;
      }

      try {
        const data = JSON.parse(event.data.toString());
        if (data.type === "abort") {
          thread.abort();
          return;
        } else if (data.type === "prompt") {
          thread.prompt(data.message);
          return;
        }
      } catch (err) {
        console.error("Error handling message:", err);
      }
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