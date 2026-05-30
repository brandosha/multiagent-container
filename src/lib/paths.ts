import path from "path";
import { existsSync, mkdirSync } from "fs";
import fs from "fs/promises";

function getRootDir() {
  let currentDir = import.meta.dirname;
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(currentDir, "package.json"))) {
      return path.resolve(currentDir);
    }
    currentDir = path.join(currentDir, "..");
  }

  throw new Error("Could not find root directory containing package.json");
}


export const appDir = getRootDir();
export const agentsDir = "/agents";
export const threadsDir = path.join(agentsDir, "threads");
export const codexDir = path.join(agentsDir, ".codex");
export const mcpSocketsDir = "/tmp/mcp-sockets";

process.env.CODEX_HOME = codexDir;

[agentsDir, threadsDir, codexDir, mcpSocketsDir].forEach(dir => {
  mkdirSync(dir, { recursive: true });
});