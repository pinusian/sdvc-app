/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireLearnerAccess = vi.fn();
const getProviderCredentialStatus = vi.fn();
const registerProviderCredential = vi.fn();
const deleteProviderCredential = vi.fn();

vi.mock("@/lib/auth/learner-route-guard", () => ({
  requireLearnerAccess: (...args: unknown[]) => requireLearnerAccess(...args),
}));
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({ marker: "admin" }) }));
vi.mock("@/lib/openai/provider-credential-key", () => ({
  loadProviderCredentialKey: () => ({ keyVersion: "v1", secret: Buffer.alloc(32, 1) }),
}));
vi.mock("@/lib/openai/provider-credential-store", () => ({
  getProviderCredentialStatus: (...args: unknown[]) => getProviderCredentialStatus(...args),
  saveProviderCredential: vi.fn(),
  removeProviderCredential: vi.fn(),
}));
vi.mock("@/lib/openai/provider-credentials", () => ({
  encryptProviderCredential: vi.fn(),
  registerProviderCredential: (...args: unknown[]) => registerProviderCredential(...args),
  deleteProviderCredential: (...args: unknown[]) => deleteProviderCredential(...args),
}));

const CONFIGURED = {
  configured: true,
  maskedKey: "••••7890",
  keyVersion: "v1",
  updatedAt: "2026-09-20T06:00:00.000Z",
};

describe("[T024] /api/settings/openai-key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireLearnerAccess.mockResolvedValue({ ok: true, user: { id: "learner-1" } });
    getProviderCredentialStatus.mockResolvedValue(CONFIGURED);
    registerProviderCredential.mockResolvedValue(CONFIGURED);
    deleteProviderCredential.mockResolvedValue({
      configured: false,
      maskedKey: null,
      keyVersion: null,
      updatedAt: null,
      cancelledRunCount: 0,
    });
  });

  it("비로그인 요청은 자격 저장소를 읽기 전에 거부한다", async () => {
    requireLearnerAccess.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "로그인이 필요합니다." }, { status: 401 }),
    });
    const { GET } = await import("@/app/api/settings/openai-key/route");

    const response = await GET();

    expect(response.status).toBe(401);
    expect(getProviderCredentialStatus).not.toHaveBeenCalled();
  });

  it("조회는 등록 여부와 마스킹 정보만 반환한다", async () => {
    const { GET } = await import("@/app/api/settings/openai-key/route");

    const response = await GET();
    const body = await response.json();

    expect(body).toEqual(CONFIGURED);
    expect(JSON.stringify(body)).not.toContain("sk-proj");
  });

  it("키 등록·교체는 인증한 본인 id와 현재 등록 상태를 서버에서 정한다", async () => {
    const { PUT } = await import("@/app/api/settings/openai-key/route");

    const response = await PUT(
      new Request("http://localhost/api/settings/openai-key", {
        method: "PUT",
        body: JSON.stringify({ apiKey: "sk-proj-new-secret-7890", ownerId: "other-user" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(registerProviderCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "learner-1",
        apiKey: "sk-proj-new-secret-7890",
        replacing: true,
      }),
      expect.any(Object),
    );
  });

  it("공백 키는 저장 전에 400으로 거부한다", async () => {
    const { PUT } = await import("@/app/api/settings/openai-key/route");
    const response = await PUT(
      new Request("http://localhost/api/settings/openai-key", {
        method: "PUT",
        body: JSON.stringify({ apiKey: "   " }),
      }),
    );

    expect(response.status).toBe(400);
    expect(registerProviderCredential).not.toHaveBeenCalled();
  });

  it("삭제는 인증한 본인 자격만 제거하고 미등록 상태를 반환한다", async () => {
    const { DELETE } = await import("@/app/api/settings/openai-key/route");

    const response = await DELETE();
    const body = await response.json();

    expect(deleteProviderCredential).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "learner-1" }),
      expect.any(Object),
    );
    expect(body).toMatchObject({ configured: false, maskedKey: null });
  });
});
