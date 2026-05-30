import net from "net";

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';

const mcpSocketPath = process.env.MCP_SOCKET_PATH;

if (!mcpSocketPath) {
  console.error("MCP_SOCKET_PATH environment variable is not set.");
  process.exit(1);
}

const socket = net.connect(mcpSocketPath, startMcpServer);

function startMcpServer() {
  const server = new McpServer({
    name: "Root Proxy",
    description: "Handles certain commands that require elevated permissions.",
    version: "0.0.1",
  });

  server.registerTool("git_clone", {
    inputSchema: z.object({
      repoUrl: z.string(),
      destinationPath: z.string(),
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
      taskDescription: z.string(),
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



