import { describe, expect, it, vi } from "vitest";
import { recordUsage, monthlyTokenUsage } from "@/lib/usage/store";

/**
 * [P6-2] 사용량 기록과 이번 달 합계.
 * 한도 판정([P6-3])과 원가 분석([P8-3])이 모두 이 기록 위에 얹힌다.
 */

type Result = { data: unknown; error: unknown };

function fakeSupabase(result: Result = { data: null, error: null }) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, ...args: unknown[]) => {
    (calls[name] ??= []).push(args.length === 1 ? args[0] : args);
  };

  const builder: Record<string, unknown> = {};
  for (const name of ["insert", "select", "eq", "gte", "lt", "order"]) {
    builder[name] = (...args: unknown[]) => {
      record(name, ...args);
      return builder;
    };
  }
  builder.single = () => Promise.resolve(result);
  builder.maybeSingle = () => Promise.resolve(result);
  builder.then = (resolve: (value: Result) => unknown) => resolve(result);

  const client = {
    from: (table: string) => {
      record("from", table);
      return builder;
    },
  };
  return { client: client as never, calls };
}

describe("[P6-2] recordUsage", () => {
  it("사용량과 원가를 함께 남긴다", async () => {
    const { client, calls } = fakeSupabase({ data: { id: "u1" }, error: null });

    await recordUsage(client, {
      userId: "user-1",
      conversationId: "conv-1",
      projectId: null,
      model: "claude-sonnet-5",
      inputTokens: 1_000,
      outputTokens: 500,
    });

    expect(calls.from).toContain("usage_logs");
    const row = calls.insert[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      user_id: "user-1",
      conversation_id: "conv-1",
      project_id: null,
      model: "claude-sonnet-5",
      input_tokens: 1_000,
      output_tokens: 500,
    });
    expect(row.cost_usd).toBeCloseTo(0.007, 6);
  });

  it("기록 실패는 삼키지 않는다", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "permission denied" } });

    await expect(
      recordUsage(client, {
        userId: "user-1",
        model: "claude-sonnet-5",
        inputTokens: 1,
        outputTokens: 1,
      }),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("[P6-2] monthlyTokenUsage", () => {
  it("이번 달 것만 더한다", async () => {
    const { client, calls } = fakeSupabase({
      data: [
        { input_tokens: 1_000, output_tokens: 2_000 },
        { input_tokens: 500, output_tokens: 100 },
      ],
      error: null,
    });

    const total = await monthlyTokenUsage(client, "user-1", new Date("2026-09-11T10:00:00Z"));

    expect(calls.eq).toContainEqual(["user_id", "user-1"]);
    // 달의 시작(UTC) 이후만 센다
    expect(calls.gte).toContainEqual(["created_at", "2026-09-01T00:00:00.000Z"]);
    expect(total).toBe(3_600);
  });

  it("기록이 없으면 0", async () => {
    const { client } = fakeSupabase({ data: [], error: null });
    expect(await monthlyTokenUsage(client, "user-1", new Date())).toBe(0);
  });
});
