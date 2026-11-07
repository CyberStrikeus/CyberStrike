import {
  javascriptRecoveryInputSchema,
  javascriptRecoveryResultSchema,
} from "../../domain/javascript/javascriptRecovery.js";
import { toolContractMetadata } from "../toolEffects.js";
import { evidenceResultOf } from "../toolOutputSchemaPrimitives.js";
import type { ToolContract } from "../toolContractTypes.js";

/** Derived script artifacts from optional upstream recovery adapters. */
export const JAVASCRIPT_RECOVERY_TOOL_CONTRACTS = [
  {
    name: "recover_javascript_sources",
    ...toolContractMetadata("recover_javascript_sources"),
    kind: "application",
    description:
      "Recover readable modules from local UTF-8 JavaScript scripts/bundles into an absent directory, using caller-supplied Wakaru ^1.13.0 (verified with 1.14.0) on Linux x64. Use additional_paths for related chunks; each input retains its own snapshot and provenance. Returns original/derived digests, extraction byte ranges, emitted source maps, warnings and analysis_input inline. Structural splitting may fall back to one module; original names and runtime equivalence remain unknown. No application code execution. Requires util-linux prlimit; one worker, 1 GiB address-space ceiling, 120-second deadline, 64 MiB total input, 128 MiB output, 10000 entries and 8 MiB per diagnostic/report stream.",
    inputSchema: javascriptRecoveryInputSchema,
    outputSchema: evidenceResultOf(javascriptRecoveryResultSchema),
    examples: [
      {
        title: "Recover a captured production bundle",
        input: {
          path: "/tmp/web-scripts/app.js",
          output_directory: "/tmp/recovered-app",
        },
      },
      {
        title: "Recover a code-split bundle together",
        input: {
          path: "/tmp/web-scripts/main.js",
          additional_paths: [
            "/tmp/web-scripts/runtime.js",
            "/tmp/web-scripts/shared.js",
            "/tmp/web-scripts/checkout.chunk.js",
          ],
          output_directory: "/tmp/recovered-chunks",
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
