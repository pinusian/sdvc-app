import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { createPersistentRunStore } from "@/lib/execution/persistent-run-store";
import { createPersistentRun } from "@/lib/execution/persistent-runs";
import { getProjectById } from "@/lib/projects/store";
import { createDocumentWorkflowStore } from "@/lib/sdvc/document-store";
import { getDocumentWorkflowView } from "@/lib/sdvc/document-state";
import { createAdminClient } from "@/lib/supabase/server";

interface CreateRunBody {
  projectId?: unknown;
  idempotencyKey?: unknown;
}

export async function POST(request: Request) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;

  let body: CreateRunBody;
  try {
    body = (await request.json()) as CreateRunBody;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!projectId || !idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json({ error: "프로젝트와 실행 식별값이 필요합니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const project = await getProjectById(admin, projectId, access.user.id);
  if (!project) {
    return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  const documentStore = createDocumentWorkflowStore(admin);
  const view = await getDocumentWorkflowView(project.id, documentStore);
  const bundleHash = approvedBundleHash(view.documents);
  if (!bundleHash) {
    return NextResponse.json(
      { error: "계획과 작업 문서를 모두 승인한 뒤 실행해주세요." },
      { status: 409 },
    );
  }

  try {
    const run = await createPersistentRun(
      {
        ownerId: access.user.id,
        projectId: project.id,
        documentBundleHash: bundleHash,
        idempotencyKey,
        now: new Date().toISOString(),
      },
      createPersistentRunStore(admin),
    );
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "실행을 만들지 못했습니다." },
      { status: 409 },
    );
  }
}

function approvedBundleHash(
  documents: Array<{
    kind: string;
    approvedVersionId: string | null;
    versions: Array<{ id: string; contentHash: string }>;
  }>,
): string | null {
  const hashes = ["plan", "tasks"].map((kind) => {
    const document = documents.find((item) => item.kind === kind);
    if (!document?.approvedVersionId) return null;
    return document.versions.find((version) => version.id === document.approvedVersionId)
      ?.contentHash ?? null;
  });
  if (hashes.some((hash) => !hash || !/^[a-f0-9]{64}$/.test(hash))) return null;

  return createHash("sha256")
    .update(`plan:${hashes[0]}\ntasks:${hashes[1]}`, "utf8")
    .digest("hex");
}
