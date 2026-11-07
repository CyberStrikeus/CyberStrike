import { selectCdpDiscoveryTarget } from "./CdpDiscoveryTargets.js";
import { sanitizeBrowserUrl } from "../domain/browserObservation.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import type { BrowserObservationOperation } from "../domain/browserObservationErrors.js";
import type { CdpEndpointDiscovery, CdpEndpointTarget } from "./CdpEndpoint.js";

/** Select one page target and derive its origin scope before opening a CDP session. */
export const authorizeCdpTarget = (
  discovery: CdpEndpointDiscovery,
  input: {
    readonly target_id: string;
    readonly allowed_origins: readonly string[];
  },
  operation: BrowserObservationOperation,
): {
  readonly target: CdpEndpointTarget;
  readonly allowedOrigins: ReadonlySet<string>;
} => {
  const target = selectCdpDiscoveryTarget(
    discovery.targets,
    input.target_id,
    operation,
    discovery.ambiguousTargetIds,
  );
  if (target === undefined)
    throw new BrowserObservationError(operation, "target_not_found", {
      detail: `Target ${input.target_id} was not found at the selected endpoint.`,
      remediationAction:
        "Refresh target discovery for that endpoint and retry with a returned target ID.",
    });
  const origin = sanitizeBrowserUrl(target.url).origin;
  if (
    target.type !== "page" ||
    origin === null ||
    (input.allowed_origins.length > 0 &&
      !input.allowed_origins.includes(origin))
  )
    throw new BrowserObservationError(operation, "target_not_allowed", {
      detail: `Target ${input.target_id} must be an HTTP(S) page in the selected origin scope.`,
    });
  return {
    target,
    allowedOrigins: new Set(
      input.allowed_origins.length > 0 ? input.allowed_origins : [origin],
    ),
  };
};
