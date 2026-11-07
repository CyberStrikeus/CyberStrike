import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

import {
  inventoryFirmwareOutput,
  FirmwareFileAccess,
} from "../../../src/firmware/FirmwareFiles.js";
import { readFirmwareCommandReport } from "../../../src/firmware/FirmwareCommand.js";
import { FIRMWARE_LIMITS } from "../../../src/firmware/FirmwareRelease.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { SafeOutputTree } from "../../../src/artifacts/SafeOutputTree.js";
import {
  normalizeBinwalkReport,
  normalizeUnblobReport,
} from "../../../src/firmware/FirmwareReports.js";
import {
  firmwareResultSchemas,
  firmwareRequestSchema,
} from "../../../src/domain/firmware/firmwareAnalysis.js";
import { createHash } from "node:crypto";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([
  ["invalid leading byte", [0xff]],
  ["incomplete sequence", [0xe2, 0x82]],
  ["overlong sequence", [0xc0, 0xaf]],
  ["encoded surrogate", [0xed, 0xa0, 0x80]],
])(
  "rejects complete JSON containing %s without repairing producer bytes",
  async (_name, bytes) => {
    const root = await createTestTempDirectory("rea-firmware-report-");
    const path = join(root, "report.json");
    await writeFile(
      path,
      Buffer.concat([
        Buffer.from('{"description":"'),
        Buffer.from(bytes),
        Buffer.from('"}'),
      ]),
    );
    await expect(
      new FirmwareFileAccess().report(path, "inspect_firmware_regions"),
    ).rejects.toMatchObject({
      _tag: "AnalysisOutputError",
      reason: "Tool report is not valid complete JSON",
    });
  },
);

it.each([
  ["missing", "Report was not created", async () => {}],
  ["empty", "Report is empty", (path: string) => writeFile(path, "")],
  [
    "invalid_json",
    "Tool report is not valid complete JSON",
    (path: string) => writeFile(path, '[{"Analysis":'),
  ],
  [
    "oversized",
    `Report exceeded ${FIRMWARE_LIMITS.reportBytes} bytes`,
    (path: string) =>
      writeFile(path, Buffer.alloc(FIRMWARE_LIMITS.reportBytes + 1, 0x20)),
  ],
  [
    "not_regular_file",
    "Report is not a regular file",
    (path: string) => mkdir(path),
  ],
] as const)(
  "keeps report state %s after a successful exit distinct from an empty scan",
  async (state, reason, prepare) => {
    const root = await createTestTempDirectory("rea-firmware-report-");
    const path = join(root, "report.json");
    await prepare(path);
    const failure: unknown = await readFirmwareCommandReport({
      path,
      engine: "binwalk",
      operation: "inspect_firmware_regions",
      execution: {
        stdout: { text: "", bytes: 0, observedBytes: 0 },
        stderr: { text: "", bytes: 0, observedBytes: 0 },
        exit_code: 0,
        signal: null,
        command: "/opt/binwalk",
        args: ["--quiet", "--log", path, "/work/firmware.bin"],
        resource_limiter: "/usr/bin/prlimit",
      },
      files: new FirmwareFileAccess(),
    }).catch((cause: unknown) => cause);
    if (!(failure instanceof AnalysisError))
      throw new Error("Expected a typed report failure");
    const projected = projectAnalysisError(failure);
    expect(projected).toMatchObject({
      code: "unreadable_output",
      retryable: false,
      message: expect.stringContaining("not an empty or complete result"),
      details: {
        reason: `binwalk exited 0 without a usable report: ${reason}`,
        diagnostics: {
          report_state: state,
          report_path: path,
          command: "/opt/binwalk",
          args: ["--quiet", "--log", path, "/work/firmware.bin"],
          resource_limiter: "/usr/bin/prlimit",
          exit_code: 0,
          signal: null,
          stdout_bytes: 0,
          stderr_bytes: 0,
        },
      },
    });
    // Generic doctor advice is not presented as a repair for a missing report.
    expect(projected.message).not.toContain("rea doctor");
    // Recorded arguments name a removed private workspace; recovery must not
    // present them as a replayable command.
    expect(projected.remediation.action).toContain("diagnostics.report_state");
    expect(projected.remediation.action).toContain("cannot be replayed as-is");
    if (state === "oversized") {
      expect(projected.remediation.action).toContain("no runtime override");
      expect(projected.remediation.action).toContain(
        "Repeating the unchanged request fails the same way",
      );
      expect(projected.remediation.action).not.toContain(
        "Rerun the same REA request",
      );
      expect(projected.message).toContain("no runtime override");
      expect(projected.message).not.toContain("Rerun the same REA request");
    } else {
      expect(projected.remediation.action).toContain(
        "replacing every private path",
      );
      expect(projected.remediation.action).toContain(
        "Rerun the same REA request",
      );
      expect(projected.remediation.action).not.toContain(
        "Repeating the unchanged request fails the same way",
      );
    }
  },
);

it("preserves valid Unicode and a literal replacement character in producer JSON", async () => {
  const root = await createTestTempDirectory("rea-firmware-report-");
  const path = join(root, "report.json");
  const report = { description: "固件 🧩 \ufffd", path: "/输入/firmware.bin" };
  await writeFile(path, JSON.stringify(report));
  expect(
    await new FirmwareFileAccess().report(path, "inspect_firmware_regions"),
  ).toEqual(report);
});

it("orders extracted firmware paths by code point independently of host locale", async () => {
  const root = await createTestTempDirectory("rea-firmware-inventory-");
  await mkdir(join(root, "Lib"));
  for (const path of ["a.bin", "z.bin", "\u00e4.bin", "B.bin", "Lib/x.bin"])
    await writeFile(join(root, path), "");
  const entries = await inventoryFirmwareOutput(
    root,
    1024,
    16,
    "inspect_firmware_regions",
  );
  // Locale collation would interleave case and place "ä" by language rules.
  expect(entries.map(({ relativePath }) => relativePath)).toEqual([
    "B.bin",
    "Lib/x.bin",
    "a.bin",
    "z.bin",
    "\u00e4.bin",
  ]);
});

it.skipIf(process.platform !== "linux")(
  "refuses raw filenames that cannot round-trip through UTF-8 instead of omitting their bytes",
  async () => {
    const root = await createTestTempDirectory("rea-firmware-raw-name-");
    await writeFile(
      Buffer.concat([
        Buffer.from(`${root}/bad`),
        Buffer.from([0xff]),
        Buffer.from(".bin"),
      ]),
      "123",
    );
    await writeFile(join(root, "good.bin"), "1234");
    await expect(
      inventoryFirmwareOutput(root, 4, 10, "extract_firmware"),
    ).rejects.toMatchObject({
      _tag: "AnalysisOutputError",
      diagnostics: { raw_name_hex: "626164ff2e62696e" },
    });
  },
);

it.each([
  { bytes: 1, files: 10, expected: "max_output_bytes" },
  { bytes: 10, files: 1, expected: "max_output_files" },
])(
  "reports the selected $expected staging budget as a deterministic resource refusal",
  async ({ bytes, files, expected }) => {
    const root = await createTestTempDirectory("rea-firmware-staging-");
    await writeFile(join(root, "a"), "1");
    await writeFile(join(root, "b"), "2");
    await expect(
      inventoryFirmwareOutput(root, bytes, files, "extract_firmware"),
    ).rejects.toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "capacity",
      reportedLimits: { [expected]: 1 },
      retryable: false,
      remediationAction: expect.stringContaining(expected),
    });
  },
);

it("attributes missing sources to the selected path without relabeling snapshot destination failure", async () => {
  const root = await createTestTempDirectory("rea-firmware-source-");
  const files = new FirmwareFileAccess();
  const request = (path: string) =>
    firmwareRequestSchema.parse({
      operation: "inspect_firmware_regions",
      input: { path },
    });
  await expect(
    files.snapshot(
      request(join(root, "absent")),
      root,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({
    _tag: "AnalysisInputError",
    issues: [{ path: ["path"], reason: "invalid_value" }],
  });
  const source = join(root, "source");
  await writeFile(source, "firmware");
  await expect(
    files.snapshot(
      request(source),
      join(root, "missing-workspace"),
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await files.close();
});

it("does not activate an abort-bound source during awaited destination setup", async () => {
  const root = await createTestTempDirectory("rea-firmware-publish-abort-");
  const source = join(root, "source");
  const bytes = Buffer.from("firmware");
  await writeFile(source, bytes);
  const files = new FirmwareFileAccess();
  const tree = await SafeOutputTree.create(join(root, "published"));
  const controller = new AbortController();
  const reason = { stop: "during destination setup" };
  const write = tree.write.bind(tree);
  const spy = vi.spyOn(tree, "write").mockImplementation(async (...args) => {
    controller.abort(reason);
    // Yield a turn while the source has no consumer, reproducing the handoff.
    await new Promise<void>((resolve) => setImmediate(resolve));
    return write(...args);
  });
  try {
    await expect(
      files.publish(
        {
          path: source,
          relativePath: "nested/file",
          kind: "file",
          size: bytes.length,
          linkTarget: null,
        },
        createHash("sha256").update(bytes).digest("hex"),
        tree,
        controller.signal,
      ),
    ).rejects.toMatchObject({ reason: "cancelled", cause: reason });
  } finally {
    spy.mockRestore();
    await tree.rollback();
    await files.close();
  }
  await expect(access(join(root, "published"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(Buffer.compare(await readFile(source), bytes)).toBe(0);
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "keeps denied source access distinct from invalid paths and producer failures",
  async () => {
    const root = await createTestTempDirectory("rea-firmware-source-denial-");
    const source = join(root, "input");
    await writeFile(source, "firmware", { mode: 0o000 });
    const files = new FirmwareFileAccess();
    try {
      await expect(
        files.snapshot(
          firmwareRequestSchema.parse({
            operation: "inspect_firmware_regions",
            input: { path: source },
          }),
          root,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        _tag: "AnalysisAccessDeniedError",
        path: source,
        systemCode: "EACCES",
      });
    } finally {
      await chmod(source, 0o600);
      await files.close();
    }
  },
);

it("retains unfamiliar Unblob report members from JSON files through public diagnostics", async () => {
  const root = await createTestTempDirectory("rea-firmware-report-metadata-");
  const inputPath = join(root, "input.bin");
  const reportPath = join(root, "report.json");
  const sha256 = "a".repeat(64);
  const unfamiliar: unknown = JSON.parse(
    '{"__typename__":"FutureReport","__proto__":{"source":"local","empty":null},"constructor":false,"prototype":0,"nested":{"__proto__":"retained"}}',
  );
  const record = {
    task: { path: inputPath, depth: 0, blob_id: "", is_multi_file: false },
    reports: [
      { __typename__: "HashReport", sha256 },
      {
        __typename__: "StatReport",
        path: inputPath,
        size: 4,
        is_dir: false,
        is_file: true,
        is_link: false,
        link_target: null,
      },
      unfamiliar,
    ],
    subtasks: [],
  };
  await writeFile(reportPath, JSON.stringify([record]));
  const files = new FirmwareFileAccess();
  try {
    const raw = await files.report(reportPath, "extract_firmware");
    const normalized = normalizeUnblobReport(raw, {
      inputPath,
      outputRoot: join(root, "output"),
      sha256,
      length: 4,
      offset: 0,
      maxDepth: 3,
    });
    const diagnostics =
      firmwareResultSchemas.extract_firmware.shape.diagnostics.parse(
        normalized.diagnostics,
      );
    expect(JSON.stringify(diagnostics)).toBe(
      JSON.stringify([{ input_path: "$input", report: unfamiliar }]),
    );
    expect(normalized.coverage).toBe("partial");
    for (const malformed of [{}, { __typename__: null }, { __typename__: 1 }]) {
      expect(() =>
        normalizeUnblobReport(
          [{ ...record, reports: [...record.reports.slice(0, 2), malformed] }],
          {
            inputPath,
            outputRoot: join(root, "output"),
            sha256,
            length: 4,
            offset: 0,
            maxDepth: 3,
          },
        ),
      ).toThrow();
    }
  } finally {
    await files.close();
  }
});

it("rejects Binwalk extraction activity under every own JSON member", async () => {
  const root = await createTestTempDirectory(
    "rea-firmware-report-extractions-",
  );
  const reportPath = join(root, "report.json");
  const inputPath = join(root, "input.bin");
  const files = new FirmwareFileAccess();
  try {
    for (const extractions of [
      "{}",
      '{"__proto__":null}',
      '{"ordinary":false}',
    ]) {
      await writeFile(
        reportPath,
        `[{"Analysis":{"file_path":${JSON.stringify(inputPath)},"file_map":[],"extractions":${extractions}}}]`,
      );
      const raw = await files.report(reportPath, "inspect_firmware_regions");
      const normalize = () => normalizeBinwalkReport(raw, inputPath, 4);
      if (extractions === "{}") expect(normalize()).toEqual([]);
      else expect(normalize).toThrow("Expected one inspection-only report");
    }
  } finally {
    await files.close();
  }
});
