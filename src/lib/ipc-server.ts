import net from "net";
import path from "path";
import readline from "readline";

import { z } from "zod";
import { cloneRepo, copyGitRepo } from "./git.js";

export const gitCloneSchema = z.object({
  repoUrl: z.string(),
  destinationPath: z.string(),
});

export const gitSshProxySchema = z.object({
  cwd: z.string(),
  action: z.enum(["ls-remote", "fetch", "pull", "push"]),
  remote: z.string(),
  branch: z.string().optional(),
});

export const miseInstallSchema = z.object({
  package: z.string(),
});

export type GitCloneInput = z.infer<typeof gitCloneSchema>;
export type GitSshProxyInput = z.infer<typeof gitSshProxySchema>;
export type MiseInstallInput = z.infer<typeof miseInstallSchema>;

const ipcRequestSchema = z.object({
  id: z.string(),
  payload: z.object({
    tool: z.literal("git_clone"),
    args: gitCloneSchema,
  }).or(z.object({
    tool: z.literal("git_ssh_proxy"),
    args: gitSshProxySchema,
  })).or(z.object({
    tool: z.literal("mise_install"),
    args: miseInstallSchema,
  })),
});

export type IpcRequest = z.infer<typeof ipcRequestSchema>;

export const managerIpcResponseSchema = z.object({
  id: z.string(),
  text: z.string(),
  isError: z.boolean(),
});

export type ManagerIpcResponse = z.infer<typeof managerIpcResponseSchema>;

async function handleIpcRequest(req: IpcRequest, clientInfo: IpcClientInfo): Promise<ManagerIpcResponse> {
  if (req.payload.tool === "git_clone") {
    const { repoUrl, destinationPath } = req.payload.args;
    const absoluteDestinationPath = path.resolve(clientInfo.workspaceDir, destinationPath);
    if (!absoluteDestinationPath.startsWith(clientInfo.workspaceDir)) {
      return {
        id: req.id,
        text: `Invalid destination path: ${destinationPath}`,
        isError: true,
      };
    }

    try {
      await cloneRepo(repoUrl);
      await copyGitRepo({
        repoLocation: repoUrl,
        destination: absoluteDestinationPath,
        uid: clientInfo.uid,
        gitUsername: `agent-${clientInfo.id}`,
      });
    } catch (err) {
      return {
        id: req.id,
        text: `Error cloning repository: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    return {
      id: req.id,
      text: `Repository cloned successfully to ${destinationPath}`,
      isError: false,
    };
  }

  return {
    id: req.id,
    text: `Received request for tool ${req.payload.tool} with args ${JSON.stringify(req.payload.args)}`,
    isError: true, // For now, just return an error since we haven't implemented the tools yet
  }
}

export interface IpcClientInfo {
  id: number;
  workspaceDir: string;
  uid: number;
}

export function createIpcServer(clientInfo: IpcClientInfo): net.Server {
  return net.createServer((socket) => {
    const rl = readline.createInterface({ input: socket });

    rl.on("line", async (line) => {
      try {
        const message = ipcRequestSchema.parse(JSON.parse(line));
        const response = await handleIpcRequest(message, clientInfo);
        socket.write(JSON.stringify(response) + "\n");
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    });

    socket.on("error", (err) => {
      console.error("Socket error:", err);
    });
  });
}
