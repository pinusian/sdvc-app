export interface AppProvisioningRequest {
  runId: string;
  appName: string;
  sourceRevision: string;
  supabaseCredentialId: string;
  vercelCredentialId: string;
}

export type SupabaseProjectStatus = "INACTIVE" | "COMING_UP" | "ACTIVE_HEALTHY" | "UNKNOWN";
export type VercelDeploymentState =
  | "QUEUED"
  | "INITIALIZING"
  | "BUILDING"
  | "READY"
  | "ERROR";

export interface SupabaseProvisioningPort {
  createProject(input: {
    token: string;
    name: string;
    idempotencyKey: string;
  }): Promise<{ ref: string; status: SupabaseProjectStatus }>;
  getProject(input: {
    token: string;
    ref: string;
  }): Promise<{ ref: string; status: SupabaseProjectStatus }>;
}

export interface VercelProvisioningPort {
  createProject(input: {
    token: string;
    name: string;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  createDeployment(input: {
    token: string;
    projectId: string;
    sourceRevision: string;
    idempotencyKey: string;
  }): Promise<{ id: string; readyState: VercelDeploymentState; url?: string }>;
  getDeployment(input: {
    token: string;
    deploymentId: string;
  }): Promise<{ id: string; readyState: VercelDeploymentState; url?: string }>;
}

export interface AppProvisioningDependencies {
  loadCredential(credentialId: string): Promise<string | null>;
  supabase: SupabaseProvisioningPort;
  vercel: VercelProvisioningPort;
  probeUrl(url: string): Promise<{ ok: boolean; status: number }>;
  maxPollAttempts: number;
}

export interface AppProvisioningResult {
  status: "ready" | "unverified";
  reason?: "credential_missing" | "database_not_ready" | "deployment_not_ready" | "url_unreachable";
  supabaseProjectRef?: string;
  vercelProjectId?: string;
  deploymentId?: string;
  url?: string;
}

export async function provisionTrialApplication(
  request: AppProvisioningRequest,
  dependencies: AppProvisioningDependencies,
): Promise<AppProvisioningResult> {
  const [supabaseToken, vercelToken] = await Promise.all([
    dependencies.loadCredential(request.supabaseCredentialId),
    dependencies.loadCredential(request.vercelCredentialId),
  ]);
  if (!supabaseToken || !vercelToken) {
    return { status: "unverified", reason: "credential_missing" };
  }

  const database = await dependencies.supabase.createProject({
    token: supabaseToken,
    name: request.appName,
    idempotencyKey: `${request.runId}:supabase`,
  });
  const readyDatabase = await pollUntil(
    database,
    (project) => project.status === "ACTIVE_HEALTHY",
    () => dependencies.supabase.getProject({ token: supabaseToken, ref: database.ref }),
    dependencies.maxPollAttempts,
  );
  if (readyDatabase.status !== "ACTIVE_HEALTHY") {
    return {
      status: "unverified",
      reason: "database_not_ready",
      supabaseProjectRef: database.ref,
    };
  }

  const project = await dependencies.vercel.createProject({
    token: vercelToken,
    name: request.appName,
    idempotencyKey: `${request.runId}:vercel-project`,
  });
  const deployment = await dependencies.vercel.createDeployment({
    token: vercelToken,
    projectId: project.id,
    sourceRevision: request.sourceRevision,
    idempotencyKey: `${request.runId}:deployment`,
  });
  const readyDeployment = await pollUntil(
    deployment,
    (item) => item.readyState === "READY" || item.readyState === "ERROR",
    () => dependencies.vercel.getDeployment({ token: vercelToken, deploymentId: deployment.id }),
    dependencies.maxPollAttempts,
  );
  if (readyDeployment.readyState !== "READY" || !isHttpsUrl(readyDeployment.url)) {
    return {
      status: "unverified",
      reason: readyDeployment.readyState === "READY" ? "url_unreachable" : "deployment_not_ready",
      supabaseProjectRef: database.ref,
      vercelProjectId: project.id,
      deploymentId: deployment.id,
    };
  }

  const probe = await dependencies.probeUrl(readyDeployment.url);
  if (!probe.ok) {
    return {
      status: "unverified",
      reason: "url_unreachable",
      supabaseProjectRef: database.ref,
      vercelProjectId: project.id,
      deploymentId: deployment.id,
      url: readyDeployment.url,
    };
  }

  return {
    status: "ready",
    supabaseProjectRef: database.ref,
    vercelProjectId: project.id,
    deploymentId: deployment.id,
    url: readyDeployment.url,
  };
}

async function pollUntil<T>(
  initial: T,
  done: (value: T) => boolean,
  poll: () => Promise<T>,
  maxPollAttempts: number,
): Promise<T> {
  let current = initial;
  for (let attempt = 0; !done(current) && attempt < maxPollAttempts; attempt += 1) {
    current = await poll();
  }
  return current;
}

function isHttpsUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
