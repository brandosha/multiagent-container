import net from "net";
import readline from "readline";

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';

import { randomStr } from "./lib/utils.js";
import { gitCloneSchema, gitSshProxySchema,  IpcRequest,  ManagerIpcResponse, miseInstallSchema } from "./lib/ipc-server.js";

const mcpSocketPath = process.env.MCP_SOCKET_PATH;

if (!mcpSocketPath) {
  console.error("MCP_SOCKET_PATH environment variable is not set.");
  process.exit(1);
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
        const { id, text: response } = message as ManagerIpcResponse;
        const resolver = this._pendingResponses[id];
        if (resolver) {
          resolver(response);
          delete this._pendingResponses[id];
        } else {
          console.error(`No pending response handler for message ID ${id}`);
        }
      } catch (err) {
        console.error("Error parsing message from socket:", err);
      }
    });

    socket.on("error", (err) => {
      console.error("Error in manager socket:", err);
    });
  }

  send(message: IpcRequest["payload"]): Promise<string> {
    const id = randomStr(8);
    const msg = JSON.stringify({
      id,
      content: message,
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
        args: input,
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
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error executing git clone: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]
      };
    }
  });

  server.registerTool("git_ssh_proxy", {
    inputSchema: gitSshProxySchema,
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
    inputSchema: miseInstallSchema,
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

