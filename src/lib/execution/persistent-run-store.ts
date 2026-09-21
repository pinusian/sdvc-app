import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PersistentRun,
  PersistentRunDependencies,
  PersistentRunEvent,
  PersistentRunStatus,
  TestEvidenceRecord,
} from "@/lib/execution/persistent-runs";

export interface PersistentRunStore extends PersistentRunDependencies {
  claimLease(input: {
    runId: string;
    workerId: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<PersistentRun | null>;
  appendEvent(input: {
    runId: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
    dedupeKey?: string;
  }): Promise<PersistentRunEvent>;
  insertTestEvidence(input: TestEvidenceRecord): Promise<void>;
  finishRun(input: {
    runId: string;
    workerId: string;
    status: "cancelled" | "succeeded" | "failed";
    finishedAt: string;
  }): Promise<void>;
}

function assertNoError(error: { message?: string } | null) {
  if (error) throw new Error(error.message ?? "지속 작업 저장소 오류");
}

function toRun(row: Record<string, unknown>): PersistentRun {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    projectId: String(row.project_id),
    documentBundleHash: String(row.document_bundle_hash),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as PersistentRunStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toEvent(row: Record<string, unknown>): PersistentRunEvent {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    type: String(row.event_type),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

export const createPersistentRunStore = (client: SupabaseClient): PersistentRunStore => ({
  async isLearnerActive(ownerId) {
    const { data, error } = await client
      .from("profiles")
      .select("is_active, suspended_at")
      .eq("id", ownerId)
      .maybeSingle();
    assertNoError(error);
    return data?.is_active === true && data.suspended_at == null;
  },

  async findByIdempotency(ownerId, idempotencyKey) {
    const { data, error } = await client
      .from("runs")
      .select("*")
      .eq("owner_id", ownerId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    assertNoError(error);
    return data ? toRun(data as Record<string, unknown>) : null;
  },

  async insertRun(input) {
    const { data, error } = await client
      .rpc("create_persistent_run", {
        p_owner_id: input.ownerId,
        p_project_id: input.projectId,
        p_document_bundle_hash: input.documentBundleHash,
        p_idempotency_key: input.idempotencyKey,
        p_now: input.createdAt,
      })
      .single();
    assertNoError(error);
    return toRun(data as Record<string, unknown>);
  },

  async getOwnedRun(runId, ownerId) {
    const { data, error } = await client
      .from("runs")
      .select("*")
      .eq("id", runId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    assertNoError(error);
    return data ? toRun(data as Record<string, unknown>) : null;
  },

  async listEvents(runId) {
    const { data, error } = await client
      .from("run_events")
      .select("*")
      .eq("run_id", runId)
      .order("sequence", { ascending: true });
    assertNoError(error);
    return ((data ?? []) as Record<string, unknown>[]).map(toEvent);
  },

  async requestCancellation(runId, now) {
    const { data, error } = await client
      .from("runs")
      .update({
        status: "cancel_requested",
        cancellation_requested_at: now,
        updated_at: now,
      })
      .eq("id", runId)
      .in("status", ["queued", "running"])
      .select("*")
      .single();
    assertNoError(error);
    return toRun(data as Record<string, unknown>);
  },

  async claimLease(input) {
    const { data, error } = await client
      .rpc("claim_run_lease", {
        p_run_id: input.runId,
        p_worker_id: input.workerId,
        p_now: input.now,
        p_lease_expires_at: input.leaseExpiresAt,
      })
      .maybeSingle();
    assertNoError(error);
    return data ? toRun(data as Record<string, unknown>) : null;
  },

  async appendEvent(input) {
    const { data, error } = await client
      .rpc("append_run_event", {
        p_run_id: input.runId,
      p_event_type: input.type,
      p_payload: input.payload,
      p_dedupe_key: input.dedupeKey ?? null,
      p_created_at: input.createdAt,
      })
      .single();
    assertNoError(error);
    return toEvent(data as Record<string, unknown>);
  },

  async insertTestEvidence(input) {
    const { error } = await client.from("test_evidence").upsert({
      run_id: input.runId,
      phase: input.phase,
      code_hash: input.codeHash,
      test_hash: input.testHash,
      command: input.command,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      exit_code: input.exitCode,
      log_path: input.logPath,
    }, { onConflict: "run_id,phase,code_hash,test_hash" });
    assertNoError(error);
  },

  async finishRun(input) {
    const { error } = await client.rpc("finish_persistent_run", {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_status: input.status,
      p_finished_at: input.finishedAt,
    });
    assertNoError(error);
  },
});
