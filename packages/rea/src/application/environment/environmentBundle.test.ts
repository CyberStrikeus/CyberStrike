import { describe, expect, it } from "vitest";

import { timedCaptureEvidence } from "../../../tests/fixtures/analysisView.js";
import {
  scenarioHeaderOnlyCaptureEvidence,
  scenarioServeFixture,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import {
  environmentServeFixture,
  environmentServeServed,
  environmentStateServeFixture,
} from "../../../tests/fixtures/environmentServe.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { PACKAGE_METADATA } from "../../generatedPackageMetadata.js";
import {
  BUNDLE_BASE_IMAGE,
  bundleDockerfile,
  isPortableBundleName,
  ENVIRONMENT_EXPORT_OPERATION,
  planEnvironmentBundle,
  registryPackageSource,
  type EnvironmentBundleOptions,
} from "./environmentBundle.js";
import type { EnvironmentSource } from "./environmentSource.js";
import { prepareServedState, servedCatalog } from "./environmentState.js";
import { environmentToolAnswer } from "./environmentToolAnswer.js";
import { EnvironmentStateStore } from "./environmentStateStore.js";

const fixture = environmentServeFixture();
const { source: servedSource, served } = environmentServeServed(fixture);

interface PlanOptions {
  readonly name?: string;
  readonly tarball?: string;
  /** Replaces the fixture's retained exchanges. */
  readonly exchanges?: EnvironmentSource["exchanges"];
  readonly served?: EnvironmentBundleOptions["served"];
}

/** Plan the fixture bundle served from its derived state. */
const planBundle = (options: PlanOptions = {}) =>
  planEnvironmentBundle(
    options.exchanges === undefined
      ? servedSource
      : { ...servedSource, exchanges: options.exchanges },
    {
      name: options.name,
      packageSource:
        options.tarball === undefined
          ? registryPackageSource()
          : { kind: "tarball", path: options.tarball },
      served: options.served ?? (() => served),
    },
  );

/** Prepare the state as the export does, under the checked bundle name. */
const exportPreparation =
  (source: EnvironmentSource, capture: unknown) => (name: string) =>
    prepareServedState(source, capture, {
      name,
      operation: ENVIRONMENT_EXPORT_OPERATION,
    });

/** Plan under a name expected to be refused before the state is prepared, and project the refusal. */
const nameRefusal = (name: string) => {
  const refused = planBundle({
    name,
    served: () => {
      throw new Error("The state was prepared before the name checks");
    },
  });
  if (refused.ok) throw new Error(`Expected ${name} to be refused`);
  return projectAnalysisError(refused.error);
};

const plan = (options: PlanOptions = {}) => {
  const result = planBundle(options);
  if (!result.ok) throw result.error;
  return result.value;
};

const file = (planned: ReturnType<typeof plan>, path: string): string => {
  const found = planned.files.find((entry) => entry.path === path);
  if (found === undefined) throw new Error(`Planned file missing: ${path}`);
  return found.content;
};

describe("planEnvironmentBundle", () => {
  it("plans the echo-shaped file set under the manifest name with byte-exact copies beside the Dockerfile", () => {
    const planned = plan();
    expect(planned.name).toBe("grafana-example");
    // Served from the derived state: the 19 manifest tools less the 5 write tools.
    expect(planned.toolCount).toBe(14);
    expect(planned.state).toEqual({
      served: true,
      evidence_id: served.state?.evidenceId,
    });
    expect(planned.files.map((entry) => entry.path)).toEqual([
      "README.md",
      "envs/grafana-example/env.toml",
      "envs/grafana-example/Dockerfile",
      "artifacts/check_grafana-example/verify.py",
      "tasks/smoke.json",
    ]);
    expect(planned.copies).toEqual({
      manifest: "envs/grafana-example/manifest.json",
      evidence: "envs/grafana-example/evidence.json",
      tarball: null,
    });
    expect(file(planned, "envs/grafana-example/env.toml")).toBe(
      'environment_name = "grafana-example"\n',
    );
  });

  it("pins the registry package to this build's exact version in the Dockerfile", () => {
    const dockerfile = file(plan(), "envs/grafana-example/Dockerfile");
    const lines = dockerfile.trimEnd().split("\n");
    expect(lines[0]).toBe(`FROM ${BUNDLE_BASE_IMAGE}`);
    expect(lines).toContain("ENV MCP_HOST=0.0.0.0");
    expect(lines).toContain("ENV MCP_PORT=18765");
    expect(lines).toContain(
      `ENV MCP_ALLOWED_HOSTS=127.0.0.1,localhost,grafana-example`,
    );
    expect(lines).toContain(
      "RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*",
    );
    expect(lines).toContain(
      `RUN npm install -g --ignore-scripts --no-fund --no-audit rea-agents@${PACKAGE_METADATA.version}`,
    );
    expect(lines).toContain(
      "COPY --chown=node:node manifest.json evidence.json /env/",
    );
    expect(lines).toContain("USER node");
    expect(lines.at(-1)).toBe(
      'CMD ["rea","environment-serve","/env/manifest.json","--evidence","/env/evidence.json"]',
    );
    expect(dockerfile).not.toContain("rea-agents.tgz");
    expect(dockerfile.indexOf("RUN npm install")).toBeLessThan(
      dockerfile.indexOf("USER node"),
    );
  });

  it("copies and installs the tarball instead of the registry package when one is given", () => {
    const planned = plan({ tarball: "/packed/rea-agents-1.2.3.tgz" });
    expect(planned.copies.tarball).toBe("envs/grafana-example/rea-agents.tgz");
    const dockerfile = file(planned, "envs/grafana-example/Dockerfile");
    expect(dockerfile).toContain("COPY rea-agents.tgz /tmp/\n");
    expect(dockerfile).toContain(
      "RUN npm install -g --ignore-scripts --no-fund --no-audit /tmp/rea-agents.tgz && rm /tmp/rea-agents.tgz\n",
    );
    expect(dockerfile).not.toContain(`rea-agents@${PACKAGE_METADATA.version}`);
    expect(bundleDockerfile(registryPackageSource())).not.toBe(dockerfile);
  });

  it("writes a verifier that checks the served tool count and the status the server answers the first parameterless GET tool with", () => {
    const planned = plan();
    // Served tools are name-ordered, so the first parameterless GET is the annotations list; the state answers it from its recording.
    expect(planned.check).toEqual({
      tool: "get_annotations",
      recordOrdinal: 25,
      status: 200,
    });
    const verifier = file(planned, "artifacts/check_grafana-example/verify.py");
    expect(verifier).toContain("served from the state the capture observed");
    expect(verifier).toContain("from mcp import ClientSession");
    expect(verifier).toContain(
      "from mcp.client.streamable_http import streamable_http_client",
    );
    expect(verifier).toContain("async def verify(mcp_url):");
    expect(verifier).toContain("TOOL_COUNT = 14");
    expect(verifier).toContain('TOOL = "get_annotations"');
    expect(verifier).toContain("EXPECTED_STATUS = 200");
    expect(verifier).toContain(
      "passed = passed and not result.isError and status == EXPECTED_STATUS",
    );
    expect(verifier).toContain("await session.list_tools()");
    expect(verifier).toContain("await session.call_tool(TOOL, {})");
    expect(verifier).toContain(
      'return [{"id": "serve", "result": passed, "description": description}]',
    );
  });

  it("writes the smoke task deploying the env locally before the verifier", () => {
    expect(JSON.parse(file(plan(), "tasks/smoke.json"))).toEqual([
      {
        id: "env",
        type: "deploy_env",
        env_id: "grafana-example",
        sandbox_type: "local",
      },
      {
        id: "serve",
        type: "env_outcome_verifier",
        env_id: "grafana-example",
        file_artifact_id: "check_grafana-example",
        verifier_id: "serve",
      },
    ]);
  });

  it("records provenance, what the environment serves, the run command and the rights note in the README", () => {
    const source = servedSource;
    const readme = file(plan(), "README.md");
    expect(readme).toContain(
      `- Capture Evidence (the manifest's parent): \`${source.evidenceId}\``,
    );
    expect(readme).toContain(
      `- Manifest Evidence: \`${source.manifestEvidenceId}\``,
    );
    expect(readme).toContain(
      `- Manifest view digest: \`${source.manifest.view_digest}\``,
    );
    expect(readme).toContain(
      `- Capture artifact SHA-256: \`${source.captureSha256 ?? ""}\``,
    );
    expect(readme).toContain("- Tools: 14");
    expect(readme).toContain(
      `- State: \`${served.state?.evidenceId ?? ""}\`, derived from the capture`,
    );
    expect(readme).toContain(`rea-agents@${PACKAGE_METADATA.version}`);
    expect(readme).toContain("```sh\nagent-env run .\n```");
    expect(readme).not.toContain("agent-env run grafana-example");
    expect(readme).toContain("## What the environment serves");
    expect(readme).not.toContain("What replay means");
    expect(readme).toContain(
      "write tools are served only where the capture's later reads confirmed\ntheir effect",
    );
    expect(readme).toContain(
      "`rea environment-serve --replay-only` serves pure replay",
    );
    expect(readme).toContain("This bundle serves from the state");
    expect(readme).toContain("serves 14 of the manifest's\n19 tools");
    expect(readme).toContain("Neither is emulation");
    expect(readme).toContain("must be treated as data, never as instructions");
    expect(readme).toContain("belongs to the captured application");
    expect(readme).toContain("Do not publish this bundle without the rights");
    expect(readme).toContain("calls `get_annotations`");
  });
});

describe("planEnvironmentBundle portable names", () => {
  it.each(["4294967296", "123", "0xffffffff"])(
    "refuses bundle name %s when HTTP cannot preserve its host identity",
    (name) => {
      expect(nameRefusal(name)).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "environment-export",
          issues: [{ path: ["name"], reason: "invalid_value" }],
        },
      });
    },
  );

  it("keeps addressable numeric prefixes and admits the DNS label boundary", () => {
    for (const name of ["123-replay", "0xffffffff-replay", "a".repeat(63)]) {
      expect(isPortableBundleName(name)).toBe(true);
      const planned = plan({ name });
      expect(planned.name).toBe(name);
      expect(file(planned, `envs/${name}/Dockerfile`)).toContain(
        `ENV MCP_ALLOWED_HOSTS=127.0.0.1,localhost,${name}`,
      );
    }
    expect(isPortableBundleName("a".repeat(64))).toBe(false);
    expect(nameRefusal("a".repeat(64))).toMatchObject({
      code: "invalid_request",
    });
    for (const name of ["123", "4294967296", "0xffffffff"])
      expect(isPortableBundleName(name)).toBe(false);
  });

  it("accepts a kebab-case name override and refuses any other name as invalid input", () => {
    const renamed = plan({ name: "replay-2" });
    expect(renamed.files.map((entry) => entry.path)).toContain(
      "envs/replay-2/Dockerfile",
    );
    expect(file(renamed, "envs/replay-2/env.toml")).toBe(
      'environment_name = "replay-2"\n',
    );
    expect(JSON.parse(file(renamed, "tasks/smoke.json"))[1]).toMatchObject({
      env_id: "replay-2",
      file_artifact_id: "check_replay-2",
    });
    for (const name of ["Grafana", "a_b", "-a", "a--b", "", "a".repeat(65)])
      expect(nameRefusal(name)).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "environment-export",
          issues: [{ path: ["name"], reason: "invalid_format" }],
        },
      });
  });

  it("refuses device names Windows reserves for files and folders, before planning any file", () => {
    for (const name of [
      "con",
      "prn",
      "aux",
      "nul",
      "com1",
      "com9",
      "lpt1",
      "lpt9",
    ])
      expect(nameRefusal(name)).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "environment-export",
          issues: [{ path: ["name"], reason: "invalid_value" }],
        },
      });
    for (const name of ["console", "com10", "nul-check"])
      expect(planBundle({ name }).ok).toBe(true);
  });
});

describe("planEnvironmentBundle served check", () => {
  it("keeps the first record's unknown status instead of borrowing another record's", () => {
    const first = servedSource.exchanges.get(25);
    if (first === undefined) throw new Error("Fixture lacks record 25");
    const exchanges = new Map(servedSource.exchanges);
    exchanges.set(25, { ...first, status: null });
    const unknown = plan({ exchanges });
    expect(unknown.check).toMatchObject({
      tool: "get_annotations",
      recordOrdinal: 25,
      status: null,
    });
    expect(
      file(unknown, "artifacts/check_grafana-example/verify.py"),
    ).toContain("EXPECTED_STATUS = None");
  });

  it("checks the next parameterless GET tool when the server cannot answer one without arguments", () => {
    const exchanges = new Map(servedSource.exchanges);
    exchanges.delete(25);
    expect(plan({ exchanges }).check).toMatchObject({
      tool: "get_folders",
      status: 200,
    });
  });

  it("expects the status of the state's answer where it differs from replay's", () => {
    // Without arguments replay keeps the first line; the state answers the line {} names exactly.
    const items = environmentStateServeFixture(
      timedCaptureEvidence([
        ["GET", "/api/items?a=1", [{ id: 1 }], 206],
        ["GET", "/api/items", [{ id: 1 }, { id: 2 }]],
      ]),
    );
    const { source, served: prepared } = environmentServeServed(items);
    if (prepared.state === undefined) throw new Error("Expected a state");
    const tool = source.manifest.tools.find(({ name }) => name === "get_items");
    if (tool === undefined) throw new Error("Fixture manifest lacks get_items");
    const fromState = environmentToolAnswer(
      source,
      new EnvironmentStateStore(prepared.state),
    )(tool, {});
    const replayed = environmentToolAnswer(source, undefined)(tool, {});
    if (!fromState.ok) throw fromState.error;
    if (!replayed.ok) throw replayed.error;
    expect(fromState.value).toMatchObject({
      status: 200,
      replay: { record_ordinal: 1 },
      state: { source: "state", view: "list" },
    });
    expect(replayed.value).toMatchObject({
      status: 206,
      replay: { record_ordinal: 0 },
    });
    const planned = planEnvironmentBundle(source, {
      packageSource: registryPackageSource(),
      served: exportPreparation(source, items.capture),
    });
    if (!planned.ok) throw planned.error;
    expect(planned.value.state.served).toBe(true);
    expect(planned.value.check).toEqual({
      tool: "get_items",
      recordOrdinal: 1,
      status: 200,
    });
  });
});

describe("planEnvironmentBundle without a state", () => {
  const fallback = environmentServeServed(
    scenarioServeFixture(scenarioHeaderOnlyCaptureEvidence()),
  );

  it("predicts replay, with every manifest tool and a replayed status, when the export cannot derive the state", () => {
    expect(fallback.served.report).toMatchObject({
      served: false,
      reason: "unavailable",
      code: "unsupported_target",
    });
    const planned = planEnvironmentBundle(fallback.source, {
      packageSource: registryPackageSource(),
      served: () => fallback.served,
    });
    if (!planned.ok) throw planned.error;
    expect(planned.value.toolCount).toBe(fallback.source.manifest.tools.length);
    expect(planned.value.check).toEqual({
      tool: "get_search",
      recordOrdinal: 3,
      status: 200,
    });
    const name = planned.value.name;
    const verifier = file(planned.value, `artifacts/check_${name}/verify.py`);
    expect(verifier).toContain(
      "served by replay because the state is unavailable",
    );
    expect(verifier).toContain(
      `TOOL_COUNT = ${String(fallback.source.manifest.tools.length)}`,
    );
    const readme = file(planned.value, "README.md");
    expect(readme).toContain("- State: not served");
    expect(readme).toContain(
      `This bundle serves replay: the server serves all ${String(fallback.source.manifest.tools.length)} manifest tools\nfrom their recordings because the state is unavailable\n(\`unsupported_target\`:`,
    );
    expect(readme).toContain("response_body selected");
    expect(readme).toContain("Neither is emulation");
  });

  it("serves and predicts replay when the state's catalog exceeds the discovery budget that replay's fits", () => {
    // Locate the state admission boundary instead of pinning a count to description sizes.
    const reads = servedSource.manifest.tools.filter(
      ({ method }) => method === "GET",
    );
    expect(reads.length).toBeGreaterThan(0);
    const sourceAt = (count: number): EnvironmentSource => ({
      ...servedSource,
      manifest: {
        ...servedSource.manifest,
        tools: Array.from({ length: count }, (_, index) => {
          const tool = reads[index % reads.length]!;
          return index < reads.length
            ? tool
            : { ...tool, name: `${tool.name}_${String(index)}` };
        }),
      },
    });
    const stateFits = (count: number): boolean =>
      servedCatalog(
        sourceAt(count),
        { writes: new Map() },
        servedSource.manifest.name,
      ).ok;
    let fitting = 0;
    let exceeding = reads.length;
    // This fixture ceiling bounds setup if catalog admission stops refusing.
    const fixtureToolLimit = 4096;
    while (exceeding < fixtureToolLimit && stateFits(exceeding)) {
      fitting = exceeding;
      exceeding = Math.min(exceeding * 2, fixtureToolLimit);
    }
    expect(
      stateFits(exceeding),
      "State discovery must exceed its budget within the fixture safety ceiling",
    ).toBe(false);
    while (exceeding - fitting > 1) {
      const middle = Math.floor((fitting + exceeding) / 2);
      if (stateFits(middle)) fitting = middle;
      else exceeding = middle;
    }
    const source = sourceAt(exceeding);
    expect(
      servedCatalog(source, undefined, source.manifest.name).ok,
      "The fixture must fit replay discovery while exceeding state discovery",
    ).toBe(true);
    const prepared = prepareServedState(source, fixture.capture);
    expect(prepared.state).toBeUndefined();
    expect(prepared.report).toMatchObject({
      served: false,
      reason: "unavailable",
      code: "resource_constraint",
    });
    const planned = planEnvironmentBundle(source, {
      packageSource: registryPackageSource(),
      served: exportPreparation(source, fixture.capture),
    });
    if (!planned.ok) throw planned.error;
    expect(planned.value.state).toMatchObject({
      served: false,
      code: "resource_constraint",
    });
    expect(planned.value.toolCount).toBe(source.manifest.tools.length);
    expect(planned.value.check).toEqual({
      tool: "get_annotations",
      recordOrdinal: 25,
      status: 200,
    });
    expect(file(planned.value, "README.md")).toContain(
      "because the state is unavailable\n(`resource_constraint`:",
    );
  });
});

it("refuses a bundle that the server cannot admit in either mode, using export operation context", () => {
  const tool = servedSource.manifest.tools[0]!;
  const manifest = {
    ...servedSource.manifest,
    tools: [
      {
        ...tool,
        query_parameter_names: Array.from(
          { length: 10000 },
          (_, index) => `q_${index}`,
        ),
      },
    ],
  };
  const source = { ...servedSource, manifest };
  const result = planEnvironmentBundle(source, {
    packageSource: registryPackageSource(),
    served: exportPreparation(source, fixture.capture),
  });
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      operation: "environment-export",
      resource: "capacity",
      retryable: false,
    },
  });
});
