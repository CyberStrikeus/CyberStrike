import type { ProcessIdentityObservation } from "./ProcessOwnership.js";

/** Native lifecycle is independent of ownership, token readability and ps text. */
export type ProcessLifecycle = "non-zombie" | "exiting" | "zombie" | "dead";

export type ProcessLifecycleObservation =
  | { readonly state: "observed"; readonly lifecycle: ProcessLifecycle }
  | { readonly state: "unavailable"; readonly reason: string };

export const PROCESS_CLEANUP_VERIFICATION_GRACE_MS = 1_000;
export const PROCESS_CLEANUP_VERIFICATION_INTERVAL_MS = 25;

/** One operation owns a lazily started native-exit waiting window. */
export interface ProcessExitSettlementBudget {
  deadline: number | undefined;
}

export const processIdentityHasExited = (
  identity: ProcessIdentityObservation | undefined,
): boolean =>
  identity?.state === "absent" ||
  (identity?.state === "readable" &&
    identity.lifecycle?.state === "observed" &&
    (identity.lifecycle.lifecycle === "zombie" ||
      identity.lifecycle.lifecycle === "dead"));

export const processIdentityIsExiting = (
  identity: ProcessIdentityObservation | undefined,
): boolean =>
  identity?.state === "readable" &&
  identity.lifecycle?.state === "observed" &&
  identity.lifecycle.lifecycle === "exiting";
