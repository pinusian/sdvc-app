import { redactProviderCredentialText } from "@/lib/openai/provider-credentials";

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
      code: CodexRelayErrorCode;
      message: string;
    };

export type CodexRelayErrorCode =
  | "credential_missing"
  | "scope_denied"
  | "provider_error"
  | "cancelled";

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
  if (isScopeDenied(request, dependencies.policy)) {
    yield relayError("scope_denied");
    return;
  }

  if (request.signal?.aborted) {
    await auditStatus(dependencies, request, "cancelled");
    yield relayError("cancelled");
    return;
  }

  const apiKey = await dependencies.loadApiKey(request.credentialId);
  if (!apiKey) {
    yield relayError("credential_missing");
    return;
  }

  await auditStatus(dependencies, request, "started");

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

    await auditStatus(dependencies, request, "completed");
  } catch (error) {
    const cancelled = request.signal?.aborted || isAbortError(error);
    const code = cancelled ? "cancelled" : "provider_error";
    await auditStatus(dependencies, request, cancelled ? "cancelled" : "failed", code);
    yield relayError(code);
  }
}

const ERROR_MESSAGES: Record<CodexRelayErrorCode, string> = {
  credential_missing: "등록된 OpenAI API 키가 없습니다.",
  scope_denied: "허용된 Codex 실행 범위를 벗어났습니다.",
  provider_error: "Codex 실행에 실패했습니다.",
  cancelled: "Codex 실행이 취소됐습니다.",
};

function relayError(code: CodexRelayErrorCode): CodexRelayEvent {
  return { type: "error", code, message: ERROR_MESSAGES[code] };
}

function isScopeDenied(
  request: CodexRelayRequest,
  policy: CodexRelayDependencies["policy"],
): boolean {
  return (
    !policy.allowedModels.includes(request.model) ||
    request.prompt.length > policy.maxPromptChars
  );
}

async function auditStatus(
  dependencies: CodexRelayDependencies,
  request: CodexRelayRequest,
  status: CodexRelayAuditEvent["status"],
  errorCode?: CodexRelayErrorCode,
): Promise<void> {
  await dependencies.audit({
    runId: request.runId,
    model: request.model,
    status,
    ...(errorCode ? { message: ERROR_MESSAGES[errorCode] } : {}),
  });
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
  return redactProviderCredentialText(value, [secret]);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
