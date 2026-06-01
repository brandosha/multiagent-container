import fs from "fs/promises";
import path from "path";

import { reposDir } from "./paths.js";
import { execFile } from "./utils.js";

const gitHeadlessEnvVars = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "echo",
  GIT_SSH_COMMAND: `ssh -i ${process.env.SSH_KEY_PATH} -o BatchMode=yes -o StrictHostKeyChecking=no`,
  GIT_PAGER: "cat",
  GIT_EDITOR: "true",
};

// Common defense-in-depth arguments for root git operations
const safeGitArgs = [
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'credential.helper='
];

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9\-]/g, "-");
}

export function getBareRepoDir(repoLocation: string) {
  let repoHost: string;
  let repoPath: string;
  if (repoLocation.includes("://")) { // URL
    const url = new URL(repoLocation);
    repoHost = url.hostname;
    repoPath = url.pathname.slice(1); // Remove leading slash
  } else if (repoLocation.includes("@")) { // SSH
    const hostAndPath = repoLocation.split("@", 2)[1];
    const [host, path] = hostAndPath.split(":", 2);
    repoHost = host;
    repoPath = path;
  } else {
    throw new Error("Unsupported repository location format");
  }
  
  repoHost = sanitizeFilename(repoHost);
  repoPath = sanitizeFilename(repoPath);
  const workspaceName = `${repoHost}_${repoPath}`;

  return `${reposDir}/${workspaceName}.git`; // Store as a bare repo for caching
}

export async function cloneRepo(repoLocation: string) {
  // Recommend appending .git to the cache dir name to denote it's a bare repo
  const repoDir = getBareRepoDir(repoLocation); 
  
  try {
    await fs.access(path.join(repoDir, "HEAD")); // Bare repos use HEAD at root, not .git/HEAD
    
    // Repo already exists, update it safely using fetch (since it's bare)
    await execFile('git', [
      ...safeGitArgs,
      'fetch', 
      'origin', 
      '+refs/heads/*:refs/heads/*', // Force update all local branches to match remote
      '--prune'                     // Clean up deleted remote branches
    ], {
      cwd: repoDir,
      env: gitHeadlessEnvVars
    });
    return;
    
  } catch {
    // Repo doesn't exist, continue with cloning
  }
  
  await fs.mkdir(repoDir, { recursive: true });
  
  await execFile('git', [
    ...safeGitArgs,
    'clone',
    '--bare', // Highly recommended for caching
    '-c', 'core.sharedRepository=world',
    repoLocation,
    repoDir
  ], {
    env: gitHeadlessEnvVars,
  });
}

interface CopyGitRepoParams {
  repoLocation: string;
  destination: string; // The agent's workspace path
  uid: number;
  gitUsername: string;
  gitEmail?: string;
}

export async function copyGitRepo({ repoLocation, destination, uid, gitUsername, gitEmail }: CopyGitRepoParams) {
  const repoDir = getBareRepoDir(repoLocation);
  
  // 1. Ensure the parent directory exists (e.g., /workspace)
  const parentDir = path.dirname(destination);
  await fs.mkdir(parentDir, { recursive: true });
  
  // 2. We do NOT create `destination` itself with fs.mkdir, 
  // otherwise it is owned by root and cp will fail.
  
  // 3. Execute the CoW copy
  await execFile('cp', [
    '-r',
    '--preserve=mode,timestamps',
    '--reflink=auto',
    // We copy the bare repo (.git folder essentially) INTO a .git folder in the workspace
    repoDir, 
    path.join(destination, '.git') 
  ], {
    uid, gid: uid,
  });

  // 4. (Optional but recommended) 
  // Because we copied a bare repo, the agent needs to materialize the working tree.
  // We can do this on their behalf safely:
  await execFile('git', ['-c', 'core.bare=false', 'reset', '--hard', 'HEAD'], {
    cwd: destination,
    uid, gid: uid
  });

  // 5. Set user config for commits (if the agent will be making commits)
  if (gitUsername) {
    await execFile('git', ['config', 'user.name', gitUsername], {
      cwd: destination,
      uid, gid: uid
    });
  }
  if (gitEmail) {
    await execFile('git', ['config', 'user.email', gitEmail], {
      cwd: destination,
      uid, gid: uid
    });
  }
}
