import { createDeferred } from "../../tests/fixtures/binarySession.js";
import { PrivateRuntimeRoot } from "../process/PrivateRuntimeRoot.js";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  stat,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, onTestFinished, test, vi } from "vitest";

import { ApktoolProvider } from "./ApktoolProvider.js";
import {
  LinuxOwnedProcessPrerequisiteError,
  systemProcessOwnershipHost,
} from "../process/ProcessOwnershipObservation.js";
import { ApktoolWorkspace } from "./ApktoolWorkspace.js";
import { ApktoolResourceAnalysisService } from "../application/apktool/ApktoolResourceAnalysisService.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  apktoolRequestSchema,
  apktoolResultSchemas,
} from "../domain/apktool/apktoolResourceAnalysis.js";
import type { ApktoolRequest } from "../domain/apktool/apktoolResourceAnalysis.js";

const it = test.skipIf(process.platform === "win32");

const VERSION_BLOCK = "printf '2.7.0-dirty\\n'";

const REAL_YML = [
  "!!brut.androlib.meta.MetaInfo",
  "sdkInfo:",
  "  minSdkVersion: '24'",
  "  targetSdkVersion: '34'",
  "versionInfo:",
  "  versionCode: '7'",
  "  versionName: 1.2.3",
  "",
].join("\n");

const REAL_MANIFEST = [
  '<?xml version="1.0" encoding="utf-8" standalone="no"?>',
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.rea.apktool.probe">',
  '    <application android:label="@string/app_name" android:debuggable="true"/>',
  "</manifest>",
  "",
].join("\n");

const REAL_STRINGS = [
  '<?xml version="1.0" encoding="utf-8"?>',
  "<resources>",
  '    <string name="api_endpoint">https://api.example.com/v1</string>',
  '    <string name="app_name">ApktoolProbe</string>',
  "</resources>",
  "",
].join("\n");

const DE_STRINGS = [
  '<?xml version="1.0" encoding="utf-8"?>',
  "<resources>",
  '    <string name="app_name">ApktoolProbe DE</string>',
  "</resources>",
  "",
].join("\n");

const writeApktoolStub = async (
  body: (root: string) => string,
): Promise<{ readonly command: string; readonly root: string }> => {
  const root = await mkdtemp(join("/tmp", "rea-apktool-stub-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const command = join(root, "apktool");
  await writeFile(command, `#!/bin/sh\n${body(root)}\n`, { mode: 0o755 });
  await chmod(command, 0o755);
  return { command, root };
};

const providerOver = (command: string): ApktoolProvider =>
  new ApktoolProvider({
    environment: { REA_APKTOOL_COMMAND: command },
  });

const evidenceResult = async (
  provider: ApktoolProvider,
  request: ApktoolRequest,
): Promise<Record<string, unknown>> => {
  const result = await provider.execute(request);
  if (!result.ok) throw result.error;
  return result.value.result as Record<string, unknown>;
};

const refusedBy = async (
  provider: ApktoolProvider,
  request: ApktoolRequest,
): Promise<ReturnType<typeof projectAnalysisError>> => {
  const result = await provider.execute(request);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refusal");
  return projectAnalysisError(result.error);
};

/** Stub writing a real-shaped decoded workspace into the -o directory. */
const decodeStub = (
  options: {
    readonly withStrings?: boolean;
    readonly withGerman?: boolean;
    readonly failDecode?: boolean;
    readonly ymlFile?: string;
    readonly manifestFile?: string;
    readonly stringsFile?: string;
    readonly stringsXml?: string;
    readonly version?: string;
    readonly extraValuesDirectories?: readonly string[];
  } = {},
): ((root: string) => string) => {
  const withStrings = options.withStrings ?? true;
  const withGerman = options.withGerman ?? true;
  const extraValuesDirectories = options.extraValuesDirectories ?? [];
  const stringsXml = options.stringsXml ?? REAL_STRINGS;
  const ymlWrite =
    options.ymlFile === undefined
      ? `printf '%s\\n' '${REAL_YML.replace(/'/gu, "'\\''")}' > "$5/apktool.yml"`
      : `cp '${options.ymlFile}' "$5/apktool.yml"`;
  const manifestWrite =
    options.manifestFile === undefined
      ? `printf '%s\\n' '${REAL_MANIFEST.replace(/'/gu, "'\\''")}' > "$5/AndroidManifest.xml"`
      : `cp '${options.manifestFile}' "$5/AndroidManifest.xml"`;
  const stringsWrite =
    options.stringsFile === undefined
      ? `printf '%s\\n' '${stringsXml.replace(/'/gu, "'\\''")}' > "$5/res/values/strings.xml"`
      : `cp '${options.stringsFile}' "$5/res/values/strings.xml"`;
  const qualifierStrings = extraValuesDirectories
    .map(
      (name) =>
        `printf '%s\\n' '<resources><string name="wrong">Wrong</string></resources>' > "$5/res/values-${name}/strings.xml"`,
    )
    .join("\n  ");
  const versionBlock =
    options.version === undefined
      ? VERSION_BLOCK
      : `printf '%s\\n' '${options.version.replace(/'/gu, "'\\''")}'`;
  return () => `if [ "$1" = "--version" ]; then ${versionBlock}; exit 0; fi
if [ "$1" = "d" ]; then
  ${
    options.failDecode === true
      ? `printf 'Exception in thread "main" brut.androlib.AndrolibException: Could not decode the APK\\n' >&2; exit 1;`
      : `${ymlWrite}
  ${manifestWrite}
  mkdir -p "$5/res/values"${withGerman ? ' "$5/res/values-de"' : ""}${extraValuesDirectories.map((name) => ` "$5/res/values-${name}"`).join("")}
  ${withStrings ? stringsWrite : ""}
  ${withGerman ? `printf '%s\\n' '${DE_STRINGS.replace(/'/gu, "'\\''")}' > "$5/res/values-de/strings.xml"` : ""}
  ${qualifierStrings}
  printf 'I: Using Apktool on stub\\n'
  exit 0`
  }
fi
printf 'unexpected arguments: %s\\n' "$@"
exit 1`;
};

const apkFixture = async (
  root: string,
): Promise<{
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}> => {
  const path = join(root, "probe.apk");
  const bytes = "apk-bytes-for-apktool";
  await writeFile(path, bytes);
  return {
    path,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};

it("returns table-only facts for a single selected primary table", async () => {
  const { command, root } = await writeApktoolStub(decodeStub());
  const apk = await apkFixture(root);
  const provider = providerOver(command);
  onTestFinished(() => provider.close());
  const outcome = await new ApktoolResourceAnalysisService(provider).execute(
    "decode_android_resources",
    { path: apk.path, string_tables_only: true },
  );
  if (!outcome.ok) throw outcome.error;
  expect(outcome.value).toMatchObject({
    parameters: { path: apk.path, string_tables_only: true },
    subject: { digest: { sha256: apk.sha256 } },
    normalized_result: {
      strings: [],
      string_tables: [
        {
          locale: null,
          status: "present",
          strings: [
            { name: "api_endpoint", value: "https://api.example.com/v1" },
            { name: "app_name", value: "ApktoolProbe" },
          ],
          total_count: 2,
          unparsed_count: 0,
          coverage: "complete",
        },
      ],
    },
  });
});

it("publishes Apktool 3 producer-escaped metadata through the shared evidence workflow", async () => {
  const { command, root } = await writeApktoolStub((path) =>
    decodeStub({
      ymlFile: join(path, "producer.yml"),
      version: "3.0.3",
    })(path),
  );
  // A synthetic decoded workspace using the released 3.0.3 writer's format;
  // this exercises the production provider, not a real Apktool decoder.
  await writeFile(
    join(root, "producer.yml"),
    String.raw`version: 3.0.3
versionInfo:
  versionCode: 7
  versionName: 1.0 #beta \\ \uD83D\uDE80 \\u0041
sdkInfo:
  minSdkVersion: 24
  targetSdkVersion: 35
`,
  );
  const apk = await apkFixture(root);
  const original = await readFile(apk.path);
  const provider = providerOver(command);
  onTestFinished(() => provider.close());
  const outcome = await new ApktoolResourceAnalysisService(provider).execute(
    "decode_android_resources",
    { path: apk.path },
  );
  if (!outcome.ok) throw outcome.error;
  expect(outcome.value).toMatchObject({
    parameters: { path: apk.path },
    subject: { digest: { sha256: apk.sha256 } },
    normalized_result: {
      client: { apktool_version: "3.0.3" },
      target: { path: apk.path, sha256: apk.sha256, bytes: apk.bytes },
      metadata: {
        version_name: String.raw`1.0 #beta \ 🚀 \u0041`,
        version_code: "7",
        min_sdk_version: "24",
        target_sdk_version: "35",
      },
      coverage: "complete",
    },
  });
  expect(Buffer.compare(await readFile(apk.path), original)).toBe(0);
});

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "retains completed decode facts when a later locale read fails (cleanup denied: %s, late cancellation: %s)",
  async (denyCleanup, lateCancellation) => {
    const { command, root } = await writeApktoolStub((path) =>
      decodeStub()(path).replace(
        "  printf 'I: Using Apktool on stub",
        "  printf '\\377' > \"$5/res/values-de/strings.xml\"\n  printf 'I: Using Apktool on stub",
      ),
    );
    const apk = await apkFixture(root);
    let denied = denyCleanup;
    const controller = new AbortController();
    const provider = new ApktoolProvider({
      environment: { REA_APKTOOL_COMMAND: command },
      removeWorkspace: async (path) => {
        if (lateCancellation) controller.abort({ stage: "cleanup" });
        if (denied) throw new Error("authored removal denial");
        await rm(path, { recursive: true, force: true });
      },
    });
    try {
      const result = await provider.execute(
        {
          operation: "decode_android_resources",
          input: { path: apk.path, include_strings: true, locales: ["de"] },
        },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected invalid UTF-8 failure");
      expect((result.error.cleanupPrimary ?? result.error).message).toContain(
        "UTF-8",
      );
      expect(result.error.cleanupIncomplete).toBe(denyCleanup);
      const observation = {
        operation: "decode_android_resources",
        parameters: { path: apk.path, locales: ["de"] },
        subject: { local_path: apk.path, digest: { sha256: apk.sha256 } },
        normalized_result: {
          metadata: { package_name: "com.rea.apktool.probe" },
          manifest: `${REAL_MANIFEST}\n`,
          strings: [
            { name: "api_endpoint", value: "https://api.example.com/v1" },
            { name: "app_name", value: "ApktoolProbe" },
          ],
          string_tables: [{ locale: null, status: "present", total_count: 2 }],
          coverage: "partial",
        },
      };
      expect(result.error.partialObservation).toMatchObject(observation);
      expect(projectAnalysisError(result.error)).toMatchObject({
        details: { partial_observation: observation },
      });
      denied = false;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(result.error.partialObservation).toMatchObject(observation);
    } finally {
      denied = false;
      await provider.close();
    }
  },
);

it.each(
  (["manifest-bytes", "manifest-xml", "inventory"] as const).flatMap((stage) =>
    [false, true].map((denied) => [stage, denied] as const),
  ),
)(
  "retains parsed metadata when %s fails before string projection (cleanup denied: %s)",
  async (stage, denyCleanup) => {
    const { command, root } = await writeApktoolStub(decodeStub());
    const apk = await apkFixture(root);
    if (stage === "inventory") {
      const entries = ApktoolWorkspace.prototype.entries;
      const spy = vi
        .spyOn(ApktoolWorkspace.prototype, "entries")
        .mockImplementationOnce(async function* (
          this: ApktoolWorkspace,
          ...args
        ) {
          for await (const entry of entries.apply(this, args)) {
            yield entry;
            if (entry.kind === "file")
              throw new Error("authored enumeration failure");
          }
        });
      onTestFinished(() => spy.mockRestore());
    } else {
      const manifestFile = join(root, "manifest-control");
      await writeFile(
        manifestFile,
        stage === "manifest-bytes" ? Buffer.from([255]) : "<resources/>",
      );
      await writeFile(
        command,
        `#!/bin/sh\n${decodeStub({ manifestFile })(root)}`,
        { mode: 0o755 },
      );
    }
    const controller = new AbortController();
    let denied = denyCleanup;
    const provider = new ApktoolProvider({
      environment: { REA_APKTOOL_COMMAND: command },
      removeWorkspace: async (path) => {
        controller.abort({ stage: "final cleanup" });
        if (denied) throw new Error("authored staged removal denial");
        await rm(path, { recursive: true, force: true });
      },
    });
    try {
      const result = await provider.execute(
        {
          operation: "decode_android_resources",
          input: { path: apk.path, include_strings: true },
        },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected staged read failure");
      expect((result.error.cleanupPrimary ?? result.error)._tag).toBe(
        "AnalysisProtocolError",
      );
      expect(controller.signal.aborted).toBe(true);
      expect(result.error.cleanupIncomplete).toBe(denyCleanup);
      const observation = result.error.partialObservation;
      expect(observation).toMatchObject({
        operation: "decode_android_resources",
        subject: { local_path: apk.path, digest: { sha256: apk.sha256 } },
        normalized_result: {
          coverage: "partial",
          metadata: {
            version_name: "1.2.3",
            version_code: "7",
            min_sdk_version: "24",
            target_sdk_version: "34",
          },
        },
      });
      const projected = projectAnalysisError(result.error).details
        ?.partial_observation;
      expect(projected).toEqual(observation);
      expect(observation).toHaveProperty("normalized_result");
      if (observation === undefined || !("normalized_result" in observation))
        throw new Error("Expected partial Evidence");
      expect(observation.normalized_result).not.toHaveProperty("strings");
      if (stage !== "inventory") {
        expect(observation.normalized_result).not.toHaveProperty(
          "decoded_file_count",
        );
        expect(observation.normalized_result).not.toHaveProperty(
          "metadata.package_name",
        );
      }
      if (stage === "manifest-bytes")
        expect(observation.normalized_result).not.toHaveProperty("manifest");
      if (stage === "manifest-xml")
        expect(observation.normalized_result).toHaveProperty(
          "manifest",
          "<resources/>",
        );
      if (stage === "inventory")
        expect(observation.normalized_result).toMatchObject({
          decoded_file_count: 1,
          metadata: { package_name: "com.rea.apktool.probe" },
        });
      denied = false;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
      expect(result.error.partialObservation).toEqual(observation);
    } finally {
      denied = false;
      await provider.close();
    }
  },
);

it("inspects the apktool launcher", async () => {
  const { command } = await writeApktoolStub(
    () => `if [ "$1" = "--version" ]; then ${VERSION_BLOCK}; exit 0; fi`,
  );
  const result = await evidenceResult(providerOver(command), {
    operation: "inspect_apktool_client",
    input: {},
  });
  expect(result.client).toEqual({
    command,
    command_source: "environment",
    apktool_version: "2.7.0-dirty",
  });
});

it("decodes resources with target identity, metadata, and strings", async () => {
  const { command, root } = await writeApktoolStub(decodeStub());
  const apk = await apkFixture(root);
  const result = await evidenceResult(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  expect(result.target).toEqual({
    path: apk.path,
    bytes: apk.bytes,
    sha256: apk.sha256,
  });
  expect(result.metadata).toEqual({
    version_name: "1.2.3",
    version_code: "7",
    min_sdk_version: "24",
    target_sdk_version: "34",
    package_name: "com.rea.apktool.probe",
  });
  expect(result.manifest).toContain('package="com.rea.apktool.probe"');
  expect(result.strings).toEqual([
    { name: "api_endpoint", value: "https://api.example.com/v1" },
    { name: "app_name", value: "ApktoolProbe" },
  ]);
  expect(result.locales).toEqual(["de"]);
  expect(result.locale).toBeNull();
  expect(result.decoded_file_count).toBeGreaterThan(2);
  expect(result.coverage).toBe("complete");
});

it.each([
  {
    name: "malformed UTF-8",
    bytes: Buffer.concat([
      Buffer.from("versionInfo:\n  versionName: com."),
      Buffer.from([0xff]),
      Buffer.from(".app\n"),
    ]),
    valid: false,
  },
  {
    name: "a literal replacement character",
    bytes: Buffer.from("versionInfo:\n  versionName: com.�.app\n", "utf8"),
    valid: true,
  },
])("handles $name in producer metadata", async ({ bytes, valid }) => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub({ ymlFile: join(root, "malformed-apktool.yml") })(root),
  );
  await writeFile(join(root, "malformed-apktool.yml"), bytes);
  const apk = await apkFixture(root);
  if (valid) {
    const result = await evidenceResult(providerOver(command), {
      operation: "decode_android_resources",
      input: { path: apk.path, include_strings: false },
    });
    expect(result.metadata).toMatchObject({ version_name: "com.�.app" });
    expect(result.coverage).toBe("complete");
    return;
  }
  const result = await providerOver(command).execute({
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: false },
  });
  if (result.ok) throw new Error("expected invalid producer output");
  const projected = projectAnalysisError(result.error);
  expect(projected).toMatchObject({ code: "unreadable_output" });
  expect(result.error.message).toContain("invalid UTF-8");
  expect(result.error.message).toContain("apktool.yml");
});

it("preserves empty resource strings and reports markup omissions as partial", async () => {
  const stringsXml =
    '<resources><string name="empty"/><string name="raw">  A &amp; B  </string><string name="styled">Hello <b>world</b></string></resources>';
  const { command, root } = await writeApktoolStub(decodeStub({ stringsXml }));
  const apk = await apkFixture(root);
  const result = await evidenceResult(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  expect(result.strings).toEqual([
    { name: "empty", value: "" },
    { name: "raw", value: "  A &amp; B  " },
  ]);
  expect(result.coverage).toBe("partial");
});

it("preserves literal U+FFFD in decoded XML with complete coverage", async () => {
  const stringsXml =
    '<resources><string name="good">Hello</string><string name="edge">\uFFFD</string></resources>';
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub({
      stringsXml,
      manifestFile: join(root, "AndroidManifest.xml"),
    })(root),
  );
  const manifest = REAL_MANIFEST.replace("@string/app_name", "\uFFFD");
  await writeFile(join(root, "AndroidManifest.xml"), manifest, "utf8");
  const apk = await apkFixture(root);
  const result = await evidenceResult(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  expect(result).toMatchObject({
    manifest,
    metadata: { package_name: "com.rea.apktool.probe" },
    strings: [
      { name: "good", value: "Hello" },
      { name: "edge", value: "\uFFFD" },
    ],
    coverage: "complete",
  });
});

it("still refuses invalid UTF-8 bytes in decoded strings", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub({ stringsFile: join(root, "strings.xml") })(root),
  );
  await writeFile(
    join(root, "strings.xml"),
    Buffer.concat([
      Buffer.from('<resources><string name="bad">'),
      Buffer.from([0xff]),
      Buffer.from("</string></resources>"),
    ]),
  );
  const apk = await apkFixture(root);
  const result = await providerOver(command).execute({
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected a refusal");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "unreadable_output",
  });
  expect(result.error.message).toContain("invalid UTF-8");
  expect(result.error.message).toContain("strings.xml");
});

it("ignores Android resource qualifiers when discovering locales", async () => {
  const { command, root } = await writeApktoolStub(
    decodeStub({ extraValuesDirectories: ["car", "night", "v21"] }),
  );
  const apk = await apkFixture(root);
  const result = await evidenceResult(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  expect(result.locales).toEqual(["de"]);
  expect(result.decoded_file_count).toBe(7);
});

it.each(["car", "night", "v21"])(
  "rejects %s as a requested locale",
  (locale) => {
    expect(
      apktoolRequestSchema.safeParse({
        operation: "decode_android_resources",
        input: { path: "/tmp/probe.apk", locale },
      }).success,
    ).toBe(false);
  },
);

it("projects one locale's strings on request", async () => {
  const { command, root } = await writeApktoolStub(decodeStub());
  const apk = await apkFixture(root);
  const result = await evidenceResult(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true, locale: "de" },
  });
  expect(result.locale).toBe("de");
  expect(result.strings).toEqual([
    { name: "app_name", value: "ApktoolProbe DE" },
  ]);
});

it("notes a missing locale table instead of failing", async () => {
  const { command, root } = await writeApktoolStub(decodeStub());
  const apk = await apkFixture(root);
  const result = await evidenceResult(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true, locale: "fr" },
  });
  expect(result.strings).toEqual([]);
});

it("notes a missing default strings table without strings", async () => {
  const { command, root } = await writeApktoolStub(
    decodeStub({ withStrings: false }),
  );
  const apk = await apkFixture(root);
  const result = await evidenceResult(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  expect(result.strings).toEqual([]);
});

it("reports apktool's own refusal for undecodable targets", async () => {
  const { command, root } = await writeApktoolStub(
    decodeStub({ failDecode: true }),
  );
  const apk = await apkFixture(root);
  const projected = await refusedBy(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  expect(projected).toMatchObject({
    code: "unsupported_target",
    details: { path: apk.path },
  });
  expect(projected.message).toContain(apk.path);
  expect(projected.message).not.toContain(command);
  expect(projected.message).toContain("Could not decode");
});

it("reports a missing launcher as a capability gap with recovery", async () => {
  const provider = new ApktoolProvider({
    environment: { REA_APKTOOL_COMMAND: "/nonexistent/apktool" },
  });
  const availability = await provider.inspectAvailability();
  expect(availability).toMatchObject({
    status: "unavailable",
    code: "executable_missing",
  });
  const projected = await refusedBy(provider, {
    operation: "inspect_apktool_client",
    input: {},
  });
  expect(projected).toMatchObject({ code: "capability_unavailable" });
  expect(projected.details).toMatchObject({
    provider_id: "apktool",
    reason: expect.stringContaining("REA_APKTOOL_COMMAND") as unknown,
  });
});

it("fails closed for unrecognized and unsupported Apktool versions", async () => {
  const invalidOutput = `unexpected Apktool output ${"x".repeat(700)}\n`;
  const unrecognized = await writeApktoolStub(
    () => `printf '%s' '${invalidOutput}'; exit 0`,
  );
  await expect(
    providerOver(unrecognized.command).inspectAvailability(),
  ).resolves.toMatchObject({
    status: "unavailable",
    code: "version_unresolved",
    diagnostics: {
      reported_version: invalidOutput.trim(),
      stdout: invalidOutput,
    },
  });

  const old = await writeApktoolStub(() => `printf '2.6.3\\n'`);
  await expect(
    providerOver(old.command).inspectAvailability(),
  ).resolves.toMatchObject({
    status: "unavailable",
    code: "unsupported_version",
  });

  const prerelease = await writeApktoolStub(() => `printf '2.7.0-beta.1\\n'`);
  await expect(
    providerOver(prerelease.command).inspectAvailability(),
  ).resolves.toMatchObject({
    status: "unavailable",
    code: "unsupported_version",
  });
});

it("rejects a target that is not a readable file", async () => {
  const { command, root } = await writeApktoolStub(decodeStub());
  const projected = await refusedBy(providerOver(command), {
    operation: "decode_android_resources",
    input: { path: join(root, "absent.apk"), include_strings: true },
  });
  expect(projected).toMatchObject({ code: "invalid_request" });
});

it("cancels before spawning anything", async () => {
  const { command, root } = await writeApktoolStub(
    (root) => `: > ${join(root, "spawned")}
if [ "$1" = "--version" ]; then ${VERSION_BLOCK}; exit 0; fi`,
  );
  const controller = new AbortController();
  controller.abort();
  const result = await providerOver(command).execute(
    {
      operation: "decode_android_resources",
      input: { path: "/targets/x.apk", include_strings: true },
    },
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cancelled",
  });
  expect(
    await readFile(join(root, "spawned")).then(
      () => true,
      () => false,
    ),
  ).toBe(false);
});

it("uses an owned APK snapshot and framework cache and resolves regional locales", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub()(root).replace(
      'if [ "$1" = "d" ]; then',
      `if [ "$1" = "d" ]; then
    [ "$6" = "--frame-path" ] || exit 7
    [ -d "$7" ] || exit 8
    printf 'changed original' > "${join(root, "probe.apk")}"
    cat "$8" > "${join(root, "snapshot-bytes")}"
    mkdir -p "$5/res/values-pt-rBR"
    printf '<resources><string name="greeting">Olá</string></resources>' > "$5/res/values-pt-rBR/strings.xml"`,
    ),
  );
  const apk = await apkFixture(root);
  const observation = await new ApktoolResourceAnalysisService(
    providerOver(command),
  ).execute("decode_android_resources", {
    path: apk.path,
    include_strings: true,
    locale: "pt-BR",
  });
  if (!observation.ok) throw observation.error;
  expect(observation.value.subject).toMatchObject({
    local_path: apk.path,
    format: "apk",
    digest: { sha256: apk.sha256 },
  });
  expect(observation.value.limitations).not.toContain(
    "Artifact identity is unavailable for this observation.",
  );
  expect(await readFile(apk.path, "utf8")).toBe("changed original");
  const result = apktoolResultSchemas.decode_android_resources.parse(
    observation.value.normalized_result,
  );
  expect(result.target).toMatchObject({
    sha256: apk.sha256,
    bytes: apk.bytes,
    path: apk.path,
  });
  expect(await readFile(join(root, "snapshot-bytes"), "utf8")).toBe(
    "apk-bytes-for-apktool",
  );
  expect(result.strings).toEqual([{ name: "greeting", value: "Olá" }]);
});

it("shares one decode across default and selected locale tables", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub({ withGerman: false })(root).replace(
      'if [ "$1" = "d" ]; then',
      `if [ "$1" = "d" ]; then
    printf 'd\\n' >> "${root}/decode-invocations.log"
    mkdir -p "$5/res/values-de" "$5/res/values-pt-rBR"
    printf '<resources><string name="greeting">Hallo</string></resources>' > "$5/res/values-de/strings.xml"
    printf '<resources><string name="greeting">Olá</string></resources>' > "$5/res/values-pt-rBR/strings.xml"`,
    ),
  );
  const apk = await apkFixture(root);
  const observation = await new ApktoolResourceAnalysisService(
    providerOver(command),
  ).execute("decode_android_resources", {
    path: apk.path,
    include_strings: true,
    locales: ["de", "pt-BR"],
  });
  if (!observation.ok) throw observation.error;
  const result = apktoolResultSchemas.decode_android_resources.parse(
    observation.value.normalized_result,
  );
  expect(result.string_tables).toEqual([
    {
      locale: null,
      status: "present",
      strings: [
        { name: "api_endpoint", value: "https://api.example.com/v1" },
        { name: "app_name", value: "ApktoolProbe" },
      ],
      total_count: 2,
      unparsed_count: 0,
      coverage: "complete",
    },
    {
      locale: "de",
      status: "present",
      strings: [{ name: "greeting", value: "Hallo" }],
      total_count: 1,
      unparsed_count: 0,
      coverage: "complete",
    },
    {
      locale: "pt-BR",
      status: "present",
      strings: [{ name: "greeting", value: "Olá" }],
      total_count: 1,
      unparsed_count: 0,
      coverage: "complete",
    },
  ]);
  expect(result.strings).toEqual([
    { name: "api_endpoint", value: "https://api.example.com/v1" },
    { name: "app_name", value: "ApktoolProbe" },
  ]);
  expect(result.locale).toBe(null);
  expect(result.coverage).toBe("complete");

  const invocations = (
    await readFile(join(root, "decode-invocations.log"), "utf8").catch(() => "")
  )
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  expect(invocations).toHaveLength(1);
});

it("reuses normalized directory table for locale aliases without extra reads", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub()(root).replace(
      'if [ "$1" = "d" ]; then',
      `if [ "$1" = "d" ]; then
    printf 'd\\n' >> "${root}/decode-invocations.log"
    mkdir -p "$5/res/values-pt-rBR"
    printf '<resources><string name="greeting">Olá</string></resources>' > "$5/res/values-pt-rBR/strings.xml"`,
    ),
  );
  const apk = await apkFixture(root);
  const observation = await new ApktoolResourceAnalysisService(
    providerOver(command),
  ).execute("decode_android_resources", {
    path: apk.path,
    include_strings: true,
    locale: "pt-BR",
    locales: ["pt-rBR"],
  });
  if (!observation.ok) throw observation.error;
  const result = apktoolResultSchemas.decode_android_resources.parse(
    observation.value.normalized_result,
  );
  expect(result.string_tables).toEqual([
    {
      locale: "pt-BR",
      status: "present",
      strings: [{ name: "greeting", value: "Olá" }],
      total_count: 1,
      unparsed_count: 0,
      coverage: "complete",
    },
    {
      locale: "pt-rBR",
      status: "present",
      strings: [{ name: "greeting", value: "Olá" }],
      total_count: 1,
      unparsed_count: 0,
      coverage: "complete",
    },
  ]);
  const invocations = (
    await readFile(join(root, "decode-invocations.log"), "utf8").catch(() => "")
  )
    .trim()
    .split("\n")
    .filter((line) => line.length > 0);
  expect(invocations).toHaveLength(1);
});

it.each([2000, 2001])(
  "retains observed alias counts after exhausting the aggregate entry budget (%i entries)",
  async (entryCount) => {
    const { command, root } = await writeApktoolStub((root) =>
      decodeStub({ withGerman: false, withStrings: false })(root).replace(
        'if [ "$1" = "d" ]; then',
        `if [ "$1" = "d" ]; then
    for suffix in pt-rBR de es it; do
      mkdir -p "$5/res/values-$suffix"
      cp '${join(root, "strings.xml")}' "$5/res/values-$suffix/strings.xml"
    done`,
      ),
    );
    const entries = Array.from(
      { length: entryCount },
      (_, i) => `<string name="s_${String(i)}">value</string>`,
    ).join("");
    await writeFile(
      join(root, "strings.xml"),
      `<resources>${entries}<string name="styled"><b>unknown</b></string></resources>`,
    );
    const apk = await apkFixture(root);
    const provider = providerOver(command);
    try {
      const observation = await new ApktoolResourceAnalysisService(
        provider,
      ).execute("decode_android_resources", {
        path: apk.path,
        include_strings: true,
        locale: "pt-BR",
        locales: ["de", "es", "it", "pt-rBR"],
      });
      if (!observation.ok) throw observation.error;
      const result = apktoolResultSchemas.decode_android_resources.parse(
        observation.value.normalized_result,
      );
      expect(result.string_tables?.at(-1)).toEqual({
        locale: "pt-rBR",
        status: "skipped",
        strings: [],
        total_count: entryCount,
        unparsed_count: 1,
        coverage: "partial",
      });
      expect(result.strings).toHaveLength(2000);
      expect(
        observation.value.limitations.some((note) =>
          note.startsWith("Locale pt-rBR strings reports the first"),
        ),
      ).toBe(false);
      expect(result.coverage).toBe("partial");
    } finally {
      await provider.close();
    }
  },
);

it("skips all string tables when include_strings is false despite locales requested", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub({ withGerman: false })(root).replace(
      'if [ "$1" = "d" ]; then',
      `if [ "$1" = "d" ]; then
    mkdir -p "$5/res/values-de"
    printf '<resources><string name="greeting">Hallo</string></resources>' > "$5/res/values-de/strings.xml"`,
    ),
  );
  const apk = await apkFixture(root);
  const observation = await new ApktoolResourceAnalysisService(
    providerOver(command),
  ).execute("decode_android_resources", {
    path: apk.path,
    include_strings: false,
    locales: ["de"],
  });
  if (!observation.ok) throw observation.error;
  const result = apktoolResultSchemas.decode_android_resources.parse(
    observation.value.normalized_result,
  );
  expect(result.string_tables).toEqual([]);
  expect(result.strings).toEqual([]);
});

it("marks table with styled markup present with partial coverage and unparsed count", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub({ withGerman: false })(root).replace(
      'if [ "$1" = "d" ]; then',
      `if [ "$1" = "d" ]; then
    mkdir -p "$5/res/values-de"
    printf '<resources><string name="styled">Hallo <b>Welt</b></string></resources>' > "$5/res/values-de/strings.xml"`,
    ),
  );
  const apk = await apkFixture(root);
  const observation = await new ApktoolResourceAnalysisService(
    providerOver(command),
  ).execute("decode_android_resources", {
    path: apk.path,
    include_strings: true,
    locales: ["de"],
  });
  if (!observation.ok) throw observation.error;
  const result = apktoolResultSchemas.decode_android_resources.parse(
    observation.value.normalized_result,
  );
  const deTable = result.string_tables?.find((t) => t.locale === "de");
  expect(deTable).toEqual({
    locale: "de",
    status: "present",
    strings: [],
    total_count: 0,
    unparsed_count: 1,
    coverage: "partial",
  });
});

it("skips remaining tables without reading or parsing once aggregate string budget is exhausted", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub({
      withGerman: false,
      stringsFile: join(root, "big-strings.xml"),
    })(root).replace(
      'if [ "$1" = "d" ]; then',
      `if [ "$1" = "d" ]; then
    mkdir -p "$5/res/values-de" "$5/res/values-es" "$5/res/values-it" "$5/res/values-fr"
    cp '${join(root, "big-strings.xml")}' "$5/res/values-de/strings.xml"
    cp '${join(root, "big-strings.xml")}' "$5/res/values-es/strings.xml"
    cp '${join(root, "big-strings.xml")}' "$5/res/values-it/strings.xml"
    printf '<resources><broken' > "$5/res/values-fr/strings.xml"`,
    ),
  );
  const bigStrings = `<resources>${Array.from({ length: 2000 }, (_, i) => `<string name="s_${String(i)}">val</string>`).join("")}</resources>`;
  await writeFile(join(root, "big-strings.xml"), bigStrings);
  const apk = await apkFixture(root);
  const observation = await new ApktoolResourceAnalysisService(
    providerOver(command),
  ).execute("decode_android_resources", {
    path: apk.path,
    include_strings: true,
    locales: ["de", "es", "it", "fr"],
  });
  if (!observation.ok) throw observation.error;
  const result = apktoolResultSchemas.decode_android_resources.parse(
    observation.value.normalized_result,
  );
  const frTable = result.string_tables?.find((t) => t.locale === "fr");
  expect(frTable).toEqual({
    locale: "fr",
    status: "skipped",
    strings: [],
    total_count: null,
    unparsed_count: null,
    coverage: "partial",
  });
  expect(result.coverage).toBe("partial");
});

it("marks an oversized strings document partial without claiming it is missing", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub({ stringsFile: join(root, "large-strings.xml") })(root),
  );
  await writeFile(join(root, "large-strings.xml"), "");
  await truncate(join(root, "large-strings.xml"), 9 * 1024 * 1024);
  const apk = await apkFixture(root);
  const result = await providerOver(command).execute({
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  if (!result.ok) throw result.error;
  expect(result.value.result).toMatchObject({
    coverage: "partial",
    strings: [],
  });
  expect(result.value.limitations.join(" ")).toContain("exceeds");
  expect(result.value.limitations.join(" ")).not.toContain("No default");
});

describe("truncated manifest prefixes", () => {
  it.each([
    {
      name: "a retained prefix ending after the root element",
      manifest: `<manifest package="com.rea.large"></manifest>${" ".repeat(512 * 1024 + 1)}`,
    },
    {
      name: "a retained prefix ending before the root element closes",
      manifest: `<manifest package="com.rea.large">${" ".repeat(512 * 1024 + 1)}</manifest>`,
    },
  ])("retains $name without parsing its package", async ({ manifest }) => {
    const { command, root } = await writeApktoolStub((root) =>
      decodeStub({ manifestFile: join(root, "large-AndroidManifest.xml") })(
        root,
      ),
    );
    await writeFile(join(root, "large-AndroidManifest.xml"), manifest);
    const apk = await apkFixture(root);

    const result = await providerOver(command).execute({
      operation: "decode_android_resources",
      input: { path: apk.path, include_strings: false },
    });
    if (!result.ok) throw result.error;

    expect(result.value.result).toMatchObject({
      coverage: "partial",
      manifest: manifest.slice(0, 512 * 1024),
      metadata: { package_name: null, version_name: "1.2.3" },
    });
    expect(result.value.limitations.join(" ")).toContain(
      "manifest is truncated",
    );
  });
});

it("retains failed workspace cleanup and retries it on close", async () => {
  const { command, root } = await writeApktoolStub(
    decodeStub({ failDecode: true }),
  );
  const apk = await apkFixture(root);
  let attempts = 0;
  let owned: string | undefined;
  const provider = new ApktoolProvider({
    environment: { REA_APKTOOL_COMMAND: command },
    removeWorkspace: async (path) => {
      owned = path;
      if (++attempts === 1) throw new Error("busy");
      await rm(path, { recursive: true, force: true });
    },
  });
  const result = await provider.execute({
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.cleanup?.resources).toContain(owned);
  await provider.close();
  expect(attempts).toBe(2);
});

it("accepts a BCP47 resource qualifier through the public request schema", async () => {
  const { command, root } = await writeApktoolStub((root) =>
    decodeStub()(root).replace(
      "  printf 'I: Using Apktool on stub",
      '  mkdir -p "$5/res/values-b+zh+Hans+CN"\n  printf \'<resources><string name="greeting">你好</string></resources>\' > "$5/res/values-b+zh+Hans+CN/strings.xml"\n  printf \'I: Using Apktool on stub',
    ),
  );
  const apk = await apkFixture(root);
  const request = apktoolRequestSchema.parse({
    operation: "decode_android_resources",
    input: { path: apk.path, locale: "b+zh+Hans+CN" },
  });
  const result = await evidenceResult(providerOver(command), request);
  expect(result.strings).toEqual([{ name: "greeting", value: "你好" }]);
});

it("retains completed Evidence and live cleanup until a denied workspace removal recovers", async () => {
  const { command, root } = await writeApktoolStub(decodeStub());
  const apk = await apkFixture(root);
  let denied = true;
  let owned: string | undefined;
  const provider = new ApktoolProvider({
    environment: { REA_APKTOOL_COMMAND: command },
    removeWorkspace: async (path) => {
      owned = path;
      if (denied) throw new Error("authored removal denial");
      await rm(path, { recursive: true, force: true });
    },
  });
  try {
    const result = await provider.execute({
      operation: "decode_android_resources",
      input: { path: apk.path, include_strings: true },
    });
    if (result.ok) throw new Error("Expected cleanup failure");
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(result.error.partialObservation).toMatchObject({
      operation: "decode_android_resources",
      subject: { local_path: apk.path, digest: { sha256: apk.sha256 } },
      normalized_result: {
        metadata: { package_name: "com.rea.apktool.probe" },
        strings: [
          { name: "api_endpoint", value: "https://api.example.com/v1" },
          { name: "app_name", value: "ApktoolProbe" },
        ],
      },
    });
    const blocked = await provider.execute({
      operation: "inspect_apktool_client",
      input: {},
    });
    if (blocked.ok)
      throw new Error("Expected retained-workspace admission refusal");
    expect(blocked.error.cleanupIncomplete).toBe(true);
    expect(blocked.error.cleanupResources).toContain(owned);
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    denied = false;
    await provider.close();
    expect(result.error.cleanupIncomplete).toBe(false);
    expect(blocked.error.cleanupIncomplete).toBe(false);
    expect(result.error.partialObservation).toMatchObject({
      normalized_result: { target: { sha256: apk.sha256 } },
    });
  } finally {
    denied = false;
    await provider.close();
  }
});

it.each([
  [false, "2.7.0-dirty", "CVE-2024-21633", undefined],
  [true, "2.7.0-dirty", "CVE-2024-21633", undefined],
  [false, "3.0.1", "CVE-2026-39973", undefined],
  [true, "3.0.1", "CVE-2026-39973", undefined],
  [
    false,
    "3.0.1",
    "CVE-2026-39973",
    "<resources><string name=unquoted>bad</string></resources>",
  ],
  [
    true,
    "3.0.1",
    "CVE-2026-39973",
    "<resources><string name=unquoted>bad</string></resources>",
  ],
] as const)(
  "preserves completed Evidence and cancellation during workspace cleanup (denied=%s, version=%s, advisory=%s, XML=%s)",
  async (deniedInitially, version, advisory, stringsXml) => {
    const { command, root } = await writeApktoolStub((root) =>
      decodeStub(stringsXml === undefined ? {} : { stringsXml })(root).replace(
        VERSION_BLOCK,
        `printf '%s\\n' '${version}'`,
      ),
    );
    const apk = await apkFixture(root);
    const controller = new AbortController();
    const reason = { caller: "during final workspace removal" };
    let denied = deniedInitially;
    const provider = new ApktoolProvider({
      environment: { REA_APKTOOL_COMMAND: command },
      removeWorkspace: async (path) => {
        controller.abort(reason);
        if (denied) throw new Error("authored denial");
        await rm(path, { recursive: true, force: true });
      },
    });
    try {
      const result = await provider.execute(
        {
          operation: "decode_android_resources",
          input: { path: apk.path, include_strings: true },
        },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected finalization cancellation");
      const primary = result.error.cleanupPrimary ?? result.error;
      expect(primary._tag).toBe("AnalysisCancelledError");
      expect(primary.cause).toBe(reason);
      expect(result.error.cleanupIncomplete).toBe(deniedInitially);
      expect(result.error.partialObservation).toMatchObject({
        operation: "decode_android_resources",
        normalized_result: { target: { sha256: apk.sha256 } },
        limitations: expect.arrayContaining([
          expect.stringContaining(advisory),
        ]),
      });
      if (stringsXml !== undefined)
        expect(result.error.partialObservation).toMatchObject({
          limitations: expect.arrayContaining([
            expect.stringContaining("entry counts are unknown"),
          ]),
        });
      denied = false;
      await provider.close();
      expect(result.error.cleanupIncomplete).toBe(false);
    } finally {
      denied = false;
      await provider.close();
    }
  },
);

it.each(["decode", "projection"] as const)(
  "keeps a recorded %s failure primary when cancellation arrives during removal",
  async (stage) => {
    const { command, root } = await writeApktoolStub(
      decodeStub({ failDecode: stage === "decode" }),
    );
    const apk = await apkFixture(root);
    if (stage === "projection") {
      const bad = join(root, "bad.xml");
      await writeFile(bad, Buffer.from([0xff]));
      await writeFile(
        command,
        "#!/bin/sh\n" + decodeStub({ stringsFile: bad })(root),
        { mode: 0o755 },
      );
    }
    const controller = new AbortController();
    const provider = new ApktoolProvider({
      environment: { REA_APKTOOL_COMMAND: command },
      removeWorkspace: async (path) => {
        controller.abort({ caller: "after decode refusal" });
        await rm(path, { recursive: true, force: true });
      },
    });
    try {
      const result = await provider.execute(
        {
          operation: "decode_android_resources",
          input: { path: apk.path, include_strings: true },
        },
        { signal: controller.signal },
      );
      if (result.ok) throw new Error("Expected decode refusal");
      expect(controller.signal.aborted).toBe(true);
      expect(result.error._tag).toBe(
        stage === "decode"
          ? "AnalysisUnsupportedTargetError"
          : "AnalysisProtocolError",
      );
      if (stage === "decode")
        expect(result.error.capturedOutput?.stderr).toContain(
          "Could not decode the APK",
        );
      expect(result.error.partialObservation).toMatchObject(
        stage === "decode"
          ? {
              kind: "file-snapshot-hash",
              path: apk.path,
              sha256: apk.sha256,
            }
          : {
              operation: "decode_android_resources",
              subject: { local_path: apk.path, digest: { sha256: apk.sha256 } },
              normalized_result: {
                coverage: "partial",
                metadata: { package_name: "com.rea.apktool.probe" },
                strings: [],
              },
            },
      );
    } finally {
      await provider.close();
    }
  },
);

it("releases successful workspace peers once while retaining a denied peer for retry", async () => {
  const { command, root } = await writeApktoolStub(decodeStub());
  const apk = await apkFixture(root);
  let deniedRoot: string | undefined;
  let denied = true;
  const attempts = new Map<string, number>();
  const provider = new ApktoolProvider({
    environment: { REA_APKTOOL_COMMAND: command },
    removeWorkspace: async (path) => {
      attempts.set(path, (attempts.get(path) ?? 0) + 1);
      deniedRoot ??= path;
      if (path === deniedRoot && denied)
        throw new Error("authored peer denial");
      await rm(path, { recursive: true, force: true });
    },
  });
  try {
    const request = {
      operation: "decode_android_resources" as const,
      input: { path: apk.path, include_strings: true },
    };
    const results = await Promise.all([
      provider.execute(request),
      provider.execute(request),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const retained = results.find((result) => !result.ok);
    if (retained === undefined || retained.ok)
      throw new Error("Expected retained peer");
    expect(attempts.size).toBe(2);
    await expect(provider.close()).rejects.toMatchObject({
      cleanupIncomplete: true,
    });
    denied = false;
    await provider.close();
    expect(retained.error.cleanupIncomplete).toBe(false);
    for (const [path, count] of attempts)
      expect(count).toBe(path === deniedRoot ? 3 : 1);
  } finally {
    denied = false;
    await provider.close();
  }
});

it("joins a late workspace allocation during shutdown and removes its owned root", async () => {
  const { command, root } = await writeApktoolStub(decodeStub());
  const apk = await apkFixture(root);
  const created = createDeferred<string>();
  const release = createDeferred<void>();
  const allocate = PrivateRuntimeRoot.create.bind(PrivateRuntimeRoot);
  const allocation = vi
    .spyOn(PrivateRuntimeRoot, "create")
    .mockImplementationOnce(async (options) => {
      const runtime = await allocate(options);
      created.resolve(runtime.path);
      await release.promise;
      return runtime;
    });
  const provider = providerOver(command);
  const pending = provider.execute({
    operation: "decode_android_resources",
    input: { path: apk.path, include_strings: true },
  });
  let closing: Promise<void> | undefined;
  try {
    const owned = await created.promise;
    closing = provider.close();
    release.resolve();
    const result = await pending;
    if (result.ok) throw new Error("Expected shutdown cancellation");
    expect(result.error._tag).toBe("AnalysisCancelledError");
    await closing;
    await expect(stat(owned)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    release.resolve();
    await pending;
    allocation.mockRestore();
    await (closing ?? provider.close());
  }
});

it.each(["first-selected.apk", "second-selected.apk"])(
  "attributes a decode refusal to %s without substituting the launcher",
  async (name) => {
    const { command, root } = await writeApktoolStub(
      decodeStub({ failDecode: true }),
    );
    const path = join(root, name);
    await writeFile(path, "authored target");
    const provider = providerOver(command);
    try {
      const projected = await refusedBy(provider, {
        operation: "decode_android_resources",
        input: { path, include_strings: true },
      });
      expect(projected).toMatchObject({
        code: "unsupported_target",
        details: { path, captured_output: { exit_code: 1 } },
      });
      expect(projected.message).toContain(path);
      expect(projected.message).not.toContain(command);
    } finally {
      await provider.close();
    }
  },
);

it("reports launcher disappearance after version admission as a provider failure", async () => {
  const { command, root } = await writeApktoolStub(
    () =>
      `if [ "$1" = "--version" ]; then rm -- "$0"; ${VERSION_BLOCK}; exit 0; fi`,
  );
  const apk = await apkFixture(root);
  const provider = providerOver(command);
  try {
    const result = await provider.execute({
      operation: "decode_android_resources",
      input: { path: apk.path, include_strings: true },
    });
    if (result.ok) throw new Error("Expected missing launcher");
    expect(result.error).toMatchObject({
      _tag: "ProviderAdapterError",
      diagnostics: { target_path: apk.path, selected_command: command },
    });
    expect(projectAnalysisError(result.error).code).not.toBe(
      "unsupported_target",
    );
    expect(result.error.cause).toBeDefined();
  } finally {
    await provider.close();
  }
});

it("discloses qualified and unfamiliar strings tables while preserving exact locale selection (#4612)", async () => {
  const tables = [
    "en-rUS-v21",
    "b+zh+Hans+CN-night",
    "pt-rBR-sw600dp",
    "mcc310-fr",
    "mcc310-mnc004-en-rUS-v21",
    "fr-land",
    "night",
    "v21",
    "pt-BR",
    "unknown_CONFIGURATION",
  ];
  const { command, root } = await writeApktoolStub(
    decodeStub({
      extraValuesDirectories: [
        ...tables,
        "fr",
        "b+sr+Latn",
        "b+sr+Latn+RS+REVISED",
        "b+fil+Latn+419+ABCDEFGH",
      ],
    }),
  );
  const apk = await apkFixture(root);
  const provider = providerOver(command);
  try {
    for (const locale of [
      undefined,
      "fr",
      "b+sr+Latn",
      "b+sr+Latn+RS+REVISED",
      "b+fil+Latn+419+ABCDEFGH",
      "en-rUS",
    ] as const) {
      const result = await provider.execute({
        operation: "decode_android_resources",
        input: {
          path: apk.path,
          include_strings: true,
          ...(locale === undefined ? {} : { locale }),
        },
      });
      if (!result.ok) throw result.error;
      expect(result.value.result).toMatchObject({
        locales: [
          "b+fil+Latn+419+ABCDEFGH",
          "b+sr+Latn",
          "b+sr+Latn+RS+REVISED",
          "de",
          "fr",
        ],
        locale: locale ?? null,
        coverage: "complete",
      });
      expect(result.value.limitations).toContain(
        `Other strings tables are not selected by locale; their resource configuration suffixes are preserved without inferring Android runtime matching: ${tables
          .map((suffix) => JSON.stringify(`values-${suffix}`))
          .sort()
          .join(", ")}`,
      );
      if (locale === undefined)
        expect(result.value.result).toMatchObject({
          strings: [
            { name: "api_endpoint", value: "https://api.example.com/v1" },
            { name: "app_name", value: "ApktoolProbe" },
          ],
        });
      else if (locale === "en-rUS") {
        expect(result.value.result).toMatchObject({ strings: [] });
        expect(result.value.limitations).toContain(
          "No strings.xml was found for locale en-rUS",
        );
      } else
        expect(result.value.result).toMatchObject({
          strings: [{ name: "wrong", value: "Wrong" }],
        });
    }
  } finally {
    await provider.close();
  }
});

it.each([
  "2.7.0-dirty",
  "2.9.1",
  "2.9.2-rc.1",
  "2.9.2",
  "2.9.2-dirty",
  "3.0.0",
  "3.0.1",
  "3.0.2-rc.1",
  "3.0.2",
  "3.1.0",
])(
  "retains reported-version limitations for both operations without refusing %s (#3438)",
  async (version) => {
    const { command, root } = await writeApktoolStub((root) =>
      decodeStub()(root).replace(VERSION_BLOCK, `printf '%s\\n' '${version}'`),
    );
    const apk = await apkFixture(root);
    const provider = providerOver(command);
    try {
      const inspect = await provider.execute({
        operation: "inspect_apktool_client",
        input: {},
      });
      const decode = await provider.execute({
        operation: "decode_android_resources",
        input: { path: apk.path, include_strings: true },
      });
      if (!inspect.ok) throw inspect.error;
      if (!decode.ok) throw decode.error;
      const warnings = inspect.value.limitations.filter((limitation) =>
        limitation.includes("CVE-2024-21633"),
      );
      expect(warnings.length).toBe(
        ["2.7.0-dirty", "2.9.1", "2.9.2-rc.1"].includes(version) ? 1 : 0,
      );
      if (warnings.length > 0) expect(warnings[0]).toContain("CVE-2024-21633");
      expect(
        inspect.value.limitations.filter((warning) =>
          warning.includes("CVE-2026-39973"),
        ).length,
      ).toBe(["3.0.0", "3.0.1", "3.0.2-rc.1"].includes(version) ? 1 : 0);
      expect(
        inspect.value.limitations.filter((warning) =>
          warning.includes("GHSA-vgwr-4w3p-xmjv"),
        ).length,
      ).toBe(
        process.platform === "win32" &&
          [
            "2.7.0-dirty",
            "2.9.1",
            "2.9.2-rc.1",
            "2.9.2",
            "2.9.2-dirty",
          ].includes(version)
          ? 1
          : 0,
      );

      for (const warning of inspect.value.limitations)
        expect(decode.value.limitations).toContain(warning);
      expect(inspect.value.result).toMatchObject({
        client: { apktool_version: version },
      });
      expect(decode.value.result).toMatchObject({
        client: { apktool_version: version },
        target: { sha256: apk.sha256 },
        coverage: "complete",
      });
    } finally {
      await provider.close();
    }
  },
);

it.each([
  [
    "malformed",
    '<resources><string name="a">one</string><string name="b">two</resources>',
    [],
  ],
  ["wrong_root", "<manifest/>", []],
  [
    "unsupported",
    '<resources><string name="a"><b>A</b></string><string>unnamed</string><string name="good">ok</string></resources>',
    [{ name: "good", value: "ok" }],
  ],
] as const)(
  "reports document projection semantics for %s (#4820)",
  async (kind, stringsXml, strings) => {
    const { command, root } = await writeApktoolStub(
      decodeStub({ stringsXml }),
    );
    const apk = await apkFixture(root);
    const provider = providerOver(command);
    try {
      const result = await provider.execute({
        operation: "decode_android_resources",
        input: { path: apk.path, include_strings: true },
      });
      if (!result.ok) throw result.error;
      expect(result.value.result).toMatchObject({
        strings,
        target: { sha256: apk.sha256 },
        coverage: "partial",
      });
      const limitations = result.value.limitations.join("\n");
      if (kind === "unsupported") {
        expect(limitations).toContain(
          "String entries omitted due to unsupported markup or missing names: 2",
        );
        expect(limitations).not.toContain("entry counts are unknown");
      } else {
        expect(limitations).toContain(
          'String table "res/values/strings.xml" could not be projected:',
        );
        expect(limitations).toContain("entry counts are unknown");
        expect(limitations).not.toContain("String entries omitted");
        expect(limitations).toContain(
          kind === "wrong_root"
            ? "root must be <resources>"
            : "XML is not well-formed",
        );
      }
    } finally {
      await provider.close();
    }
  },
);

it("reports the owned-process prerequisite as Apktool unavailability, not a probe failure", async () => {
  const { command } = await writeApktoolStub(() => VERSION_BLOCK);
  vi.spyOn(systemProcessOwnershipHost, "prepare").mockImplementation(
    async () => {
      throw new LinuxOwnedProcessPrerequisiteError(
        new Error("spawn ps ENOENT"),
      );
    },
  );
  onTestFinished(() => {
    vi.restoreAllMocks();
  });

  const availability = await providerOver(command).inspectAvailability();
  expect(availability).toMatchObject({
    status: "unavailable",
    code: "runtime_unavailable",
    reason: expect.stringContaining("spawn ps ENOENT") as unknown,
    diagnostics: { stage: "ownership_preparation" },
  });
  expect(availability.reason).toContain("procps");

  const projected = await refusedBy(providerOver(command), {
    operation: "inspect_apktool_client",
    input: {},
  });
  expect(projected).toMatchObject({ code: "capability_unavailable" });
  expect(projected.details).toMatchObject({
    provider_id: "process-ownership",
    reason: expect.stringContaining("spawn ps ENOENT") as unknown,
  });
});
