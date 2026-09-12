import { describe, expect, it } from "vitest";
import { recordAdminAction, listAuditLogs } from "@/lib/admin/audit";

/**
 * [P8-7a] 감사 로그 (FR-017).
 *
 * 관리자가 남의 데이터를 **본 것까지** 남긴다 — 분쟁에서 "남의 대화를
 * 엿보았느냐"는 변경만큼 중요한 질문이다(Clarify 20).
 *
 * **거부된 시도도 남긴다.** 누가 무엇을 하려 했는지가 증거다.
 * 기록이 실패해도 본 행위를 막지는 않되, **조용히 넘기지도 않는다.**
 */

function fakeAdmin(failing = false) {
  const inserted: Record<string, unknown>[] = [];
  const client = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          inserted.push(row);
          return {
            select: () => ({
              async single() {
                return failing
                  ? { data: null, error: { message: "권한 없음" } }
                  : { data: { id: "log-1" }, error: null };
              },
            }),
          };
        },
        select() {
          const chain = {
            eq: () => chain,
            order: () => chain,
            limit: () => chain,
            then: (resolve: (r: unknown) => unknown) =>
              resolve({ data: [{ id: "log-1", action: "developer:read" }], error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { client: client as never, inserted };
}

describe("[P8-7a] recordAdminAction", () => {
  it("누가·무엇을·무엇에 했는지 남긴다", async () => {
    const { client, inserted } = fakeAdmin();

    await recordAdminAction(client, {
      actorId: "admin-1",
      action: "developer:suspend",
      targetType: "profile",
      targetId: "user-9",
      detail: { reason: "불법 콘텐츠" },
    });

    expect(inserted[0]).toMatchObject({
      actor_id: "admin-1",
      action: "developer:suspend",
      target_type: "profile",
      target_id: "user-9",
      succeeded: true,
      detail: { reason: "불법 콘텐츠" },
    });
  });

  it("보기만 해도 남는다 (열람도 기록 대상이다)", async () => {
    const { client, inserted } = fakeAdmin();

    await recordAdminAction(client, { actorId: "admin-1", action: "developer:read" });

    expect(inserted[0]).toMatchObject({ action: "developer:read", succeeded: true });
  });

  it("거부된 시도도 남긴다", async () => {
    const { client, inserted } = fakeAdmin();

    await recordAdminAction(client, {
      actorId: "support-1",
      action: "developer:suspend",
      succeeded: false,
      detail: { denied: "등급 부족" },
    });

    expect(inserted[0]).toMatchObject({ succeeded: false });
  });

  it("기록이 실패해도 예외를 던지지 않되, 실패했다고 알려준다", async () => {
    const { client } = fakeAdmin(true);

    const result = await recordAdminAction(client, {
      actorId: "admin-1",
      action: "developer:read",
    });

    // 본 행위를 막지 않는다 — 던지지 않는다
    expect(result.recorded).toBe(false);
    if (!result.recorded) expect(result.message).toContain("권한 없음");
  });

  it("성공하면 그렇게 알려준다", async () => {
    const { client } = fakeAdmin();

    const result = await recordAdminAction(client, {
      actorId: "admin-1",
      action: "usage:read",
    });

    expect(result).toEqual({ recorded: true });
  });
});

describe("[P8-7a] listAuditLogs", () => {
  it("기록을 읽어온다 (보는 화면은 나중에 붙인다)", async () => {
    const { client } = fakeAdmin();

    const logs = await listAuditLogs(client, { limit: 50 });

    expect(logs).toHaveLength(1);
  });
});
