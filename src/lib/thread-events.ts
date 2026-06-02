import type { Input, ThreadEvent, TurnOptions } from "@openai/codex-sdk";

import type { ThreadConfig } from "./thread-config.js";

export interface PromptEvent {
  type: "input.prompt";
  turnId: string;
  from: string;
  prompt: Input;
  options: TurnOptions;
}

export interface AbortEvent {
  type: "input.abort";
  from: string;
}

export interface TurnAbortEvent {
  type: "turn.abort";
  turnId: string;
}

export interface ThreadConfigUpdatedEvent {
  type: "thread.config.updated";
  from: string;
  config: ThreadConfig;
}

export interface TurnErrorEvent {
  type: "turn.error";
  turnId: string;
  error: {
    name: string;
    message: string;
  };
}

export type SharedThreadEvent = (
  (ThreadEvent & { turnId: string }) |
  PromptEvent |
  AbortEvent |
  ThreadConfigUpdatedEvent |
  TurnAbortEvent |
  TurnErrorEvent
) & {
  id: string;
  timestamp: Date;
};
