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
  
  // 1. Safely create the destination directory AS THE AGENT.
  // This prevents the 'No such file or directory' error and ensures the agent owns it.
  await execFile('mkdir', ['-p', destination], { uid, gid: uid });
  
  // 2. Execute the CoW copy
  // We use `-T` to treat the destination `.git` as the explicit target,
  // preventing accidental nesting (e.g., `.git/repoDir/`) if the tool retries.
  await execFile('cp', [
    '-r',
    '-T',
    '--preserve=mode,timestamps',
    '--reflink=auto',
    repoDir, 
    path.join(destination, '.git') 
  ], {
    uid, gid: uid,
  });

  // 3. Convert the bare repo to a standard repo permanently
  await execFile('git', ['config', 'core.bare', 'false'], {
    cwd: destination,
    uid, gid: uid
  });

  // 4. Materialize the working tree
  // Use checkout instead of reset to gracefully handle the default branch.
  try {
    await execFile('git', ['checkout', '-f', 'HEAD'], {
      cwd: destination,
      uid, gid: uid
    });
  } catch (err) {
    // If the repository is completely empty (no commits yet), HEAD doesn't exist.
    // We can safely ignore this specific error, as the repo is valid but empty.
    if (!String(err).includes('ambiguous argument')) {
      throw err;
    }
  }

  // 5. Set user config for commits
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
