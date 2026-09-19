/**
 * T013 RED contract only.
 *
 * T014 prepares the persisted account restriction state and T015 replaces this
 * placeholder with the server-side learner access guard.
 */

export interface LearnerIdentity {
  id: string;
}

export interface LearnerProfile {
  role: string;
  isActive: boolean;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

export interface LearnerGuardDependencies {
  getAuthenticatedUser(): Promise<LearnerIdentity | null>;
  loadProfile(userId: string): Promise<LearnerProfile | null>;
}

export interface LearnerAccessOptions {
  ownerId?: string;
}

export type LearnerAccessResult =
  | { ok: true; actor: { id: string; role: "developer" } }
  | {
      ok: false;
      status: 401 | 403 | 404;
      code:
        | "unauthenticated"
        | "account_inactive"
        | "account_suspended"
        | "account_unavailable"
        | "not_found";
      message: string;
    };

export interface LearnerGuard {
  requireAccess(options?: LearnerAccessOptions): Promise<LearnerAccessResult>;
}

export function createLearnerGuard(_deps: LearnerGuardDependencies): LearnerGuard {
  void _deps;
  return {
    async requireAccess(): Promise<LearnerAccessResult> {
      throw new Error("T013 learner access guard is not implemented");
    },
  };
}
