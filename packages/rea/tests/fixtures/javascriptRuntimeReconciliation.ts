import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createElectronEvidence } from "../../src/application/javascript/ElectronEvidence.js";
import { inspectElectronPageInputSchema } from "../../src/domain/javascript/electronObservation.js";
import { createWebTextArtifact } from "../../src/domain/webContentArtifact.js";
import { analyzeJavaScriptApplication } from "../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "./temporaryDirectory.js";

export const SOURCE = `const worker = new Worker(new URL("./worker.js", import.meta.url));\nexport const observed = worker;\n`;

export const applicationFixture = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-runtime-reconciliation-");
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "rea-runtime-reconciliation-fixture",
        version: "1.0.0",
        renderer: "index.html",
      }),
    ),
    writeFile(join(root, "index.html"), "<script src='./app.js'></script>"),
    writeFile(join(root, "app.js"), SOURCE),
    writeFile(join(root, "worker.js"), "self.onmessage = () => undefined;\n"),
  ]);
  return root;
};

export const analyzeFixture = async (root: string) => {
  const result = await analyzeJavaScriptApplication({
    input_path: root,
  });
  if (!result.ok) throw result.error;
  return result.value;
};

export const electronRuntimeEvidence = (
  root: string,
  source: string,
  options: {
    readonly scriptFile?: string;
    readonly includeWorker?: boolean;
    readonly targetId?: string;
    readonly sourceIncluded?: boolean;
    readonly workersUnavailable?: boolean;
    readonly scriptsUnavailable?: boolean;
  } = {},
) => {
  const scriptFile = options.scriptFile ?? "app.js";
  const includeWorker = options.includeWorker ?? true;
  const targetId = options.targetId ?? "target-main";
  const sourceIncluded = options.sourceIncluded ?? true;
  const input = inspectElectronPageInputSchema.parse({
    cdp_endpoint: "http://127.0.0.1:9223",
    target_id: targetId,
    observation_ms: 100,
    include_script_sources: sourceIncluded,
  });
  return createElectronEvidence(
    "inspect_electron_page",
    input,
    {
      browser: {
        product: "Electron/fixture",
        protocol_version: "1.3",
        revision: "fixture",
        user_agent: "Electron fixture",
        js_version: "13",
      },
      target: {
        target_id: targetId,
        type: "page",
        title: "Fixture",
        file_path: join(root, "index.html"),
        attached: false,
      },
      capture_window: {
        started_at: "2026-07-15T00:00:00.000Z",
        ended_at: "2026-07-15T00:00:00.100Z",
        observation_ms: 100,
      },
      completeness: captureCompleteness(options),
      frames: [
        {
          frame_id: "frame-main",
          parent_frame_id: null,
          file_path: join(root, "index.html"),
        },
      ],
      dom: { total_nodes: 0, nodes: [] },
      scripts: {
        total: 1,
        items: [
          {
            script_key: `electron_script_${"1".repeat(64)}`,
            frame_id: "frame-main",
            file_path: join(root, scriptFile),
            cdp_hash: "fixture",
            length: Buffer.byteLength(source),
            is_module: true,
            language: "JavaScript",
            source: {
              included: true as const,
              artifact: createWebTextArtifact(source, "text/javascript"),
            },
          },
        ],
      },
      resources: [],
      workers: includeWorker
        ? [
            {
              target_id: "worker-main",
              type: "worker",
              file_path: join(root, "worker.js"),
              attached: false,
              opener_target_id: targetId,
              parent_frame_id: "frame-main",
            },
          ]
        : [],
      limitations: ["Synthetic passive capture fixture."],
    },
    {
      id: "rea-cdp-electron",
      name: "REA Electron file-page CDP observation provider",
      version: "1",
    },
  );
};

const completeCapture = () => ({
  status: "complete_within_window" as const,
  conditions: ["complete_within_window" as const],
  policy_filtered_sections: [],
  attach_limited_sections: [],
  truncated_sections: [],
  unavailable_sections: [],
  excluded: [],
  dropped_events: {
    scripts: 0,
    network_requests: 0,
    console_events: 0,
    websocket_connections: 0,
    websocket_frames: 0,
    webmcp_tools: 0,
    timeline_events: 0,
    total: 0,
  },
});

const captureCompleteness = (options: {
  readonly workersUnavailable?: boolean;
  readonly scriptsUnavailable?: boolean;
}) => {
  const unavailableSections = [
    ...(options.scriptsUnavailable ? (["scripts"] as const) : []),
    ...(options.workersUnavailable ? (["workers"] as const) : []),
  ];
  if (unavailableSections.length === 0) return completeCapture();
  return {
    ...completeCapture(),
    status: "attach_limited" as const,
    conditions: ["attach_limited" as const],
    attach_limited_sections: unavailableSections,
    unavailable_sections: unavailableSections,
  };
};
