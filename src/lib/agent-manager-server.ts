import fs from "fs/promises";

import { serve, upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";

import { threads } from "./threads.js";

const app = new Hono();

app.get("/thread/:threadId", upgradeWebSocket(async (c) => {

  const threadId = c.req.param("threadId");
  let thread = threads.getThread(parseInt(threadId ?? ""));

  if (threadId === "new") {
    thread = threads.createThread();
  }
  
  return {
    onOpen: async (event, ws) => {
      if (!thread) {
        ws.close(1008, "Invalid thread ID");
        return;
      }
      
      thread.subscribe((event) => {
        ws.send(JSON.stringify(event));
      });

      await thread.connect();

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

app.get("/publickey", async (c) => {
  const publicKeyPath = "/agents/ssh/id_ed25519.pub";
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