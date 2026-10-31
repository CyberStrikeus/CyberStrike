# JavaScript analysis effect metadata verification

Tracks #3867 under #4027. The canonical effect record omitted existing internal
worker launches and source staging. `CapabilityInventory` and SDK registration
already consume that owner directly; no adapter override is required. The
[worker](../../src/javascript/analysis/JavaScriptAnalysisWorker.ts) creates a
private runtime root, stages `.source` files and launches an owned REA worker.
These are source-derived facts; the analyzed application code is not executed.

## Executed results

Public stdio MCP before/after:

| Surface                      | Before                         | After                                      |
| ---------------------------- | ------------------------------ | ------------------------------------------ |
| `tools/list` `openWorldHint` | `false`                        | `true`                                     |
| `binary_session` effects     | `mutatesSession`, `idempotent` | also `writesFilesystem`, `launchesProcess` |
| Session annotation flags     | `idempotent`                   | also `open_world`                          |
| Advertised tools             | 207                            | 207                                        |

Regression assertions failed on the original contract: **2 failed,
18 passed**. After correction and separating the target-free metadata case, **27 passed** across canonical effects, public
Electron/JavaScript MCP and SDK-converted catalog validity. The tests retain the
non-destructive, idempotent hints and exact session effects; no foreign target
execution is declared.

The existing real verifier analyzed official Obsidian 1.14.4 with `package.json`
and `main.js` selected, then read the typed module references and verified exact
public CLI/MCP parity. Both revisions returned the same parent/view Evidence
identities and 23-row fact digest. Query replies remained 22,158 bytes and the
selected-schema task remained 16,548 `cl100k_base` BPE tokens (204,093 with the full
name/description/inputSchema catalog projection). These are static counts, not
model billing; annotations, the separate metadata probe, host rendering/replay,
reasoning and final answers are outside this projection. No hosted agent was run.

| Complete real verifier |        Before |         After |
| ---------------------- | ------------: | ------------: |
| Elapsed seconds        |        30.470 |        31.059 |
| CPU seconds            |     29.939807 |     30.663163 |
| Peak cgroup bytes      | 1,551,282,176 | 1,584,574,464 |

The scope includes shared analysis, temporary export, CLI parity and tokenizer.
The metadata-only probe separately used 10.711/10.909 s wall,
10.503415/10.664997 s CPU and 842,891,264/853,958,656 B peak cgroup memory.
All scopes used one CPU, an 8 GiB hard cap, 6 GiB early stop and no swap; cleanup
was verified with no OOM. Memory includes charged file cache, not summed RSS.
Counters were observed at payload exit while the observer remained alive.
Fresh MCP sessions do not establish an OS-cold cache. Shared-host scheduling and
filesystem/build warmness were uncontrolled; one pair establishes neither a
performance improvement nor an equivalence bound. Linux x64 static ASAR analysis
was executed; live Electron and other platforms were not exercised locally.
[Compact records and source hashes](javascript-analysis-effects-2026-10-15.json)
preserve these distinctions without archiving the downloadable application.

## Reproduce

Use pinned Node/npm, `npm ci`, then `npm run build:cached`. Run the following as
an ES module from the checkout root (`node --input-type=module < probe.mjs`):

```javascript
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { toolAvailabilityInventory } from "./dist/contracts/toolOutputSchemaPrimitives.js";
import { withVerifierCleanup } from "./scripts/lib/verifier-cleanup.mjs";

const client = new Client({
  name: "javascript-effect-verification",
  version: "1",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["scripts/rea.mjs", "mcp"],
  stderr: "pipe",
});
await withVerifierCleanup(async () => {
  await client.connect(transport);
  transport.stderr?.resume();
  const { tools } = await client.listTools();
  const tool = tools.find(
    ({ name }) => name === "analyze_javascript_application",
  );
  assert.ok(tool);
  const response = await client.callTool({
    name: "binary_session",
    arguments: {},
  });
  assert.notEqual(response.isError, true);
  const inventory = toolAvailabilityInventory.parse(
    response.structuredContent?.result?.tool_availability,
  );
  const group = inventory.groups.find(({ names }) => names.includes(tool.name));
  assert.ok(group);
  console.log(
    JSON.stringify({
      tool: tool.name,
      advertised_annotations: tool.annotations,
      session_effects: group.effects,
      session_annotations: group.annotations,
      catalog_tool_count: tools.length,
    }),
  );
}, [() => client.close(), () => transport.close()]);
```

For the real workflow, follow the artifact acquisition/digest instructions in
[module-reference verification](javascript-module-references-2026-10-15.md).
Run its existing command with `--mode references --rounds 1 --cli-parity` and the
same selected source paths and tokenizer. That verifier is unchanged by this
fix. The preserved 8 GiB cgroup observer and its source hashes are documented in
the same guide. The machine-readable records separate metadata-probe resources
from the complete real-workflow resources.
