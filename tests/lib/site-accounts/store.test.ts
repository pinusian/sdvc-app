import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createSiteUser,
  findSiteUserByEmail,
  suspendSiteUser,
  unsuspendSiteUser,
  setSiteUserApiKey,
  getSiteUserApiKey,
  createSiteRecord,
  listSiteRecordsByUser,
  listSiteUsersByProject,
  getSiteUserById,
  getOwnedSiteUser,
  hasSiteUserApiKey,
} from "@/lib/site-accounts/store";

/**
 * [P11-1] 사용자(방문자) 계정·기록 저장소 단위 테스트.
 *
 * [P3-4]와 같은 구조 — Supabase 클라이언트를 주입받아 실제 DB 없이
 * 호출 형태와 격리 조건(project_id)을 검증한다.
 */

type Result = { data: unknown; error: unknown };

function fakeSupabase(result: Result = { data: null, error: null }) {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, ...args: unknown[]) => {
    (calls[name] ??= []).push(args.length === 1 ? args[0] : args);
  };

  const builder: Record<string, unknown> = {};
  for (const name of ["insert", "select", "update", "eq", "in", "order", "limit"]) {
    builder[name] = (...args: unknown[]) => {
      record(name, ...args);
      return builder;
    };
  }
  builder.single = () => {
    record("single");
    return Promise.resolve(result);
  };
  builder.maybeSingle = () => {
    record("maybeSingle");
    return Promise.resolve(result);
  };
  builder.then = (resolve: (value: Result) => unknown) => resolve(result);

  const client = {
    from: (table: string) => {
      record("from", table);
      return builder;
    },
  };

  return { client: client as never, calls };
}

describe("[P11-1] createSiteUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("프로젝트 id·이메일·비밀번호 해시를 함께 저장한다", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "su-1", project_id: "proj-1", email: "a@b.com", display_name: null },
      error: null,
    });

    const user = await createSiteUser(client, {
      projectId: "proj-1",
      email: "a@b.com",
      passwordHash: "hashed-value",
    });

    expect(calls.from).toContain("site_users");
    expect(user.id).toBe("su-1");
    expect(user.projectId).toBe("proj-1");
  });

  it("빈 이메일은 거부한다 — DB까지 안 간다", async () => {
    const { client } = fakeSupabase();
    await expect(
      createSiteUser(client, { projectId: "proj-1", email: "  ", passwordHash: "x" }),
    ).rejects.toThrow();
  });
});

describe("[P11-1] findSiteUserByEmail — project_id로 격리", () => {
  beforeEach(() => vi.clearAllMocks());

  it("같은 프로젝트 안에서만 찾는다 (남의 프로젝트 계정과 이메일이 같아도 안 섞인다)", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "su-1", project_id: "proj-1", email: "a@b.com", display_name: null },
      error: null,
    });

    await findSiteUserByEmail(client, { projectId: "proj-1", email: "a@b.com" });

    // eq가 project_id와 email(대소문자 무시) 둘 다로 걸려야 한다
    const eqCalls = (calls.eq ?? []) as unknown[];
    const columns = eqCalls.map((c) => (Array.isArray(c) ? c[0] : c));
    expect(columns).toContain("project_id");
  });
});

describe("[P11-6] suspendSiteUser / unsuspendSiteUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("정지하면 suspended_at·사유가 함께 저장된다", async () => {
    const { client, calls } = fakeSupabase({ data: { id: "su-1" }, error: null });
    await suspendSiteUser(client, { siteUserId: "su-1", reason: "도배성 기록 작성" });

    const updateCalls = (calls.update ?? []) as unknown[];
    const payload = updateCalls[0] as Record<string, unknown>;
    expect(payload.suspended_reason).toBe("도배성 기록 작성");
    expect(payload.suspended_at).toBeTruthy();
  });

  it("해제하면 suspended_at을 null로 되돌린다", async () => {
    const { client, calls } = fakeSupabase({ data: { id: "su-1" }, error: null });
    await unsuspendSiteUser(client, "su-1");

    const updateCalls = (calls.update ?? []) as unknown[];
    const payload = updateCalls[0] as Record<string, unknown>;
    expect(payload.suspended_at).toBeNull();
  });
});

describe("[P11-4] setSiteUserApiKey / getSiteUserApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SITE_API_KEY_ENCRYPTION_SECRET = "test-secret-32-bytes-minimum!!!!";
  });
  afterEach(() => {
    delete process.env.SITE_API_KEY_ENCRYPTION_SECRET;
  });

  it("저장할 때 평문이 아니라 암호화된 값을 넣는다", async () => {
    const { client, calls } = fakeSupabase({ data: { id: "su-1" }, error: null });
    await setSiteUserApiKey(client, { siteUserId: "su-1", apiKey: "sk-ant-real-value" });

    const updateCalls = (calls.update ?? []) as unknown[];
    const payload = updateCalls[0] as Record<string, unknown>;
    expect(payload.anthropic_api_key_encrypted).not.toContain("sk-ant-real-value");
  });

  it("읽어올 때는 원래 키로 복호화해 돌려준다", async () => {
    const { client: writeClient, calls } = fakeSupabase({ data: { id: "su-1" }, error: null });
    await setSiteUserApiKey(writeClient, { siteUserId: "su-1", apiKey: "sk-ant-real-value" });
    const stored = ((calls.update as unknown[])[0] as Record<string, unknown>)
      .anthropic_api_key_encrypted as string;

    const { client: readClient } = fakeSupabase({
      data: { anthropic_api_key_encrypted: stored },
      error: null,
    });
    const key = await getSiteUserApiKey(readClient, "su-1");
    expect(key).toBe("sk-ant-real-value");
  });

  it("키를 등록하지 않은 사용자는 null을 돌려준다 (AI 기능이 그 사람에게만 막힌다)", async () => {
    const { client } = fakeSupabase({
      data: { anthropic_api_key_encrypted: null },
      error: null,
    });
    expect(await getSiteUserApiKey(client, "su-2")).toBeNull();
  });
});

describe("[P11-4] hasSiteUserApiKey — 화면에 '등록됨'만 보여줄 때 (복호화 없이)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("등록돼 있으면 true", async () => {
    const { client } = fakeSupabase({
      data: { anthropic_api_key_encrypted: "iv:tag:cipher" },
      error: null,
    });
    expect(await hasSiteUserApiKey(client, "su-1")).toBe(true);
  });

  it("등록 안 돼 있으면 false", async () => {
    const { client } = fakeSupabase({
      data: { anthropic_api_key_encrypted: null },
      error: null,
    });
    expect(await hasSiteUserApiKey(client, "su-1")).toBe(false);
  });
});

describe("[P11-1] site_records — 기록 CRUD", () => {
  beforeEach(() => vi.clearAllMocks());

  it("기록을 만들면 project_id·site_user_id가 함께 저장된다 (남의 것과 격리)", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "rec-1", project_id: "proj-1", site_user_id: "su-1", title: "구의 증명" },
      error: null,
    });

    await createSiteRecord(client, {
      projectId: "proj-1",
      siteUserId: "su-1",
      title: "구의 증명",
    });

    const insertCalls = (calls.insert ?? []) as unknown[];
    const payload = insertCalls[0] as Record<string, unknown>;
    expect(payload.project_id).toBe("proj-1");
    expect(payload.site_user_id).toBe("su-1");
  });

  it("제목 없는 기록은 거부한다", async () => {
    const { client } = fakeSupabase();
    await expect(
      createSiteRecord(client, { projectId: "proj-1", siteUserId: "su-1", title: "  " }),
    ).rejects.toThrow();
  });

  it("본인 기록 목록 조회는 project_id와 site_user_id 둘 다로 건다", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listSiteRecordsByUser(client, { projectId: "proj-1", siteUserId: "su-1" });

    const eqCalls = (calls.eq ?? []) as unknown[];
    const columns = eqCalls.map((c) => (Array.isArray(c) ? c[0] : c));
    expect(columns).toContain("project_id");
    expect(columns).toContain("site_user_id");
  });
});

describe("[P11-3] getSiteUserById — 요청마다 본인 확인·정지 여부 검사용", () => {
  beforeEach(() => vi.clearAllMocks());

  it("id로 찾을 때 eq 조건을 건다", async () => {
    const { client, calls } = fakeSupabase({
      data: { id: "su-1", project_id: "proj-1", email: "a@b.com", display_name: null },
      error: null,
    });

    const user = await getSiteUserById(client, "su-1");

    expect(calls.eq).toContainEqual(["id", "su-1"]);
    expect(user?.id).toBe("su-1");
  });

  it("없는 id는 null을 준다", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await getSiteUserById(client, "no-such-id")).toBeNull();
  });

  it("정지 여부·사유를 함께 돌려준다 — 요청마다 이걸로 막는다", async () => {
    const { client } = fakeSupabase({
      data: {
        id: "su-1",
        project_id: "proj-1",
        email: "a@b.com",
        display_name: null,
        suspended_at: "2026-09-01T00:00:00Z",
        suspended_reason: "도배성 기록 작성",
      },
      error: null,
    });

    const user = await getSiteUserById(client, "su-1");
    expect(user?.suspendedAt).toBe("2026-09-01T00:00:00Z");
    expect(user?.suspendedReason).toBe("도배성 기록 작성");
  });
});

describe("[P11-6] getOwnedSiteUser — 그 프로젝트 소속인지 확인하고서만 돌려준다", () => {
  beforeEach(() => vi.clearAllMocks());

  it("프로젝트가 일치하면 사용자를 돌려준다", async () => {
    const { client } = fakeSupabase({
      data: { id: "su-1", project_id: "proj-1", email: "a@b.com", display_name: null },
      error: null,
    });

    const user = await getOwnedSiteUser(client, { projectId: "proj-1", siteUserId: "su-1" });
    expect(user?.id).toBe("su-1");
  });

  it("다른 프로젝트 소속이면 null (id만 알아내 정지·기록 열람을 막는다)", async () => {
    const { client } = fakeSupabase({
      data: { id: "su-1", project_id: "proj-2", email: "a@b.com", display_name: null },
      error: null,
    });

    expect(await getOwnedSiteUser(client, { projectId: "proj-1", siteUserId: "su-1" })).toBeNull();
  });

  it("사용자 자체가 없으면 null", async () => {
    const { client } = fakeSupabase({ data: null, error: null });
    expect(await getOwnedSiteUser(client, { projectId: "proj-1", siteUserId: "no-such-id" })).toBeNull();
  });
});

describe("[P11-6] listSiteUsersByProject — 개발자(교수) 관리 화면용", () => {
  beforeEach(() => vi.clearAllMocks());

  it("그 프로젝트의 사용자만 project_id로 걸러 돌려준다", async () => {
    const { client, calls } = fakeSupabase({ data: [], error: null });
    await listSiteUsersByProject(client, "proj-1");

    const eqCalls = (calls.eq ?? []) as unknown[];
    const columns = eqCalls.map((c) => (Array.isArray(c) ? c[0] : c));
    expect(columns).toContain("project_id");
  });
});
