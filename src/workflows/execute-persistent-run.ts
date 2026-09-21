import { createClient } from "@supabase/supabase-js";
import {
  executePersistentRun,
  type PersistentRunWorkerInput,
} from "@/lib/execution/persistent-run-worker";
import { createPersistentRunStore } from "@/lib/execution/persistent-run-store";
import { createVercelSandboxPort } from "@/lib/execution/vercel-sandbox-port";

export type ExecutePersistentRunWorkflowInput = Omit<
  PersistentRunWorkerInput,
  "startedAt" | "leaseExpiresAt" | "signal"
>;

export async function executePersistentRunWorkflow(
  input: ExecutePersistentRunWorkflowInput,
) {
  "use workflow";
  return executePersistentRunStep(input);
}

async function executePersistentRunStep(input: ExecutePersistentRunWorkflowInput) {
  "use step";

  const startedAt = new Date();
  const leaseExpiresAt = new Date(startedAt.getTime() + 5 * 60_000);
  const client = createClient(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("SUPABASE_SECRET_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  return executePersistentRun(
    {
      ...input,
      startedAt: startedAt.toISOString(),
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    },
    {
      store: createPersistentRunStore(client),
      sandbox: createVercelSandboxPort(),
    },
  );
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
