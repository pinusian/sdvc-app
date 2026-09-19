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
  _request: AppProvisioningRequest,
  _dependencies: AppProvisioningDependencies,
): Promise<AppProvisioningResult> {
  throw new Error("T010 application provisioning contract is not implemented");
}
