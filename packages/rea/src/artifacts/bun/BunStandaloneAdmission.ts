import type { StableRegularFileDescriptor } from "../../filesystem/RegularFile.js";
import type { BunStandaloneProbe } from "./BunModuleGraphLayout.js";

/** Header and suffix facts belong to this exact admitted carrier. */
export interface BunStandaloneAdmission {
  readonly kind: "bun-standalone";
  readonly source: StableRegularFileDescriptor;
  readonly probe: Extract<BunStandaloneProbe, { readonly status: "present" }>;
}
