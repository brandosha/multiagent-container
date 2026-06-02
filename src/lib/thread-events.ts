import type { Input, ThreadEvent, TurnOptions } from "@openai/codex-sdk";

export interface PromptQueuedEvent {
  type: "input.prompt.queued";
  turnId: string;
  from: string;
  prompt: Input;
  options: TurnOptions;
}

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
  PromptQueuedEvent |
  PromptEvent |
  AbortEvent |
  TurnAbortEvent |
  TurnErrorEvent
) & {
  id: string;
  timestamp: Date;
};
