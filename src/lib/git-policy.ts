import type { ThreadConfig } from "./thread-config.js";

export class GitPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitPolicyError";
  }
}

function normalizeBranchName(branch: string) {
  return branch.replace(/^refs\/heads\//, "");
}

export function gitUsername(config: ThreadConfig) {
  const configuredUsername = config.git?.username?.trim();
  return configuredUsername || "Agent";
}

export function pushTargetBranch(refspec: string) {
  if (refspec.startsWith("+")) {
    throw new GitPolicyError(`Force pushes are prohibited: refspec ${refspec} starts with '+'.`);
  }

  const [, target = refspec] = refspec.split(":", 2);
  const normalizedTarget = normalizeBranchName(target);
  if (!normalizedTarget) {
    throw new GitPolicyError(`Unable to determine push target branch from refspec ${refspec}.`);
  }

  return normalizedTarget;
}

export function assertPushAllowed(config: ThreadConfig, refspec?: string) {
  if (!refspec) {
    throw new GitPolicyError("Push requires an explicit branch or refspec so branch policy can be checked.");
  }

  const targetBranch = pushTargetBranch(refspec);
  const branches = config.git?.branches;
  const allow = branches?.allow?.map(normalizeBranchName);
  const block = branches?.block?.map(normalizeBranchName) ?? [];

  if (allow) {
    if (!allow.includes(targetBranch)) {
      throw new GitPolicyError(
        `Push blocked by allow-list policy. Target branch ${targetBranch} is not in allow list: ${allow.join(", ") || "(empty)"}.`,
      );
    }
    return { targetBranch, mode: "allow" as const };
  }

  if (block.includes(targetBranch)) {
    throw new GitPolicyError(`Push blocked by block-list policy. Target branch ${targetBranch} is blocked.`);
  }

  return { targetBranch, mode: "block" as const };
}
