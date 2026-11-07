import { expect, it } from "vitest";

import { analyzeArtifactFiles } from "../../../tests/fixtures/javascriptArtifactAnalysis.js";

const packageObservation = async (text: string | null) => {
  const { analysis } = await analyzeArtifactFiles({
    files: [
      {
        path: "app/package.json",
        container_sha256: "a".repeat(64),
        sha256: "b".repeat(64),
        bytes: Buffer.byteLength(text ?? ""),
        inventory_artifact_id: "package-main-fixture",
        kind: "package-json",
        unpacked: false,
        text:
          text === null
            ? { included: false, reason: "invalid-utf8" }
            : { included: true, value: text },
      },
    ],
    unavailable_relevant_files: [],
    containers: [],
    text_bytes_read: Buffer.byteLength(text ?? ""),
    invalid_utf8_files: 0,
  });
  return analysis.packages[0];
};

it("retains declared package metadata and normal defaults", async () => {
  const absent = await packageObservation("{}");
  const declared = await packageObservation(
    '{"name":"source-name","version":"1.0.0","main":null,"browser":"source-browser.cjs"}',
  );
  expect(absent).toMatchObject({
    status: "included",
    name: null,
    version: null,
    main: null,
    main_status: "default",
    main_entrypoint: "",
    renderer_declarations: {},
  });
  expect(declared).toMatchObject({
    status: "included",
    name: "source-name",
    version: "1.0.0",
    main: null,
    main_status: "invalid",
    main_entrypoint: "",
    renderer_declarations: { browser: "source-browser.cjs" },
    renderer_entrypoint: { field: "browser", path: "source-browser.cjs" },
  });
});

it.each([
  {
    fields: {
      renderer: "renderer.js",
      browser: "browser.js",
      module: "module.js",
    },
    field: "renderer",
    path: "renderer.js",
  },
  {
    fields: { renderer: false, browser: "browser.js", module: "module.js" },
    field: "browser",
    path: "browser.js",
  },
  {
    fields: { renderer: "", browser: {}, module: "module.js" },
    field: "module",
    path: "module.js",
  },
])(
  "keeps simultaneous renderer declarations separate from selected $field provenance",
  async ({ fields, field, path }) => {
    const observation = await packageObservation(JSON.stringify(fields));
    expect(observation).toMatchObject({ renderer_entrypoint: { field, path } });
    for (const [key, value] of Object.entries(fields))
      expect(observation).toMatchObject({
        renderer_declarations: {
          [key]: typeof value === "string" ? value : { status: "non-string" },
        },
      });
  },
);

it.each([
  ["{}", {}],
  ["{", null],
  ["null", null],
  [null, null],
] as const)(
  "keeps absent/invalid/unavailable renderer origins distinct for %s",
  async (text, declarations) => {
    expect(await packageObservation(text)).toMatchObject({
      renderer_declarations: declarations,
      renderer_entrypoint: null,
    });
  },
);

it.each([null, false, 123, {}, []].map((main) => ({ main })))(
  "retains non-string main $main evidence separately from Node index fallback",
  async ({ main }) => {
    expect(await packageObservation(JSON.stringify({ main }))).toMatchObject({
      status: "included",
      main: null,
      main_status: "invalid",
      main_entrypoint: "",
    });
  },
);

it("keeps valid JSON numeric overflow invalid as a package main", async () => {
  expect(await packageObservation('{"main":1e400}')).toMatchObject({
    status: "included",
    main: null,
    main_status: "invalid",
    main_entrypoint: "",
  });
});

it("treats a valid numeric JSON root as a package metadata shape failure", async () => {
  expect(await packageObservation("1e400")).toMatchObject({
    status: "invalid",
    main: null,
    main_status: "unavailable",
    main_entrypoint: null,
  });
});

it("retains valid numeric overflow as an ordinary JSON module", async () => {
  const text = "1e400";
  const { analysis } = await analyzeArtifactFiles({
    files: [
      {
        path: "settings.json",
        container_sha256: "a".repeat(64),
        sha256: "b".repeat(64),
        bytes: Buffer.byteLength(text),
        inventory_artifact_id: "numeric-json-fixture",
        kind: "json",
        unpacked: false,
        text: { included: true, value: text },
      },
    ],
    unavailable_relevant_files: [],
    containers: [],
    text_bytes_read: Buffer.byteLength(text),
    invalid_utf8_files: 0,
  });

  expect(analysis.json_modules).toMatchObject([
    { status: "included", top_level_keys: [] },
  ]);
});

it.each([
  ["{}", "default", ""],
  ['{"main":""}', "default", ""],
  ['{"main":"main.cjs"}', "declared", "main.cjs"],
  ['{"main":"sub\\\\main.cjs"}', "declared", "sub\\main.cjs"],
  ['{"main":"C:main.cjs"}', "declared", "C:main.cjs"],
] as const)(
  "preserves package launch declarations from %s",
  async (text, status, entry) => {
    expect(await packageObservation(text)).toMatchObject({
      status: "included",
      main_status: status,
      main_entrypoint: entry,
    });
  },
);

it.each(["{", "null", "[]", "[{}]", "123", '"root"', "false"])(
  "keeps malformed package metadata %s out of known launch fallback",
  async (text) => {
    expect(await packageObservation(text)).toMatchObject({
      status: "invalid",
      main: null,
      main_status: "unavailable",
      main_entrypoint: null,
    });
  },
);
