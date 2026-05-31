import path from "path";
import { existsSync, mkdirSync } from "fs";

const { CODEX_HOME } = process.env;
if (!CODEX_HOME) {
  throw new Error("CODEX_HOME environment variable is not set.");
}

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
export const rootCodexDir = CODEX_HOME;
export const mcpSocketsDir = "/tmp/mcp-sockets";

[agentsDir, threadsDir, rootCodexDir, mcpSocketsDir].forEach(dir => {
  mkdirSync(dir, { recursive: true });
});