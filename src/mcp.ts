import net from "net";
import readline from "readline";

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { randomStr } from "./lib/utils.js";

const mcpSocketPath = process.env.MCP_SOCKET_PATH;

if (!mcpSocketPath) {
  console.error("MCP_SOCKET_PATH environment variable is not set.");
  process.exit(1);
}


const gitCloneSchema = z.object({
  repoUrl: z.string(),
  destinationPath: z.string(),
});

const gitSshProxySchema = z.object({
  cmd: z.string(),
});

const miseInstallSchema = z.object({
  package: z.string(),
});


export interface ManagerResponse {
  id: string;
  m: string;
}
class ManagerSocketConnection {
  socket: net.Socket;
  private _pendingResponses: Record<string, (response: string) => void> = {};

  constructor(socket: net.Socket) {
    this.socket = socket;

    const rl = readline.createInterface({ input: socket });
    rl.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        const { id, m: response } = message as ManagerResponse;
        const resolver = this._pendingResponses[id];
        if (resolver) {
          resolver(response);
          delete this._pendingResponses[id];
        } else {
          console.warn(`No pending response handler for message ID ${id}`);
        }
      } catch (err) {
        console.error("Error parsing message from socket:", err);
      }
    });

    socket.on("error", (err) => {
      console.error("Error in manager socket:", err);
    });
  }

  send(message: any) {
    const id = randomStr(8);
    const msg = JSON.stringify({
      id,
      m: message,
    });

    return new Promise<string>((resolve, reject) => {
      this._pendingResponses[id] = resolve;
      this.socket.write(msg + "\n", (err) => {
        if (err) {
          delete this._pendingResponses[id];
          reject(err);
        }
      });
    });
  }
}

const sock = net.connect(mcpSocketPath, startMcpServer);
const conn = new ManagerSocketConnection(sock);

function startMcpServer() {
  const server = new McpServer({
    name: "Root Proxy",
    description: "Handles certain commands that require elevated permissions.",
    version: "0.0.1",
  });

  server.registerTool("git_clone", {
    inputSchema: gitCloneSchema,
  }, async (input, context) => {

    try {
      const response = await conn.send({
        tool: "git_clone",
        repoUrl: input.repoUrl,
        destinationPath: input.destinationPath,
      });

      return {
        content: [
          {
            type: "text",
            text: response,
          },
        ]
      };
    } catch (err) {
    }
    
    return {
      content: [
        {
          type: "text",
          text: `Not yet implemented.`
        }
      ]
    }
  });

  server.registerTool("git_ssh_proxy", {
    inputSchema: z.object({
      cmd: z.string(),
    }),
  }, async (input, context) => {
    return {
      content: [
        {
          type: "text",
          text: `Not yet implemented.`
        }
      ]
    }
  });

  server.registerTool("mise_install", {
    inputSchema: z.object({
      package: z.string(),
    }),
  }, async (input, context) => {
    return {
      content: [
        {
          type: "text",
          text: `Not yet implemented.`
        }
      ]
    }
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
}



