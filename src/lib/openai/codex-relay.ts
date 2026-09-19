export interface CodexRelayRequest {
  runId: string;
  credentialId: string;
  model: string;
  prompt: string;
  workingDirectory: string;
  signal?: AbortSignal;
}

export type CodexSdkEvent =
  | { type: "thread.started"; threadId: string }
  | { type: "text"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done" };

export type CodexRelayEvent =
  | CodexSdkEvent
  | {
      type: "error";
      code: "credential_missing" | "scope_denied" | "provider_error" | "cancelled";
      message: string;
    };

export interface CodexSdkPort {
  stream(input: {
    apiKey: string;
    model: string;
    prompt: string;
    workingDirectory: string;
    signal?: AbortSignal;
  }): AsyncIterable<CodexSdkEvent>;
}

export interface CodexRelayAuditEvent {
  runId: string;
  model: string;
  status: "started" | "completed" | "failed" | "cancelled";
  message?: string;
}

export interface CodexRelayDependencies {
  loadApiKey(credentialId: string): Promise<string | null>;
  sdk: CodexSdkPort;
  audit(event: CodexRelayAuditEvent): void | Promise<void>;
  policy: {
    allowedModels: readonly string[];
    maxPromptChars: number;
  };
}

export async function* streamCodexRun(
  _request: CodexRelayRequest,
  _dependencies: CodexRelayDependencies,
): AsyncIterable<CodexRelayEvent> {
  throw new Error("T005 Codex relay contract is not implemented");
}
