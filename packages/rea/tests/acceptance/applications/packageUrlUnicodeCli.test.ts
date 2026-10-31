import { createPackageWithOptions } from "@electron/asar";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const escapingTarget = "./%2\te%2\te/outside.js";
const targets = {
  feature: { value: "./feature.js", imports: "relative", exports: "relative" },
  encodedSeparator: {
    value: "./feature%2\tf.js",
    imports: "rejected",
    exports: "rejected",
  },
  malformedEncoding: {
    value: "./feature%ZZ.js",
    imports: "rejected",
    exports: "rejected",
  },
  blocked: { value: null, imports: "external", exports: "external" },
  empty: { value: [], imports: "external", exports: "external" },
  inactive: {
    value: { browser: "./feature.js" },
    imports: "external",
    exports: "external",
  },
  external: {
    value: "another-package",
    imports: "unavailable",
    exports: "rejected",
  },
  recursive: { value: "#another", imports: "unavailable", exports: "rejected" },
  invalid: { value: "../feature.js", imports: "rejected", exports: "rejected" },
  scalar: { value: false, imports: "rejected", exports: "rejected" },
  numeric: { value: { 0: null }, imports: "rejected", exports: "rejected" },
  arrayNull: { value: [false, null], imports: "external", exports: "external" },
  arrayInactive: {
    value: [{ browser: "./feature.js" }],
    imports: "external",
    exports: "external",
  },
  arrayExternal: {
    value: [false, "another-package"],
    imports: "unavailable",
    exports: "rejected",
  },
  arrayRelative: {
    value: [false, "./feature.js"],
    imports: "relative",
    exports: "relative",
  },
  relativeFirst: {
    value: ["./feature.js", null],
    imports: "relative",
    exports: "relative",
  },
  escapeExternal: {
    value: [escapingTarget, "another-package"],
    imports: "unavailable",
    exports: "rejected",
  },
  escapeNull: {
    value: [escapingTarget, null],
    imports: "external",
    exports: "external",
  },
  escapeRelative: {
    value: [escapingTarget, "./feature.js"],
    imports: "relative",
    exports: "relative",
  },
  escapeCondition: {
    value: { node: escapingTarget, default: "./feature.js" },
    imports: "rejected",
    exports: "rejected",
  },
  escapeNested: {
    value: [{ node: escapingTarget }, "another-package"],
    imports: "unavailable",
    exports: "rejected",
  },
  escapeConfig: {
    value: [{ 0: escapingTarget }, "another-package"],
    imports: "rejected",
    exports: "rejected",
  },
  wtf8Reentry: {
    value: ["./%2\te%2\te/%ED%A0%80/feature.js", "another-package"],
    imports: "unavailable",
    exports: "rejected",
  },
  opaqueReentry: {
    value: ["./%2\te%2\te/rea-op\taque-0/feature.js", "another-package"],
    imports: "unavailable",
    exports: "rejected",
  },
  structuralReentry: {
    value: "./%2\te%2\te/mapped/feature.js",
    imports: "rejected",
    exports: "relative",
  },
} as const;
const requests = [
  {
    specifier: "legacy/feature.js",
    path: "node_modules/legacy/feature.js",
    status: "legacy" as const,
  },
  {
    specifier: "legacy/feature.js/.",
    path: "",
    status: "rejected" as const,
  },
  {
    specifier: "legacy/../mapped/feature.js",
    path: "node_modules/mapped/feature.js",
    status: "legacy" as const,
  },
  {
    specifier: "legacy/../mapped/feature.js/.",
    path: "",
    status: "rejected" as const,
  },
  {
    specifier: "legacy/../../../outside.js",
    path: "outside.js",
    status: "root-legacy" as const,
  },
  {
    specifier: "legacy/../../../absent.js",
    path: "",
    status: "not-found" as const,
  },
  ...Object.entries(targets).flatMap(([name, target]) => [
    { specifier: `#${name}`, path: "feature.js", status: target.imports },
    {
      specifier: `mapped/${name}`,
      path: "node_modules/mapped/feature.js",
      status: target.exports,
    },
  ]),
  { specifier: "#missing", path: "", status: "external" as const },
  { specifier: "mapped/missing", path: "", status: "external" as const },
];
const sources = ["import", "require"].map((mode) => ({
  mode,
  path: mode === "import" ? "main.mjs" : "main.cjs",
  source: requests
    .filter(({ specifier }) => mode === "import" || !specifier.endsWith("/."))
    .map(({ specifier }) =>
      mode === "import"
        ? `import ${JSON.stringify(specifier)};`
        : `require(${JSON.stringify(specifier)});`,
    )
    .join("\n"),
}));

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves package target facts under unrepresentable URL paths through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-package-url-unicode-");
    const application = join(root, "application");
    await mkdir(application);
    const fixture = join(root, "source");
    await writeFixtureFiles(fixture, { "outside.js": "export default 4;" });
    const prefixes = ["highxx", "lowxxx", "valid\ud83d\ude00"];
    for (const prefix of prefixes)
      await writeFixtureFiles(join(fixture, prefix), {
        ...Object.fromEntries(
          sources.map(({ path, source }) => [path, source]),
        ),
        "package.json": JSON.stringify({
          imports: Object.fromEntries(
            Object.entries(targets).map(([name, { value }]) => [
              `#${name}`,
              value,
            ]),
          ),
        }),
        "feature.js": "export default 1;",
        "node_modules/legacy/package.json": "{}",
        "node_modules/legacy/feature.js": "export default 2;",
        "node_modules/mapped/package.json": JSON.stringify({
          exports: Object.fromEntries(
            Object.entries(targets).map(([name, { value }]) => [
              `./${name}`,
              value,
            ]),
          ),
        }),
        "node_modules/mapped/feature.js": "export default 3;",
      });
    const archive = join(application, "app.asar");
    await createPackageWithOptions(fixture, archive, {});
    const bytes = await readFile(archive);
    const header = bytes.subarray(16, 16 + bytes.readUInt32LE(12));
    const escaped = Buffer.from(
      header
        .toString("utf8")
        .replace('"highxx":', '"\\ud800":')
        .replace('"lowxxx":', '"\\udc00":'),
    );
    expect(escaped.length).toBe(header.length);
    expect(escaped.equals(header)).toBe(false);
    escaped.copy(bytes, 16);
    await writeFile(archive, bytes);

    const { graph } = await analyzeJavaScriptDirectory(
      surface,
      cli,
      application,
    );
    for (const prefix of ["\ud800", "\udc00", "valid\ud83d\ude00"])
      for (const { mode, path, source } of sources)
        for (const request of requests) {
          if (mode === "require" && request.specifier.endsWith("/.")) continue;
          const base = `app.asar/${prefix}`;
          const available =
            prefix.startsWith("valid") ||
            request.status === "root-legacy" ||
            (mode === "require" && request.status === "legacy");
          const fileStatus = available ? "resolved" : "unavailable";
          const status =
            request.status === "relative" ||
            request.status === "legacy" ||
            request.status === "root-legacy"
              ? fileStatus
              : request.status;
          const mapKind = request.specifier.startsWith("#")
            ? "imports"
            : "exports";
          const selectedTarget =
            request.specifier === "mapped/structuralReentry"
              ? targets.structuralReentry.value
              : targets.feature.value;
          expect(graph.edges).toContainEqual(
            expect.objectContaining({
              relation: "imports",
              properties: expect.objectContaining({
                module_link_kind: mode,
                specifier: request.specifier,
                resolution_status: status,
                resolved_path:
                  status === "resolved"
                    ? `${request.status === "root-legacy" ? "app.asar" : base}/${request.path}`
                    : null,
              }),
              evidence: expect.objectContaining({
                limitations:
                  status === "unavailable" && request.status !== "unavailable"
                    ? expect.arrayContaining([
                        expect.stringContaining("unpaired UTF-16 surrogate"),
                        ...(request.status === "relative"
                          ? [
                              expect.stringContaining(
                                `${mapKind} target ${JSON.stringify(selectedTarget)}:`,
                              ),
                            ]
                          : []),
                      ])
                    : expect.not.arrayContaining([
                        expect.stringContaining("unpaired UTF-16 surrogate"),
                      ]),
                artifact: expect.objectContaining({
                  sha256: createHash("sha256").update(source).digest("hex"),
                }),
                location: expect.objectContaining({
                  value: expect.objectContaining({ source: `${base}/${path}` }),
                }),
              }),
            }),
          );
        }
    expect(Buffer.compare(await readFile(archive), bytes)).toBe(0);
  },
);
