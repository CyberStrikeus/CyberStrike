import { evidenceFileBytes } from "./environmentEvidenceBytes.js";
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { join, sep } from "node:path";
import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
} from "../../../tests/fixtures/analysisView.js";
import {
  scenarioCaptureEvidence,
  scenarioCaptureFixture,
} from "../../../tests/fixtures/browserScenarioCapture.js";
import { environmentManifestHar } from "../../../tests/fixtures/historicalHar.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { ArtifactFileCleanupFailure } from "../../artifacts/ArtifactFileOperation.js";
import { writeJsonOutput } from "../../cli/jsonOutput.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import { analysisViewRequestSchema } from "../../domain/analysisView/analysisView.js";
import { summarizeEnvironmentCoverage } from "../../domain/analysisView/environmentCoverageView.js";
import type { Evidence } from "../../domain/evidence.js";
import { inspectAnalysisViewValidated } from "../analysisView/AnalysisViewService.js";
import {
  DEFAULT_BUILD_TEMPLATE_RULES,
  buildEnvironment,
  canonicalTemplateRules,
  classifyBuildCapture,
  type EnvironmentBuildInput,
} from "./environmentBuild.js";
import {
  exportEnvironmentBundle,
  readEnvironmentExportFile,
  readEnvironmentExportInputs,
} from "./environmentExport.js";
import { loadEnvironmentSource } from "./environmentSource.js";
import { prepareServedState } from "./environmentState.js";

const listFiles = async (root: string): Promise<string[]> =>
  (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .split(sep)
        .join("/"),
    )
    .sort();

/** The Grafana-shaped capture with every recorded URL moved to a loopback origin. */
const loopbackCapture = (): Evidence =>
  analysisViewCaptureEvidence(
    JSON.parse(
      JSON.stringify(environmentManifestCaptureFixture()).replaceAll(
        /https?:\/\/grafana\.example/gu,
        "http://127.0.0.1:3000",
      ),
    ) as ReturnType<typeof environmentManifestCaptureFixture>,
  );

/** Write capture Evidence as `--format json` writes it, then read it as the build command does. */
const captureFile = async (
  root: string,
  evidence: Evidence,
  name = "grafana.capture.json",
) => {
  const path = join(root, name);
  await writeFile(path, evidenceFileBytes(evidence));
  const read = await readEnvironmentExportFile(
    "evidence",
    path,
    "environment-build",
  );
  if (!read.ok) throw read.error;
  return read.value;
};

const buildInput = async (
  root: string,
  evidence: Evidence = analysisViewCaptureEvidence(
    environmentManifestCaptureFixture(),
  ),
  overrides: Partial<EnvironmentBuildInput> = {},
): Promise<EnvironmentBuildInput> => {
  const capture = await captureFile(root, evidence);
  return {
    capture,
    captureInput: "evidence",
    capturePath: capture.path,
    templateRules: DEFAULT_BUILD_TEMPLATE_RULES,
    directory: join(root, "built"),
    dryRun: false,
    ...overrides,
  };
};

/** The three-step path: project the manifest, write both files, export them. */
const threeStep = async (
  root: string,
  evidence: Evidence,
  name: string | undefined,
) => {
  const manifest = inspectAnalysisViewValidated({
    source: { kind: "inline", evidence },
    view: analysisViewRequestSchema.parse({
      kind: "environment-manifest",
      template_rules: [...DEFAULT_BUILD_TEMPLATE_RULES],
    }),
  });
  if (!manifest.ok) throw manifest.error;
  const manifestPath = join(root, "manifest.json");
  const capturePath = join(root, "capture.json");
  await writeFile(manifestPath, evidenceFileBytes(manifest.value));
  await writeFile(capturePath, evidenceFileBytes(evidence));
  const inputs = await readEnvironmentExportInputs(manifestPath, capturePath);
  if (!inputs.ok) throw inputs.error;
  const source = loadEnvironmentSource(
    inputs.value.manifest.value,
    inputs.value.evidence.value,
  );
  if (!source.ok) throw source.error;
  const directory = join(root, "three-step");
  const exported = await exportEnvironmentBundle({
    ...inputs.value,
    source: source.value,
    directory,
    name,
  });
  if (!exported.ok) throw exported.error;
  return { directory, exported: exported.value };
};

/** The prototype every host file handle shares, so a test can fail one handle's host call. */
const fileHandlePrototype = async (path: string): Promise<FileHandle> => {
  const handle = await open(path, "r");
  await handle.close();
  return Object.getPrototypeOf(handle) as FileHandle;
};

const sameTree = async (left: string, right: string): Promise<number> => {
  const files = await listFiles(left);
  expect(await listFiles(right)).toEqual(files);
  for (const file of files)
    expect(
      Buffer.compare(
        await readFile(join(left, file)),
        await readFile(join(right, file)),
      ),
      file,
    ).toBe(0);
  return files.length;
};

describe("buildEnvironment", () => {
  it("writes the bundle the three-step path writes, byte for byte", async () => {
    const root = await createTestTempDirectory("rea-environment-build-same-");
    const evidence = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture(),
    );
    const input = await buildInput(root, evidence);
    const built = await buildEnvironment(input);
    if (!built.ok) throw built.error;
    const reference = await threeStep(
      await createTestTempDirectory("rea-environment-build-ref-"),
      evidence,
      undefined,
    );
    expect(await sameTree(input.directory!, reference.directory)).toBe(7);
    expect(built.value).toMatchObject({
      status: "built",
      name: "grafana-example",
      capture: {
        evidence_id: evidence.evidence_id,
        operation: "inspect_web_network_capture",
        input: "evidence",
      },
      manifest: {
        evidence_id: reference.exported.manifest_evidence_id,
        template_rules: [...DEFAULT_BUILD_TEMPLATE_RULES],
      },
      state: reference.exported.state,
      tool_count: reference.exported.tool_count,
      package_source: reference.exported.package_source,
      files: reference.exported.files,
      warnings: [],
      next: [`agent-env run ${input.directory!}`],
    });
  });

  it("reports the coverage of the state the bundle serves", async () => {
    const root = await createTestTempDirectory("rea-environment-build-cov-");
    const evidence = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture(),
    );
    const built = await buildEnvironment(
      await buildInput(root, evidence, { dryRun: true, directory: undefined }),
    );
    if (!built.ok) throw built.error;
    const manifest = inspectAnalysisViewValidated({
      source: { kind: "inline", evidence },
      view: analysisViewRequestSchema.parse({
        kind: "environment-manifest",
        template_rules: [...DEFAULT_BUILD_TEMPLATE_RULES],
      }),
    });
    if (!manifest.ok) throw manifest.error;
    const source = loadEnvironmentSource(manifest.value, evidence);
    if (!source.ok) throw source.error;
    const { state } = prepareServedState(source.value, evidence);
    if (state === undefined) throw new Error("Expected a served state");
    expect(built.value.coverage).toEqual(
      summarizeEnvironmentCoverage({
        views: state.views.values(),
        writes: state.writes.values(),
      }),
    );
    expect(
      built.value.coverage!.reads.state + built.value.coverage!.reads.recorded,
    ).toBe(state.views.size);
  });

  it("plans the same files without writing anything on a dry run", async () => {
    const root = await createTestTempDirectory("rea-environment-build-dry-");
    const planned = await buildEnvironment(
      await buildInput(root, undefined, { dryRun: true }),
    );
    if (!planned.ok) throw planned.error;
    await expect(readdir(join(root, "built"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const built = await buildEnvironment(await buildInput(root));
    if (!built.ok) throw built.error;
    const { status, next, ...plannedRest } = planned.value;
    const { status: builtStatus, next: builtNext, ...builtRest } = built.value;
    expect([status, builtStatus]).toEqual(["planned", "built"]);
    expect(next).toEqual([]);
    expect(builtNext).toHaveLength(1);
    expect(plannedRest).toEqual(builtRest);
  });
});

describe("buildEnvironment naming and refusals", () => {
  it("names a loopback capture after its file and says so", async () => {
    const root = await createTestTempDirectory("rea-environment-build-name-");
    const evidence = loopbackCapture();
    const input = await buildInput(root, evidence);
    const built = await buildEnvironment(input);
    if (!built.ok) throw built.error;
    expect(built.value.name).toBe("grafana");
    expect(built.value.warnings).toEqual([
      expect.objectContaining({
        code: "name-from-file",
        message: expect.stringContaining("http://127.0.0.1:3000"),
      }),
    ]);
    const reference = await threeStep(
      await createTestTempDirectory("rea-environment-build-name-ref-"),
      evidence,
      "grafana",
    );
    await sameTree(input.directory!, reference.directory);
    const named = await buildEnvironment({
      ...input,
      name: "my-grafana",
      directory: join(root, "named"),
    });
    if (!named.ok) throw named.error;
    expect(named.value.name).toBe("my-grafana");
    expect(named.value.warnings).toEqual([]);
  });

  it("refuses a loopback capture whose file name yields no name", async () => {
    const root = await createTestTempDirectory("rea-environment-build-noname-");
    const capture = await captureFile(root, loopbackCapture(), "--.json");
    const built = await buildEnvironment({
      capture,
      captureInput: "evidence",
      capturePath: capture.path,
      templateRules: DEFAULT_BUILD_TEMPLATE_RULES,
      directory: join(root, "built"),
      dryRun: false,
    });
    if (built.ok) throw new Error("Expected a refusal");
    expect(projectAnalysisError(built.error)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "environment-build",
        issues: [{ path: ["name"] }],
      },
    });
    await expect(readdir(join(root, "built"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses evidence that is not a capture, and a build without a directory", async () => {
    const root = await createTestTempDirectory("rea-environment-build-refuse-");
    const evidence = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture(),
    );
    const manifest = inspectAnalysisViewValidated({
      source: { kind: "inline", evidence },
      view: analysisViewRequestSchema.parse({ kind: "environment-manifest" }),
    });
    if (!manifest.ok) throw manifest.error;
    const notCapture = await buildEnvironment(
      await buildInput(root, manifest.value),
    );
    if (notCapture.ok) throw new Error("Expected a refusal");
    expect(projectAnalysisError(notCapture.error)).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["capture", "operation"] }] },
    });
    const noDirectory = await buildEnvironment(
      await buildInput(root, evidence, { directory: undefined }),
    );
    if (noDirectory.ok) throw new Error("Expected a refusal");
    expect(projectAnalysisError(noDirectory.error)).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["directory"] }] },
    });
    await expect(readdir(join(root, "built"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses an occupied directory and leaves it as it was", async () => {
    const root = await createTestTempDirectory("rea-environment-build-busy-");
    const input = await buildInput(root);
    await mkdir(input.directory!);
    await writeFile(join(input.directory!, "notes.md"), "keep");
    const built = await buildEnvironment(input);
    if (built.ok) throw new Error("Expected a refusal");
    expect(projectAnalysisError(built.error).code).toBe("invalid_request");
    expect(await listFiles(input.directory!)).toEqual(["notes.md"]);
  });
});

describe("buildEnvironment cancellation and input checks", () => {
  it("writes nothing when cancelled before the bundle stage", async () => {
    const root = await createTestTempDirectory("rea-environment-build-stop-");
    const controller = new AbortController();
    const input = await buildInput(root, undefined, {
      signal: controller.signal,
      progress: (stage) => {
        if (stage === "state") controller.abort();
      },
    });
    const built = await buildEnvironment(input);
    if (built.ok) throw new Error("Expected a cancellation");
    expect(projectAnalysisError(built.error)).toMatchObject({
      code: "cancelled",
      details: { operation: "environment-build" },
    });
    await expect(readdir(input.directory!)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("names the written bundle when cancelled during the write", async () => {
    const root = await createTestTempDirectory("rea-environment-build-late-");
    const controller = new AbortController();
    const input = await buildInput(root, undefined, {
      signal: controller.signal,
      progress: (stage) => {
        if (stage === "bundle") controller.abort();
      },
    });
    const built = await buildEnvironment(input);
    if (built.ok) throw new Error("Expected a cancellation");
    const projected = projectAnalysisError(built.error);
    expect(projected).toMatchObject({
      code: "cancelled",
      details: {
        diagnostics: {
          output_directory: input.directory,
          bundle_written: true,
        },
      },
    });
    expect(await listFiles(input.directory!)).toHaveLength(7);
  });

  it("refuses repeated rules and a HAR document saved as JSON", async () => {
    const root = await createTestTempDirectory("rea-environment-build-input-");
    const repeated = await buildEnvironment(
      await buildInput(root, undefined, {
        templateRules: ["opaque-token", "opaque-token"],
      }),
    );
    if (repeated.ok) throw new Error("Expected a refusal");
    expect(projectAnalysisError(repeated.error)).toMatchObject({
      code: "invalid_request",
      details: { issues: [{ path: ["template_rules"] }] },
    });
    const harPath = join(root, "grafana.json");
    await writeFile(harPath, JSON.stringify({ log: { entries: [] } }));
    const har = await readEnvironmentExportFile("evidence", harPath);
    if (!har.ok) throw har.error;
    const asJson = await buildEnvironment({
      capture: har.value,
      captureInput: "evidence",
      capturePath: harPath,
      templateRules: DEFAULT_BUILD_TEMPLATE_RULES,
      dryRun: true,
    });
    if (asJson.ok) throw new Error("Expected a refusal");
    expect(projectAnalysisError(asJson.error)).toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining(".har"),
      details: { issues: [{ path: ["capture"] }] },
    });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses an unreadable package tarball on a dry run as a build does",
    async () => {
      const root = await createTestTempDirectory("rea-environment-build-tgz-");
      const tarball = join(root, "rea-agents.tgz");
      await writeFile(tarball, "packed");
      await chmod(tarball, 0o000);
      try {
        const planned = await buildEnvironment(
          await buildInput(root, undefined, {
            dryRun: true,
            packageTarball: tarball,
          }),
        );
        const built = await buildEnvironment(
          await buildInput(root, undefined, { packageTarball: tarball }),
        );
        if (planned.ok || built.ok) throw new Error("Expected both refusals");
        expect(projectAnalysisError(planned.error).code).toBe("access_denied");
        expect(projectAnalysisError(built.error).code).toBe("access_denied");
      } finally {
        await chmod(tarball, 0o600);
      }
    },
  );

  it("refuses a loopback capture whose file name is too long, and quotes the next command", async () => {
    const root = await createTestTempDirectory("rea-environment-build-long-");
    const long = await captureFile(
      root,
      loopbackCapture(),
      `${"a".repeat(70)}.capture.json`,
    );
    const refused = await buildEnvironment({
      capture: long,
      captureInput: "evidence",
      capturePath: long.path,
      templateRules: DEFAULT_BUILD_TEMPLATE_RULES,
      dryRun: true,
    });
    if (refused.ok) throw new Error("Expected a refusal");
    expect(projectAnalysisError(refused.error)).toMatchObject({
      details: { operation: "environment-build", issues: [{ path: ["name"] }] },
    });
    const built = await buildEnvironment(
      await buildInput(root, undefined, { directory: join(root, "my bundle") }),
    );
    if (!built.ok) throw built.error;
    expect(built.value.next).toEqual([
      `agent-env run '${join(root, "my bundle")}'`,
    ]);
  });
});

describe("classifyBuildCapture", () => {
  it("inspects .har files, reads .json Evidence and refuses anything else", () => {
    expect(classifyBuildCapture("/x/grafana.HAR")).toEqual({
      ok: true,
      value: "har",
    });
    expect(classifyBuildCapture("/x/grafana.capture.json")).toEqual({
      ok: true,
      value: "evidence",
    });
    const refused = classifyBuildCapture("/x/grafana.saz");
    if (refused.ok) throw new Error("Expected a refusal");
    expect(projectAnalysisError(refused.error)).toMatchObject({
      code: "invalid_request",
      details: {
        operation: "environment-build",
        issues: [{ path: ["capture"] }],
      },
    });
  });
});

describe("canonicalTemplateRules", () => {
  it("orders rules as the views apply them", () => {
    expect(
      canonicalTemplateRules(["prefix-variance", "after-uid-literal"]),
    ).toEqual(["after-uid-literal", "prefix-variance"]);
  });
});

describe("buildEnvironment credential names", () => {
  it("flags the credential-named headers and query parameters a scenario capture retains, as a HAR's", async () => {
    const root = await createTestTempDirectory("rea-environment-build-scan-");
    const evidence = scenarioCaptureEvidence(
      scenarioCaptureFixture(
        [
          {
            method: "GET",
            url: "/api/users/2?api_key=k-1&page=1",
            status: 200,
            mediaType: "application/json",
            body: '{"id":2,"login":"probe"}',
            requestHeaders: [
              { name: "X-Api-Key", value: "k-123" },
              { name: "Accept", value: "application/json" },
              { name: "Authorization", value: null },
            ],
            responseHeaders: [{ name: "X-Auth-Token", value: "t-9" }],
          },
        ],
        { request_body: true, response_body: true, header_values: true },
      ),
    );
    const planned = await buildEnvironment(
      await buildInput(root, evidence, {
        dryRun: true,
        directory: undefined,
        name: "rota",
      }),
    );
    if (!planned.ok) throw planned.error;
    expect(planned.value.capture.records).toBe(1);
    expect(planned.value.warnings).toEqual([
      expect.objectContaining({
        code: "credential-named-members",
        pointers: [
          "event 0 request query api_key",
          "event 1 request header X-Api-Key",
          "event 3 response header X-Auth-Token",
        ],
      }),
    ]);
    const report = JSON.stringify(planned.value);
    for (const value of ["k-123", "t-9"]) expect(report).not.toContain(value);
  });
});

/** A scenario capture whose event list `edit` rewrote, with its retained count kept consistent. */
const editedScenarioEvidence = (
  capture: ReturnType<typeof scenarioCaptureFixture>,
  edit: (
    items: ReturnType<typeof scenarioCaptureFixture>["events"]["items"],
  ) => ReturnType<typeof scenarioCaptureFixture>["events"]["items"],
): Evidence => {
  const items = edit(capture.events.items);
  return scenarioCaptureEvidence({
    ...capture,
    events: { ...capture.events, retained: items.length, items },
  });
};

/** Drop a transaction's request event, as a capture attached after the request began records it. */
const attachedMidFlight =
  (transaction: string) =>
  (items: ReturnType<typeof scenarioCaptureFixture>["events"]["items"]) =>
    items.filter(
      (event) =>
        event.kind !== "request" || event.transaction_id !== transaction,
    );

const plannedScan = async (prefix: string, evidence: Evidence) => {
  const root = await createTestTempDirectory(prefix);
  const planned = await buildEnvironment(
    await buildInput(root, evidence, {
      dryRun: true,
      directory: undefined,
      name: "rota",
    }),
  );
  if (!planned.ok) throw planned.error;
  return planned.value;
};

const USERS_EXCHANGE = {
  method: "GET",
  url: "/api/users/2",
  status: 200,
  mediaType: "application/json",
  body: '{"id":2,"login":"probe"}',
} as const;

describe("buildEnvironment credential scan of scenario events", () => {
  it("scans retained content that no record represents: a response attached mid-flight and an ambiguous transaction", async () => {
    const capture = scenarioCaptureFixture(
      [
        USERS_EXCHANGE,
        {
          method: "GET",
          url: "/api/session?api_key=k-mid",
          status: 200,
          mediaType: "application/json",
          body: '{"token":"t-mid"}',
          responseHeaders: [{ name: "X-Auth-Token", value: "t-header" }],
        },
        {
          method: "GET",
          url: "/api/me",
          status: 200,
          mediaType: "application/json",
          body: '{"sessionId":"s-ambiguous"}',
        },
      ],
      { request_body: true, response_body: true, header_values: true },
    );
    const duplicate = capture.events.items.find(
      (event) =>
        event.kind === "response" && event.transaction_id === "request-3",
    );
    if (duplicate === undefined) throw new Error("Fixture lacks a response");
    // The session's request began before attachment; the third transaction recorded two responses.
    const planned = await plannedScan(
      "rea-environment-build-events-",
      editedScenarioEvidence(capture, (items) => [
        ...attachedMidFlight("request-2")(items),
        { ...duplicate, sequence: 99 },
      ]),
    );
    expect(planned.capture.records).toBe(2);
    expect(planned.warnings).toEqual([
      expect.objectContaining({
        code: "credential-named-members",
        pointers: [
          "event 3 response query api_key",
          "event 4 response header X-Auth-Token",
          "event 4 response /token",
          "event 7 response /sessionId",
        ],
      }),
    ]);
    const report = JSON.stringify(planned);
    for (const value of ["k-mid", "t-mid", "t-header", "s-ambiguous"])
      expect(report).not.toContain(value);
  });

  it("reports a response attached mid-flight that is too large to scan", async () => {
    const capture = scenarioCaptureFixture([
      USERS_EXCHANGE,
      {
        method: "GET",
        url: "/api/export",
        status: 200,
        mediaType: "application/json",
        body: JSON.stringify({
          token: "t-large",
          pad: "a".repeat(4 * 1024 * 1024),
        }),
      },
    ]);
    const planned = await plannedScan(
      "rea-environment-build-events-large-",
      editedScenarioEvidence(capture, attachedMidFlight("request-2")),
    );
    expect(planned.warnings).toEqual([
      expect.objectContaining({
        code: "credential-scan-incomplete",
        pointers: ["event 4 response"],
      }),
    ]);
  });
});

describe("buildEnvironment credential scan coverage", () => {
  it("warns that a body too large to scan was not scanned", async () => {
    const root = await createTestTempDirectory("rea-environment-build-large-");
    const [entry] = environmentManifestHar().log.entries;
    const text = JSON.stringify({
      token: "t-large",
      pad: "a".repeat(4 * 1024 * 1024),
    });
    const evidence = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture([
        {
          ...entry!,
          response: {
            ...entry!.response,
            content: { ...entry!.response.content, text },
          },
        },
      ]),
    );
    const planned = await buildEnvironment(
      await buildInput(root, evidence, {
        dryRun: true,
        directory: undefined,
        name: "large",
      }),
    );
    if (!planned.ok) throw planned.error;
    expect(planned.value.warnings).toEqual([
      expect.objectContaining({
        code: "credential-scan-incomplete",
        pointers: ["record 0 response"],
      }),
    ]);
    expect(JSON.stringify(planned.value.warnings)).not.toContain("t-large");
  });
});

describe("buildEnvironment dry-run package tarball", () => {
  it("refuses a tarball whose descriptor stats successfully but fails to read", async () => {
    const root = await createTestTempDirectory("rea-environment-build-read-");
    const tarball = join(root, "rea-agents.tgz");
    await writeFile(tarball, "packed");
    const input = await buildInput(root, undefined, {
      dryRun: true,
      packageTarball: tarball,
    });
    const prototype = await fileHandlePrototype(tarball);
    const failure = Object.assign(
      new Error("controlled tarball read failure"),
      { code: "EIO" },
    );
    const read = vi.spyOn(prototype, "read").mockRejectedValue(failure);
    try {
      const planned = await buildEnvironment(input);
      expect(read).toHaveBeenCalled();
      if (planned.ok) throw new Error("Expected a tarball read refusal");
      expect(projectAnalysisError(planned.error)).toMatchObject({
        code: "invalid_request",
        details: { issues: [{ path: ["package_tarball"] }] },
      });
      expect(await readdir(root)).not.toContain("bundle");
    } finally {
      read.mockRestore();
    }
  });

  it.each([false, true])(
    "retries a failed tarball close and retains its owner when the failure persists: %s",
    async (persistent) => {
      const root = await createTestTempDirectory(
        "rea-environment-build-close-",
      );
      const tarball = join(root, "rea-agents.tgz");
      await writeFile(tarball, "packed");
      const input = await buildInput(root, undefined, {
        dryRun: true,
        packageTarball: tarball,
      });
      const prototype = await fileHandlePrototype(tarball);
      const stat = prototype.stat;
      let owner: FileHandle | undefined;
      let close: (() => Promise<void>) | undefined;
      let attempts = 0;
      let released = false;
      const failClose = (handle: FileHandle): void => {
        const original = handle.close.bind(handle);
        owner = handle;
        close = original;
        handle.close = () => {
          attempts += 1;
          return !released && (persistent || attempts === 1)
            ? Promise.reject(
                Object.assign(new Error("controlled tarball close failure"), {
                  code: "EIO",
                }),
              )
            : original();
        };
      };
      // The tarball is the only file a dry run opens; fail its handle's close.
      const spy = vi.spyOn(prototype, "stat").mockImplementation(function (
        this: FileHandle,
        ...args: unknown[]
      ) {
        if (owner === undefined) failClose(this);
        return Reflect.apply(stat, this, args) as ReturnType<
          FileHandle["stat"]
        >;
      } as FileHandle["stat"]);
      try {
        const planned = await buildEnvironment(input);
        if (!persistent) {
          if (!planned.ok) throw planned.error;
          expect(attempts).toBe(2);
          expect(planned.value.files.at(-1)).toEqual({
            path: expect.stringMatching(/\.tgz$/u),
            bytes: 6,
          });
          return;
        }
        if (planned.ok) throw new Error("Expected a cleanup refusal");
        expect(planned.error).toMatchObject({
          _tag: "AnalysisOutputError",
          operation: "environment-export",
          cleanupIncomplete: true,
        });
        const failure = planned.error.cause;
        if (!(failure instanceof ArtifactFileCleanupFailure))
          throw new Error("Missing exact cleanup owner");
        released = true;
        await failure.cleanupLease.release();
        expect(planned.error.cleanupIncomplete).toBe(false);
        expect(owner?.fd).toBe(-1);
      } finally {
        released = true;
        spy.mockRestore();
        if (owner !== undefined && owner.fd >= 0) await close?.();
      }
    },
  );

  it("is cancelled by an interrupt that arrives while it reads the tarball", async () => {
    const root = await createTestTempDirectory(
      "rea-environment-build-tgz-stop-",
    );
    const tarball = join(root, "rea-agents.tgz");
    await writeFile(tarball, "packed");
    const controller = new AbortController();
    const input = await buildInput(root, undefined, {
      dryRun: true,
      packageTarball: tarball,
      signal: controller.signal,
    });
    const prototype = await fileHandlePrototype(tarball);
    const original = prototype.stat;
    const stat = vi.spyOn(prototype, "stat").mockImplementation(function (
      this: FileHandle,
      ...args: unknown[]
    ) {
      controller.abort();
      return Reflect.apply(original, this, args) as ReturnType<
        FileHandle["stat"]
      >;
    } as FileHandle["stat"]);
    try {
      const planned = await buildEnvironment(input);
      if (planned.ok) throw new Error("Expected a cancellation");
      expect(projectAnalysisError(planned.error)).toMatchObject({
        code: "cancelled",
        details: { operation: "environment-build" },
      });
    } finally {
      stat.mockRestore();
    }
  });
});
describe("evidenceFileBytes", () => {
  it("writes the bytes --format json writes, into one buffer", async () => {
    // A long multibyte body with a surrogate pair across the serializer's first part boundary.
    const [entry] = environmentManifestHar().log.entries;
    const text = `${"a".repeat(8191)}😀${"é😀".repeat(40_000)}`;
    const evidence = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture([
        {
          ...entry!,
          response: {
            ...entry!.response,
            content: { ...entry!.response.content, text },
          },
        },
      ]),
    );
    const written: Buffer[] = [];
    await writeJsonOutput(
      evidence,
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          written.push(chunk);
          done();
        },
      }),
    );
    const expected = Buffer.concat(written);
    const concat = vi.spyOn(Buffer, "concat");
    try {
      const bytes = evidenceFileBytes(evidence);
      expect(concat).not.toHaveBeenCalled();
      expect(bytes.length).toBeGreaterThan(200_000);
      expect(bytes.equals(expected)).toBe(true);
    } finally {
      concat.mockRestore();
    }
  });
});
