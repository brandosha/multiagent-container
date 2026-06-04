import net from "net";
import readline from "readline";

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';

import { randomStr } from "./lib/utils.js";
import { gitCloneSchema, gitSshProxySchema, IpcRequest, managerIpcResponseSchema, miseInstallSchema } from "./lib/ipc-server.js";

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
        const { id, text: response } = managerIpcResponseSchema.parse(JSON.parse(line));
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
    const req: IpcRequest = {
      id,
      payload: message,
    };

    return new Promise<string>((resolve, reject) => {
      this._pendingResponses[id] = resolve;
      this.socket.write(JSON.stringify(req) + "\n", (err) => {
        if (err) {
          delete this._pendingResponses[id];
          reject(err);
        }
      });
    });
  }
}

const sock = net.connect(mcpSocketPath);
const conn = new ManagerSocketConnection(sock);

function startMcpServer() {
  const server = new McpServer({
    name: "Root Proxy",
    description: "Handles certain commands that require elevated permissions.",
    version: "0.0.1",
  });

  server.registerTool("git_clone", {
    title: "Git Clone",
    description: "Clones a git repository to a specified destination. Prefer using this tool over executing git clone directly, as it handles authentication (over ssh) and uses a cache to speed up subsequent clones of the same repository.",
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
    title: "Git SSH Proxy",
    description: "This tool must be used to execute any git command that requires SSH authentication.",
    inputSchema: gitSshProxySchema,
  }, async (input, context) => {
    try {
      const response = await conn.send({
        tool: "git_ssh_proxy",
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
            text: `Error executing git ssh proxy: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]
      };
    }
  });

  server.registerTool("mise_install", {
    title: "Mise Install",
    description: "Installs a package using the Mise package manager.",
    inputSchema: miseInstallSchema,
  }, async (input, context) => {
    try {
      const response = await conn.send({
        tool: "mise_install",
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
            text: `Error executing mise install: ${err instanceof Error ? err.message : String(err)}`,
          },
        ]
      };
    }
  });

  const transport = new StdioServerTransport();
  server.connect(transport);
}


startMcpServer();
