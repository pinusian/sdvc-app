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
  request: CodexRelayRequest,
  dependencies: CodexRelayDependencies,
): AsyncIterable<CodexRelayEvent> {
  const { policy } = dependencies;
  if (
    !policy.allowedModels.includes(request.model) ||
    request.prompt.length > policy.maxPromptChars
  ) {
    yield {
      type: "error",
      code: "scope_denied",
      message: "허용된 Codex 실행 범위를 벗어났습니다.",
    };
    return;
  }

  if (request.signal?.aborted) {
    await dependencies.audit({
      runId: request.runId,
      model: request.model,
      status: "cancelled",
    });
    yield {
      type: "error",
      code: "cancelled",
      message: "Codex 실행이 취소됐습니다.",
    };
    return;
  }

  const apiKey = await dependencies.loadApiKey(request.credentialId);
  if (!apiKey) {
    yield {
      type: "error",
      code: "credential_missing",
      message: "등록된 OpenAI API 키가 없습니다.",
    };
    return;
  }

  await dependencies.audit({
    runId: request.runId,
    model: request.model,
    status: "started",
  });

  try {
    const stream = dependencies.sdk.stream({
      apiKey,
      model: request.model,
      prompt: request.prompt,
      workingDirectory: request.workingDirectory,
      signal: request.signal,
    });

    for await (const event of stream) {
      yield redactEvent(event, apiKey);
    }

    await dependencies.audit({
      runId: request.runId,
      model: request.model,
      status: "completed",
    });
  } catch (error) {
    const cancelled = request.signal?.aborted || isAbortError(error);
    await dependencies.audit({
      runId: request.runId,
      model: request.model,
      status: cancelled ? "cancelled" : "failed",
      message: cancelled ? "Codex 실행이 취소됐습니다." : "Codex SDK 호출에 실패했습니다.",
    });
    yield {
      type: "error",
      code: cancelled ? "cancelled" : "provider_error",
      message: cancelled ? "Codex 실행이 취소됐습니다." : "Codex 실행에 실패했습니다.",
    };
  }
}

function redactEvent(event: CodexSdkEvent, apiKey: string): CodexSdkEvent {
  if (event.type === "text") {
    return { ...event, text: redact(event.text, apiKey) };
  }
  if (event.type === "thread.started") {
    return { ...event, threadId: redact(event.threadId, apiKey) };
  }
  return event;
}

function redact(value: string, secret: string): string {
  return secret.length === 0 ? value : value.split(secret).join("[REDACTED]");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
