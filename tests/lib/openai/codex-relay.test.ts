import { describe, expect, it, vi } from "vitest";
import {
  streamCodexRun,
  type CodexRelayDependencies,
  type CodexRelayEvent,
  type CodexRelayRequest,
  type CodexSdkEvent,
} from "@/lib/openai/codex-relay";

const SECRET = "sk-user-super-secret";

const REQUEST: CodexRelayRequest = {
  runId: "run-1",
  credentialId: "credential-1",
  model: "gpt-5.6-terra",
  prompt: "승인된 계획을 구현해줘",
  workingDirectory: "C:/sandbox/run-1",
};

async function collect(stream: AsyncIterable<CodexRelayEvent>): Promise<CodexRelayEvent[]> {
  const events: CodexRelayEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function dependencies(
  stream: CodexRelayDependencies["sdk"]["stream"],
) {
  const loadApiKey = vi
    .fn<CodexRelayDependencies["loadApiKey"]>()
    .mockResolvedValue(SECRET);
  const audit = vi.fn<CodexRelayDependencies["audit"]>();

  return {
    loadApiKey,
    sdk: { stream },
    audit,
    policy: {
      allowedModels: ["gpt-5.6-terra"],
      maxPromptChars: 1_000,
    },
  } satisfies CodexRelayDependencies;
}

describe("[T005] Codex 사용자 키 중계 계약", () => {
  it("원본 키는 신뢰된 SDK 경계에만 전달하고 반환 이벤트에서는 지운다", async () => {
    const sdkStream = vi.fn(async function* (input: { apiKey: string }) {
      yield { type: "text", text: `provider echoed ${input.apiKey}` } as CodexSdkEvent;
      yield { type: "done" } as CodexSdkEvent;
    });
    const deps = dependencies(sdkStream);

    const events = await collect(streamCodexRun(REQUEST, deps));

    expect(deps.loadApiKey).toHaveBeenCalledWith("credential-1");
    expect(sdkStream).toHaveBeenCalledWith(expect.objectContaining({ apiKey: SECRET }));
    expect(JSON.stringify(events)).not.toContain(SECRET);
  });

  it("공급자 오류와 감사 로그에 원본 키를 남기지 않는다", async () => {
    const deps = dependencies(async function* () {
      throw new Error(`401 Unauthorized for ${SECRET}`);
    });

    const events = await collect(streamCodexRun(REQUEST, deps));

    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", code: "provider_error" }),
    );
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(SECRET);
  });

  it("허용하지 않은 모델은 키를 읽기 전에 거부한다", async () => {
    const sdkStream = vi.fn(async function* () {
      yield { type: "done" } as CodexSdkEvent;
    });
    const deps = dependencies(sdkStream);

    const events = await collect(
      streamCodexRun({ ...REQUEST, model: "unapproved-model" }, deps),
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "scope_denied" }));
    expect(deps.loadApiKey).not.toHaveBeenCalled();
    expect(sdkStream).not.toHaveBeenCalled();
  });

  it("프롬프트 허용 길이를 넘으면 키를 읽기 전에 거부한다", async () => {
    const sdkStream = vi.fn(async function* () {
      yield { type: "done" } as CodexSdkEvent;
    });
    const deps = dependencies(sdkStream);

    const events = await collect(
      streamCodexRun({ ...REQUEST, prompt: "x".repeat(1_001) }, deps),
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "scope_denied" }));
    expect(deps.loadApiKey).not.toHaveBeenCalled();
    expect(sdkStream).not.toHaveBeenCalled();
  });

  it("키가 없을 때 운영자 키로 대체하지 않고 명확히 거부한다", async () => {
    const sdkStream = vi.fn(async function* () {
      yield { type: "done" } as CodexSdkEvent;
    });
    const deps = dependencies(sdkStream);
    deps.loadApiKey.mockResolvedValue(null);

    const events = await collect(streamCodexRun(REQUEST, deps));

    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", code: "credential_missing" }),
    );
    expect(sdkStream).not.toHaveBeenCalled();
  });

  it("스트림과 취소 신호를 SDK 호출에 그대로 연결한다", async () => {
    const controller = new AbortController();
    const sdkStream = vi.fn(async function* () {
      yield { type: "thread.started", threadId: "thread-1" } as CodexSdkEvent;
      yield { type: "text", text: "작업 중" } as CodexSdkEvent;
      yield { type: "done" } as CodexSdkEvent;
    });
    const deps = dependencies(sdkStream);

    const events = await collect(
      streamCodexRun({ ...REQUEST, signal: controller.signal }, deps),
    );

    expect(sdkStream).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(events).toEqual([
      { type: "thread.started", threadId: "thread-1" },
      { type: "text", text: "작업 중" },
      { type: "done" },
    ]);
    expect(deps.audit.mock.calls).toEqual([
      [{ runId: "run-1", model: "gpt-5.6-terra", status: "started" }],
      [{ runId: "run-1", model: "gpt-5.6-terra", status: "completed" }],
    ]);
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(SECRET);
  });

  it("영속 작업 입력에는 키 값이나 apiKey 필드가 없다", () => {
    expect(REQUEST).not.toHaveProperty("apiKey");
    expect(JSON.stringify(REQUEST)).not.toContain(SECRET);
  });

  it("AbortError를 취소 이벤트로 매핑하고 오류 원문은 감사 로그에 남기지 않는다", async () => {
    const controller = new AbortController();
    const deps = dependencies(async function* () {
      controller.abort();
      const error = new Error(`cancelled while using ${SECRET}`);
      error.name = "AbortError";
      throw error;
    });

    const events = await collect(
      streamCodexRun({ ...REQUEST, signal: controller.signal }, deps),
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error", code: "cancelled" }));
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(deps.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "cancelled", message: "Codex 실행이 취소됐습니다." }),
    );
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain(SECRET);
  });
});
