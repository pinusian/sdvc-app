import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  DocumentApproval,
  DocumentKind,
  DocumentVersion,
  DocumentWorkflowDependencies,
  SdvcStage,
} from "@/lib/sdvc/document-state";

function assertNoError(error: { message?: string } | null) {
  if (error) throw new Error(error.message ?? "문서 저장소 오류");
}

function toVersion(row: Record<string, unknown>): DocumentVersion {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: row.kind as DocumentKind,
    version: Number(row.version),
    content: String(row.content),
    contentHash: String(row.content_hash),
    createdAt: String(row.created_at),
  };
}

function toApproval(row: Record<string, unknown>): DocumentApproval {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    kind: row.kind as "plan" | "tasks",
    versionId: String(row.version_id),
    approvedBy: String(row.approved_by),
    approvedAt: String(row.approved_at),
  };
}

export const createDocumentWorkflowStore = (
  client: SupabaseClient,
): DocumentWorkflowDependencies => ({
  async getLatestVersion(projectId, kind) {
    const { data, error } = await client
      .from("document_versions")
      .select("id, project_id, kind, version, content, content_hash, created_at")
      .eq("project_id", projectId)
      .eq("kind", kind)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    assertNoError(error);
    return data ? toVersion(data as Record<string, unknown>) : null;
  },

  async insertVersion(input) {
    const { data, error } = await client
      .from("document_versions")
      .insert({
        project_id: input.projectId,
        kind: input.kind,
        version: input.version,
        content: input.content,
        content_hash: input.contentHash,
        created_at: input.createdAt,
      })
      .select("id, project_id, kind, version, content, content_hash, created_at")
      .single();
    assertNoError(error);
    return toVersion(data as Record<string, unknown>);
  },

  async invalidateApprovals({ projectId, kinds, invalidatedAt }) {
    const { error } = await client
      .from("document_approvals")
      .update({ invalidated_at: invalidatedAt })
      .eq("project_id", projectId)
      .in("kind", [...kinds])
      .is("invalidated_at", null);
    assertNoError(error);
  },

  async getApproval({ projectId, kind, versionId }) {
    const { data, error } = await client
      .from("document_approvals")
      .select("id, project_id, kind, version_id, approved_by, approved_at")
      .eq("project_id", projectId)
      .eq("kind", kind)
      .eq("version_id", versionId)
      .is("invalidated_at", null)
      .maybeSingle();
    assertNoError(error);
    return data ? toApproval(data as Record<string, unknown>) : null;
  },

  async insertApproval(input) {
    const { data, error } = await client
      .from("document_approvals")
      .insert({
        project_id: input.projectId,
        kind: input.kind,
        version_id: input.versionId,
        approved_by: input.approvedBy,
        approved_at: input.approvedAt,
      })
      .select("id, project_id, kind, version_id, approved_by, approved_at")
      .single();
    assertNoError(error);
    return toApproval(data as Record<string, unknown>);
  },

  async getCurrentStage(projectId) {
    const { data, error } = await client
      .from("document_workflows")
      .select("current_stage")
      .eq("project_id", projectId)
      .maybeSingle();
    assertNoError(error);
    return (data?.current_stage as SdvcStage | undefined) ?? "constitution";
  },

  async setCurrentStage(projectId, stage) {
    const { error } = await client.from("document_workflows").upsert(
      { project_id: projectId, current_stage: stage, updated_at: new Date().toISOString() },
      { onConflict: "project_id" },
    );
    assertNoError(error);
  },
});
