import { mkdir, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";

import { captureProcessScenario } from "../../../src/process/capture/ProcessHarness.js";
import { createProcessCaptureEvidence } from "../../../src/application/process/ProcessEvidence.js";
import {
  digestProcessCommitment,
  processScenarioSchema,
} from "../../../src/domain/process/processScenario.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { compareProcessCaptures } from "../../../src/domain/process/processComparison.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { itWithCaptureCapability } from "./processCaptureCapability.js";

const processFixture = fileURLToPath(
  new URL("../../fixtures/processIdentity.mjs", import.meta.url),
);
const identitySchema = z.object({
  pid: z.number().int().positive(),
  parent_pid: z.number().int().positive(),
  process_group_id: z.number().int().positive(),
  session_id: z.number().int().positive(),
});

const itWithLinuxCaptureCapability =
  process.platform === "linux" ? itWithCaptureCapability : it.skip;

itWithCaptureCapability(
  "captures a POSIX PATH executable with a literal backslash in its basename",
  async () => {
    const root = await createTestTempDirectory("rea-process-backslash-name-");
    const bin = join(root, "bin");
    await mkdir(bin);
    const command = "selected\\node";
    const selected = join(bin, command);
    await symlink(process.execPath, selected);
    const scenario = processScenarioSchema.parse({
      executable: command,
      working_directory: root,
      environment: { PATH: bin },
      arguments: ["-e", 'process.stdout.write("selected executable")'],
      settle_ms: 100,
    });
    const result = await captureProcessScenario(scenario);
    if (!result.ok) throw result.error;
    expect(result.value.frames.map(({ data }) => data).join("")).toBe(
      "selected executable",
    );
    expect(result.value.exit).toMatchObject({ code: 0, reason: "exited" });
    expect(result.value.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
  },
);

itWithCaptureCapability(
  "preserves numeric reports and original normalized PTY text in Evidence",
  async () => {
    const root = await createTestTempDirectory("rea-process-numeric-report-");
    const report = JSON.stringify({
      pid: 32,
      size: 108,
      height: 480,
      width: 640,
      score: 20,
    });
    const original = `${report}\nlisten:8080\n`;
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      arguments: ["-e", `process.stdout.write(${JSON.stringify(original)})`],
      settle_ms: 100,
    });
    const result = await captureProcessScenario(scenario);
    if (!result.ok) throw result.error;
    const capture = parseProcessCapture(
      createProcessCaptureEvidence(scenario, result.value).normalized_result,
    );
    expect(capture.frames.map(({ data }) => data).join("")).toContain(report);
    expect(capture.frames.map(({ data }) => data).join("")).toContain(
      "listen:<port>",
    );
    expect(
      capture.frames.map(({ data, raw_data }) => raw_data ?? data).join(""),
    ).toBe(original.replaceAll("\n", "\r\n"));
    expect(
      capture.rendered_frames.some(({ serialized_state }) =>
        serialized_state.includes(report),
      ),
    ).toBe(true);
    expect(capture.manifest.comparison_contract).toMatchObject({
      port_normalization_version: "contextual-endpoints-v3",
      rendered_line_format: "trailing-spaces-trimmed-v1",
    });
    expect(capture.manifest.comparison_contract).not.toHaveProperty(
      "pattern_normalization_version",
    );
    expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
    expect(capture.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
  },
);

itWithCaptureCapability.each([
  { pattern: "AB", replacement: "$&$&", expected: "$&$&" },
  {
    pattern: "AB",
    replacement: "$$ $` $' $1",
    expected: "$$ $` $' $1",
  },
  { pattern: "", replacement: "-", expected: "-A-B-" },
])(
  "preserves literal replacement $replacement and rejects legacy comparison semantics",
  async ({ pattern, replacement, expected }) => {
    const root = await createTestTempDirectory("rea-process-literal-");
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      arguments: ["-e", 'process.stdout.write("AB")'],
      working_directory: root,
      normalization: {
        paths: false,
        pids: false,
        ports: false,
        patterns: [{ pattern, replacement }],
      },
      settle_ms: 100,
    });
    const result = await captureProcessScenario(scenario);
    if (!result.ok) throw result.error;
    const capture = parseProcessCapture(
      createProcessCaptureEvidence(scenario, result.value).normalized_result,
    );
    expect(capture.frames.map(({ data }) => data).join("")).toBe(expected);
    expect(
      capture.frames.map(({ raw_data, data }) => raw_data ?? data).join(""),
    ).toBe("AB");
    expect(capture.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
    expect(compareProcessCaptures(capture, capture).terminal).toBe("unchanged");
    const legacyContract = { ...capture.manifest.comparison_contract };
    delete legacyContract.pattern_normalization_version;
    const legacy = parseProcessCapture({
      ...capture,
      manifest: {
        ...capture.manifest,
        comparison_contract: legacyContract,
        comparison_contract_sha256: digestProcessCommitment(legacyContract),
      },
    });
    expect(() => compareProcessCaptures(legacy, capture)).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            expected: ["pattern_normalization_version"],
          }),
        ],
      }),
    );
  },
  20_000,
);

itWithLinuxCaptureCapability.each([false, true])(
  "honors pids=%s in owned Linux capture samples and committed Evidence",
  async (pids) => {
    const root = await createTestTempDirectory("rea-process-identifiers-");
    const identityPath = join(root, "identity.json");
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      arguments: [processFixture, identityPath],
      working_directory: root,
      normalization: { pids, ports: false, paths: false },
      timeout_ms: 10_000,
      idle_timeout_ms: 10_000,
    });
    const result = await captureProcessScenario(scenario);
    if (!result.ok) throw result.error;
    const capture = result.value;
    const identity = identitySchema.parse(
      JSON.parse(await readFile(identityPath, "utf8")),
    );
    expect(identity.process_group_id).toBe(identity.pid);
    expect(identity.session_id).toBe(identity.pid);
    expect(identity.parent_pid).not.toBe(identity.pid);
    const fixtureSamples = capture.process_samples.filter(({ command }) =>
      command.includes(processFixture),
    );
    expect(fixtureSamples.length).toBeGreaterThan(0);
    for (const sample of fixtureSamples)
      expect(sample).toMatchObject(
        pids
          ? { pid: 1, parent_pid: 2, process_group_id: 1, session_id: 1 }
          : identity,
      );
    const output = capture.frames.map(({ data }) => data).join("");
    if (pids) expect(output).toContain('"pid":<pid>');
    else expect(output).toContain(JSON.stringify(identity));

    const evidence = createProcessCaptureEvidence(scenario, capture);
    const serializedCapture = parseProcessCapture(evidence.normalized_result);
    expect(evidence.parameters).toMatchObject({ normalization: { pids } });
    expect(serializedCapture.process_samples).toEqual(capture.process_samples);
    expect(serializedCapture.normalization.pids).toBe(pids);
    expect(serializedCapture.manifest.scenario).toMatchObject({
      normalization: { pids },
    });
    expect(serializedCapture.manifest.comparison_contract).toMatchObject({
      normalization: { pids },
    });
    expect(serializedCapture.manifest.normalization_sha256).toBe(
      digestProcessCommitment(scenario.normalization),
    );
    expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
    expect([null, 0]).toContain(capture.exit.signal);
    expect(capture.settlement).toMatchObject({
      state: "quiesced",
      cleanup_outcome: "not_required",
    });
    expect(capture.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
  },
  20_000,
);

itWithCaptureCapability(
  "preserves selected nested path identities in actual PTY Evidence",
  async () => {
    const root = await createTestTempDirectory("rea-process-nested-paths-");
    const executable = join(root, "selected-node");
    const observed = join(root, "data");
    await symlink(process.execPath, executable);
    await mkdir(observed);
    const original = `${executable}\n${observed}/result\n${root}/log`;
    const scenario = processScenarioSchema.parse({
      executable,
      working_directory: root,
      filesystem_observation_paths: [observed],
      arguments: ["-e", `process.stdout.write(${JSON.stringify(original)})`],
      normalization: { paths: true, pids: false, ports: false, patterns: [] },
      settle_ms: 100,
    });
    const result = await captureProcessScenario(scenario);
    if (!result.ok) throw result.error;
    const capture = parseProcessCapture(
      createProcessCaptureEvidence(scenario, result.value).normalized_result,
    );
    expect(capture.frames.map(({ data }) => data).join("")).toBe(
      "<executable>\r\n<filesystem-root-0>/result\r\n<working-directory>/log",
    );
    expect(
      capture.frames.map(({ raw_data, data }) => raw_data ?? data).join(""),
    ).toBe(original.replaceAll("\n", "\r\n"));
    expect(capture.manifest.comparison_contract).toHaveProperty(
      "path_normalization_version",
      "path-component-boundaries-v3",
    );
    const legacyContract = { ...capture.manifest.comparison_contract };
    delete legacyContract.path_normalization_version;
    const legacy = parseProcessCapture({
      ...capture,
      manifest: {
        ...capture.manifest,
        comparison_contract: legacyContract,
        comparison_contract_sha256: digestProcessCommitment(legacyContract),
      },
    });
    expect(() => compareProcessCaptures(legacy, capture)).toThrow(
      expect.objectContaining({
        issues: [
          expect.objectContaining({ expected: ["path_normalization_version"] }),
        ],
      }),
    );
    const formerPathSemantics = {
      ...capture,
      manifest: {
        ...capture.manifest,
        comparison_contract: {
          ...capture.manifest.comparison_contract,
          path_normalization_version: "longest-original-paths-v1",
        },
        comparison_contract_sha256: digestProcessCommitment({
          ...capture.manifest.comparison_contract,
          path_normalization_version: "longest-original-paths-v1",
        }),
      },
    };
    expect(() => compareProcessCaptures(formerPathSemantics, capture)).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: ["right"] })],
      }),
    );
    expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
    expect(capture.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
  },
  20_000,
);

itWithCaptureCapability(
  "normalizes descendants of a selected directory spelled with a trailing slash in actual PTY Evidence",
  async () => {
    const root = await createTestTempDirectory("rea-process-slash-root-");
    const observed = join(root, "selected");
    await mkdir(observed);
    const original = `P=${observed}/item.txt`;
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      filesystem_observation_paths: [`${observed}/`],
      arguments: ["-e", `process.stdout.write(${JSON.stringify(original)})`],
      normalization: { paths: true, pids: false, ports: false, patterns: [] },
      settle_ms: 100,
    });
    const result = await captureProcessScenario(scenario);
    if (!result.ok) throw result.error;
    const capture = parseProcessCapture(
      createProcessCaptureEvidence(scenario, result.value).normalized_result,
    );
    expect(capture.frames.map(({ data }) => data).join("")).toBe(
      "P=<filesystem-root-0>/item.txt",
    );
    expect(capture.exit).toMatchObject({ code: 0, reason: "exited" });
  },
  20_000,
);

itWithCaptureCapability(
  "keeps sibling executable names distinct in actual PTY Evidence",
  async () => {
    const root = await createTestTempDirectory("rea-process-sibling-path-");
    const executable = join(root, "original", "tool");
    await mkdir(join(root, "original"), { recursive: true });
    await symlink(process.execPath, executable);
    const sibling = `${executable}-helper`;
    const scenario = processScenarioSchema.parse({
      executable,
      working_directory: root,
      arguments: ["-e", `process.stdout.write(${JSON.stringify(sibling)})`],
      normalization: { paths: true, pids: false, ports: false, patterns: [] },
      settle_ms: 100,
    });
    const result = await captureProcessScenario(scenario);
    if (!result.ok) throw result.error;
    const capture = parseProcessCapture(
      createProcessCaptureEvidence(scenario, result.value).normalized_result,
    );
    expect(capture.frames.map(({ data }) => data).join("")).toBe(
      `<working-directory>/original/tool-helper`,
    );
  },
);

itWithCaptureCapability.each([false, true])(
  "normalizes a sampled child in raw and rendered terminal projections, pids=%s",
  async (pids) => {
    const root = await createTestTempDirectory("rea-sampled-terminal-pids-");
    const scenario = processScenarioSchema.parse({
      executable: process.execPath,
      working_directory: root,
      arguments: [
        "-e",
        `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setTimeout(()=>{},600)'],{stdio:'inherit'});console.log('rootpid='+process.pid+' childpid='+child.pid);setTimeout(()=>{},700);`,
      ],
      timeout_ms: 3000,
      settle_ms: 100,
      normalization: {
        paths: false,
        ports: false,
        pids,
        time_bucket_ms: 10000,
        patterns: [{ pattern: "<pid>", replacement: "<selected-pid>" }],
      },
    });
    const result = await captureProcessScenario(scenario);
    if (!result.ok) throw result.error;
    const capture = result.value;
    const raw = capture.frames
      .map(({ data, raw_data }) => raw_data ?? data)
      .join("");
    const match = /rootpid=(\d+) childpid=(\d+)/u.exec(raw);
    if (match === null)
      throw new Error("Expected exact root and child PID observations");
    expect(
      capture.process_samples.some((row) =>
        pids
          ? row.parent_pid === 1 && row.pid !== 1
          : row.pid === Number(match[2]),
      ),
    ).toBe(true);
    const expected = pids
      ? "rootpid=<selected-pid> childpid=<selected-pid>"
      : match[0];
    expect(capture.frames.map(({ data }) => data).join("")).toContain(expected);
    expect(
      capture.rendered_frames.some(
        ({ lines, serialized_state }) =>
          lines.includes(expected) && serialized_state.includes(expected),
      ),
    ).toBe(true);
    if (pids)
      expect(
        capture.manifest.comparison_contract.pid_normalization_version,
      ).toBe("sampled-identifiers-v2");
    else
      expect(capture.manifest.comparison_contract).not.toHaveProperty(
        "pid_normalization_version",
      );
    expect(capture.cleanup).toMatchObject({
      owned_process_group: "verified",
      temporary_root: "removed",
    });
  },
);
