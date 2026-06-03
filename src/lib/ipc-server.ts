import net from "net";
import path from "path";
import readline from "readline";

import { z } from "zod";
import { cloneRepo, copyGitRepo, runGitRemoteCommand, setGitUser } from "./git.js";
import type { ThreadConfig } from "./thread-config.js";

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
      });
      await setGitUser({
        userHome: clientInfo.workspaceDir,
        uid: clientInfo.uid,
        gitUsername: `Agent`,
        gitEmail: `${clientInfo.id}@agents.internal`,
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
  } else if (req.payload.tool === "git_ssh_proxy") {
    const { cwd } = req.payload.args;
    const absoluteCwd = path.resolve(clientInfo.workspaceDir, cwd);
    if (!absoluteCwd.startsWith(clientInfo.workspaceDir)) {
      return {
        id: req.id,
        text: `Invalid cwd path: ${cwd}`,
        isError: true,
      };
    }

    try {
      const result = await runGitRemoteCommand({
        ...req.payload.args,
        uid: clientInfo.uid,
        cwd: absoluteCwd,
      });

      return {
        id: req.id,
        text: `${result.stdout}${result.stderr ? "\n\nstderr:\n" + result.stderr : ""}`,
        isError: false,
      }
    } catch (err) {
      return {
        id: req.id,
        text: `Error executing git command: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

  } else if (req.payload.tool === "mise_install") {
    return {
      id: req.id,
      text: `Mise installation not implemented yet`,
      isError: true,
    };
  }

  return {
    id: req.id,
    // @ts-ignore - `never` type is causing errors here but we need this fallback
    text: `Received request for unknown tool ${req.payload.tool} with args ${JSON.stringify(req.payload.args)}`,
    isError: true, // For now, just return an error since we haven't implemented the tools yet
  }
}

export interface IpcClientInfo {
  id: string;
  homeDir: string;
  workspaceDir: string;
  uid: number;
  getConfig: () => ThreadConfig;
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
