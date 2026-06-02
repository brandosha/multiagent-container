import path from "path";

import type { CodexOptions } from "@openai/codex-sdk";
import { z } from "zod";

import { appDir } from "./paths.js";

export type CodexConfigValue = string | number | boolean | CodexConfigValue[] | { [key: string]: CodexConfigValue };
export type ThreadConfig = {
  codex: CodexOptions;
};

const codexConfigValueSchema: z.ZodType<CodexConfigValue> = z.lazy(() => z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(codexConfigValueSchema),
  z.record(z.string(), codexConfigValueSchema),
]));

export const codexOptionsSchema = z.object({
  codexPathOverride: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  config: z.record(z.string(), codexConfigValueSchema).optional(),
  env: z.record(z.string(), z.string()).optional(),
}).strict() satisfies z.ZodType<CodexOptions>;

export const threadConfigSchema = z.object({
  codex: codexOptionsSchema,
}).strict() satisfies z.ZodType<ThreadConfig>;

const ROOT_PROXY_MCP_SERVER = "root_proxy";
const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "bearer",
  "cookie",
  "mcp_socket_path",
  "password",
  "secret",
  "token",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeObjects<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      merged[key] = mergeObjects(existing, value);
    } else {
      merged[key] = value;
    }
  }

  return merged as T;
}

function isSensitiveKey(key: string) {
  return /^[A-Z0-9_]+$/.test(key) || SENSITIVE_KEYS.has(key.toLowerCase()) ||
    key.toLowerCase().includes("token") || key.toLowerCase().includes("secret");
}

function redactValue(value: unknown, key?: string): unknown {
  if (key && isSensitiveKey(key)) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]),
    );
  }

  return value;
}

export function buildInternalCodexOptions(mcpSocketPath: string): CodexOptions {
  return {
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    config: {
      mcp_servers: {
        [ROOT_PROXY_MCP_SERVER]: {
          command: process.execPath,
          args: [path.join(appDir, "dist/mcp.js")],
          default_tools_approval_mode: "approve",
          env: {
            MCP_SOCKET_PATH: mcpSocketPath,
          },
        },
      },
      sandbox_mode: "danger-full-access",
      approval_policy: "on-request",
      approvals_reviewer: "auto_review",
    },
  };
}

export function mergeCodexOptions(userOptions: CodexOptions, internalOptions: CodexOptions): CodexOptions {
  return mergeObjects(userOptions as Record<string, unknown>, internalOptions as Record<string, unknown>) as CodexOptions;
}

export function mergeThreadCodexOptions(config: ThreadConfig, mcpSocketPath: string): CodexOptions {
  return mergeCodexOptions(config.codex, buildInternalCodexOptions(mcpSocketPath));
}

export function redactThreadConfig(config: ThreadConfig): ThreadConfig {
  return redactValue(config) as ThreadConfig;
}

export function defaultThreadConfig(): ThreadConfig {
  return {
    codex: {},
  };
}
