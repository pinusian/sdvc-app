import { describe, expect, it, vi } from "vitest";
import {
  provisionTrialApplication,
  type AppProvisioningDependencies,
  type AppProvisioningRequest,
} from "@/lib/provisioning/app-provisioner";

const SUPABASE_TOKEN = "supabase-management-secret";
const VERCEL_TOKEN = "vercel-management-secret";

const REQUEST: AppProvisioningRequest = {
  runId: "run-010",
  appName: "student-reading-log",
  sourceRevision: "sha256:verified-source",
  supabaseCredentialId: "credential-supabase",
  vercelCredentialId: "credential-vercel",
};

function dependencies(): AppProvisioningDependencies & {
  loadCredential: ReturnType<typeof vi.fn<AppProvisioningDependencies["loadCredential"]>>;
  supabase: {
    createProject: ReturnType<typeof vi.fn<AppProvisioningDependencies["supabase"]["createProject"]>>;
    getProject: ReturnType<typeof vi.fn<AppProvisioningDependencies["supabase"]["getProject"]>>;
  };
  vercel: {
    createProject: ReturnType<typeof vi.fn<AppProvisioningDependencies["vercel"]["createProject"]>>;
    createDeployment: ReturnType<typeof vi.fn<AppProvisioningDependencies["vercel"]["createDeployment"]>>;
    getDeployment: ReturnType<typeof vi.fn<AppProvisioningDependencies["vercel"]["getDeployment"]>>;
  };
  probeUrl: ReturnType<typeof vi.fn<AppProvisioningDependencies["probeUrl"]>>;
} {
  const loadCredential = vi.fn<AppProvisioningDependencies["loadCredential"]>()
    .mockImplementation(async (credentialId) =>
      credentialId === "credential-supabase" ? SUPABASE_TOKEN : VERCEL_TOKEN,
    );
  const supabase = {
    createProject: vi.fn<AppProvisioningDependencies["supabase"]["createProject"]>()
      .mockResolvedValue({ ref: "db-ref", status: "COMING_UP" }),
    getProject: vi.fn<AppProvisioningDependencies["supabase"]["getProject"]>()
      .mockResolvedValue({ ref: "db-ref", status: "ACTIVE_HEALTHY" }),
  };
  const vercel = {
    createProject: vi.fn<AppProvisioningDependencies["vercel"]["createProject"]>()
      .mockResolvedValue({ id: "project-id" }),
    createDeployment: vi.fn<AppProvisioningDependencies["vercel"]["createDeployment"]>()
      .mockResolvedValue({ id: "deployment-id", readyState: "BUILDING" }),
    getDeployment: vi.fn<AppProvisioningDependencies["vercel"]["getDeployment"]>()
      .mockResolvedValue({
        id: "deployment-id",
        readyState: "READY",
        url: "https://student-reading-log.example.test",
      }),
  };
  const probeUrl = vi.fn<AppProvisioningDependencies["probeUrl"]>()
    .mockResolvedValue({ ok: true, status: 200 });

  return { loadCredential, supabase, vercel, probeUrl, maxPollAttempts: 2 };
}

describe("[T010] 앱 리소스 준비·배포 계약", () => {
  it("DB 준비, 배포 READY, HTTPS URL 확인이 모두 끝나야 ready다", async () => {
    const deps = dependencies();

    const result = await provisionTrialApplication(REQUEST, deps);

    expect(result).toEqual({
      status: "ready",
      supabaseProjectRef: "db-ref",
      vercelProjectId: "project-id",
      deploymentId: "deployment-id",
      url: "https://student-reading-log.example.test",
    });
    expect(deps.probeUrl).toHaveBeenCalledWith("https://student-reading-log.example.test");
  });

  it("Supabase가 준비되지 않으면 배포를 시작하지 않는다", async () => {
    const deps = dependencies();
    deps.supabase.getProject.mockResolvedValue({ ref: "db-ref", status: "COMING_UP" });

    const result = await provisionTrialApplication(REQUEST, deps);

    expect(result).toMatchObject({ status: "unverified", reason: "database_not_ready" });
    expect(deps.vercel.createProject).not.toHaveBeenCalled();
    expect(deps.vercel.createDeployment).not.toHaveBeenCalled();
  });

  it("배포 ID만 생성되고 READY가 아니면 완료로 처리하지 않는다", async () => {
    const deps = dependencies();
    deps.vercel.getDeployment.mockResolvedValue({
      id: "deployment-id",
      readyState: "BUILDING",
    });

    const result = await provisionTrialApplication(REQUEST, deps);

    expect(result).toMatchObject({ status: "unverified", reason: "deployment_not_ready" });
    expect(deps.probeUrl).not.toHaveBeenCalled();
  });

  it("ERROR 배포는 URL이 있어도 성공으로 처리하지 않는다", async () => {
    const deps = dependencies();
    deps.vercel.getDeployment.mockResolvedValue({
      id: "deployment-id",
      readyState: "ERROR",
      url: "https://failed.example.test",
    });

    const result = await provisionTrialApplication(REQUEST, deps);

    expect(result).toMatchObject({ status: "unverified", reason: "deployment_not_ready" });
    expect(deps.probeUrl).not.toHaveBeenCalled();
  });

  it("READY라도 HTTPS URL 점검이 실패하면 미검증으로 남긴다", async () => {
    const deps = dependencies();
    deps.probeUrl.mockResolvedValue({ ok: false, status: 503 });

    const result = await provisionTrialApplication(REQUEST, deps);

    expect(result).toMatchObject({ status: "unverified", reason: "url_unreachable" });
  });

  it("영속 요청에는 관리 토큰 대신 자격 참조만 둔다", () => {
    expect(REQUEST).not.toHaveProperty("supabaseToken");
    expect(REQUEST).not.toHaveProperty("vercelToken");
    expect(JSON.stringify(REQUEST)).not.toContain(SUPABASE_TOKEN);
    expect(JSON.stringify(REQUEST)).not.toContain(VERCEL_TOKEN);
  });

  it("재시도해도 같은 실행 기반 멱등 키를 공급자 호출에 사용한다", async () => {
    const deps = dependencies();

    await provisionTrialApplication(REQUEST, deps);

    expect(deps.supabase.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "run-010:supabase" }),
    );
    expect(deps.vercel.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "run-010:vercel-project" }),
    );
    expect(deps.vercel.createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "run-010:deployment" }),
    );
  });
});
