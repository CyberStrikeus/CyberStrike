import { z } from "zod";

/** Observed Cutter session identity without bridge transport credentials. */
export const cutterSessionSchema = z.strictObject({
  session_id: z.string().uuid(),
  pid: z.int().positive(),
  document_generation: z.int().nonnegative(),
  current_file: z.string().nullable(),
  cutter_version: z.string().nullable(),
  identity_status: z.literal("partial"),
});

/** Discovery facts retained independently of descriptor cleanup. */
export const cutterDiscoverySchema = z.strictObject({
  sessions: z.array(cutterSessionSchema),
  bridge_directory: z.string(),
  discovery_status: z.enum([
    "sessions_found",
    "no_live_bridge_found",
    "bridge_directory_unavailable",
    "bridge_directory_insecure",
    "bridge_directory_capacity_exceeded",
  ]),
  bridge_directory_security: z.enum([
    "private_verified",
    "not_private",
    "unverified_platform_acl",
    "not_checked",
  ]),
});

export type CutterBridgeSession = z.infer<typeof cutterSessionSchema>;

export type CutterBridgeDiscovery = Readonly<
  Omit<z.infer<typeof cutterDiscoverySchema>, "sessions">
> & {
  readonly sessions: readonly CutterBridgeSession[];
};
