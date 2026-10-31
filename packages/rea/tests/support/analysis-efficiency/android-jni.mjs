/** Public SDK/stdio JNI investigation, checked against independent NDK/DEX facts. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  unlink,
  stat,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const { values } = parseArgs({
  options: {
    repository: { type: "string" },
    target: { type: "string" },
    output: { type: "string" },
    "java-home": { type: "string" },
    jar: { type: "string" },
    expectations: { type: "string" },
    variant: { type: "string", default: "ordinary" },
    repeats: { type: "string", default: "2" },
    proof: { type: "boolean", default: false },
    detail: { type: "string", default: "complete" },
    "omit-detail": { type: "boolean", default: false },
    pages: { type: "boolean", default: false },
    cli: { type: "boolean", default: false },
    "retained-removal": { type: "boolean", default: false },
  },
});
for (const name of [
  "repository",
  "target",
  "output",
  "java-home",
  "jar",
  "expectations",
])
  assert.ok(values[name], `Missing --${name}`);
assert.ok(["complete", "summary"].includes(values.detail));
assert.ok(
  !values["omit-detail"] || values.detail === "summary",
  "--omit-detail verifies the summary default",
);
assert.ok(
  values.detail !== "summary" || values.proof,
  "Summary verification requires its full proof export",
);
assert.ok(["ordinary", "relr", "aps2", "conscrypt"].includes(values.variant));
const repeats = Number(values.repeats);
assert.ok(Number.isSafeInteger(repeats) && repeats >= 1 && repeats <= 20);
const repo = resolve(values.repository),
  target = resolve(values.target),
  output = resolve(values.output);
await mkdir(output, { mode: 0o700 });
const expectations = JSON.parse(
  await readFile(resolve(values.expectations), "utf8"),
);
const targetSha = createHash("sha256")
  .update(await readFile(target))
  .digest("hex");
const expected =
  values.variant === "conscrypt"
    ? expectations.conscrypt
    : expectations.variants[values.variant];
assert.equal(
  targetSha,
  expected.sha256,
  "Selected target must be the independent oracle's exact APK",
);
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const factDigest = (report) => {
  const { engine: _engine, ...facts } = report;
  return createHash("sha256")
    .update(JSON.stringify(canonical(facts)))
    .digest("hex");
};
const declarationKey = (row) =>
  JSON.stringify([
    row.class_name ?? row.class,
    row.method_name ?? row.name,
    row.descriptor,
  ]);
const goldenMethods = new Map(
  expectations.dex.native_methods.map((row) => [declarationKey(row), row]),
);
const expectedSlots = (candidate, row) => {
  assert.equal(candidate.address, row.function_address);
  if (row.table_address !== undefined)
    assert.equal(candidate.table.table_address, row.table_address);
  if (row.entry_index !== undefined)
    assert.equal(candidate.table.entry.entry_index, row.entry_index);
  assert.equal(candidate.table.entry.function_address, row.function_address);
  assert.equal(candidate.table.entry.name, row.name);
  assert.equal(candidate.table.entry.descriptor, row.descriptor);
  assert.equal(candidate.table.entry.slots.length, 3);
  for (let index = 0; index < 3; index++) {
    const slot = candidate.table.entry.slots[index],
      gold = row.slots[index];
    assert.equal(slot.role, ["name", "signature", "function"][index]);
    assert.equal(slot.address, gold.address);
    assert.equal(slot.file_offset, Number(BigInt(gold.file_offset)));
    assert.equal(slot.value, gold.resolved_word);
    assert.equal(slot.relocation?.encoding, gold.encoding.toLowerCase());
  }
};

function checkFixture(report, query) {
  assert.equal(report.native_inventory.coverage.status, "complete");
  assert.equal(report.library_inventory.status, "complete");
  assert.equal(
    report.declarations.length,
    goldenMethods.size,
    "Selection must not erase global pair ambiguity",
  );
  assert.deepEqual(
    new Set(report.declarations.map(declarationKey)),
    new Set(goldenMethods.keys()),
  );
  const declarations = new Map(
    report.declarations.map((row) => [row.declaration_id, row]),
  );
  const libraries = new Map(
    report.libraries.map((row) => [row.library_id, row]),
  );
  const candidates = new Map(
    report.candidates.map((row) => [row.candidate_id, row]),
  );
  const expectedLibraries = Object.entries(expected.libraries).filter(
    ([path]) =>
      (query.abis === undefined || query.abis.includes(path.split("/")[1])) &&
      (query.library_paths === undefined || query.library_paths.includes(path)),
  );
  assert.deepEqual(
    report.libraries.map((row) => row.path).sort(),
    expectedLibraries.map(([path]) => path).sort(),
  );
  for (const library of report.libraries) {
    const gold = expected.libraries[library.path];
    assert.equal(library.sha256, gold.sha256);
    assert.equal(library.abi, library.path.split("/")[1]);
    assert.equal(library.failure, null);
    if (values.variant === "aps2") {
      assert.notEqual(library.coverage.tables_status, "complete");
      assert.ok(library.unknowns.some((text) => /APS2|packed/i.test(text)));
    } else {
      assert.ok(["complete", "partial"].includes(library.coverage.status));
      if (library.coverage.status === "partial")
        assert.ok(library.unknowns.length > 0);
    }
  }
  const selectedMethods = report.declarations.filter(
    (row) =>
      (query.class_name === undefined || row.class_name === query.class_name) &&
      (query.method_names === undefined ||
        query.method_names.includes(row.method_name)) &&
      (query.descriptors === undefined ||
        query.descriptors.includes(row.descriptor)),
  );
  assert.deepEqual(
    report.selected_declaration_ids,
    selectedMethods.map((row) => row.declaration_id),
  );
  const abis = query.abis ?? [
    ...new Set(report.libraries.map((row) => row.abi)),
  ];
  assert.equal(report.bindings.length, selectedMethods.length * abis.length);
  for (const binding of report.bindings) {
    const declaration = declarations.get(binding.declaration_id);
    assert.ok(selectedMethods.includes(declaration));
    const gold = expected.expected_methods.find(
      (row) =>
        declarationKey(row) === declarationKey(declaration) &&
        row.abi === binding.abi,
    );
    assert.ok(gold);
    const wanted = gold.implementations.filter((row) =>
      expectedLibraries.some(([path]) => path === row.library),
    );
    const observed = binding.candidate_ids.map((id) => candidates.get(id));
    assert.equal(observed.length, wanted.length);
    for (const impl of wanted) {
      const candidate = observed.find(
        (row) =>
          libraries.get(row.library_id)?.path === impl.library &&
          row.address === (impl.address ?? impl.function_address),
      );
      assert.ok(
        candidate,
        `Missing source-known candidate for ${declarationKey(declaration)}`,
      );
      assert.equal(
        libraries.get(candidate.library_id).sha256,
        impl.library_sha256,
      );
      assert.ok(candidate.declaration_ids.includes(binding.declaration_id));
      if (gold.basis === "export") {
        assert.equal(candidate.basis, "jni-export");
        assert.equal(candidate.name, gold.symbol);
      } else {
        assert.equal(candidate.basis, "static-registration-table");
        expectedSlots(candidate, impl);
        if (gold.candidate_classes) {
          assert.equal(candidate.class_attribution, "ambiguous-native-pair");
          assert.deepEqual(
            candidate.declaration_ids
              .map((id) => declarations.get(id).class_name)
              .sort(),
            [...gold.candidate_classes].sort(),
          );
        } else assert.equal(candidate.class_attribution, "unique-native-pair");
      }
    }
    const ambiguousPair = gold.candidate_classes !== undefined;
    const distinct = new Set(
      wanted.map((row) =>
        JSON.stringify([row.library, row.address ?? row.function_address]),
      ),
    ).size;
    if ((ambiguousPair && wanted.length > 0) || distinct > 1)
      assert.equal(binding.status, "ambiguous");
    else if (distinct === 1)
      assert.equal(
        binding.status,
        "matched",
        "Known candidate presence survives partial coverage",
      );
    else if (binding.coverage !== "complete") {
      assert.equal(
        binding.status,
        "unknown",
        "Incomplete coverage must not establish absence",
      );
      assert.ok(binding.unknowns.length > 0);
    } else assert.equal(binding.status, "unmatched");
  }
}

function checkConscrypt(report, query) {
  const descriptor = "([B[B[B[B[B[B[B[B)J";
  assert.equal(report.native_inventory.coverage.status, "complete");
  const declaration = report.declarations.filter(
    (row) =>
      row.class_name === query.class_name &&
      row.method_name === "EVP_PKEY_new_RSA" &&
      row.descriptor === descriptor,
  );
  assert.equal(declaration.length, 1);
  assert.deepEqual(report.selected_declaration_ids, [
    declaration[0].declaration_id,
  ]);
  assert.equal(report.bindings.length, 1);
  const binding = report.bindings[0];
  assert.equal(binding.declaration_id, declaration[0].declaration_id);
  assert.equal(binding.abi, "arm64-v8a");
  assert.equal(binding.status, "matched");
  const library = report.libraries.find(
    (row) => row.path === "lib/arm64-v8a/libconscrypt_jni.so",
  );
  assert.ok(library);
  assert.equal(
    library.sha256,
    expected.libraries.find((row) => row.member === library.path).sha256,
  );
  assert.equal(library.jni_on_load, true);
  const candidate = report.candidates.find(
    (row) =>
      binding.candidate_ids.includes(row.candidate_id) &&
      row.address === "0xfa11c",
  );
  assert.ok(candidate);
  assert.equal(candidate.library_id, library.library_id);
  assert.equal(candidate.basis, "static-registration-table");
  assert.equal(candidate.class_attribution, "unique-native-pair");
  expectedSlots(candidate, {
    name: "EVP_PKEY_new_RSA",
    descriptor,
    function_address: "0xfa11c",
    slots: [
      {
        address: "0x2ada68",
        file_offset: "0x2a5a68",
        resolved_word: "0x749a8",
        encoding: "RELA",
      },
      {
        address: "0x2ada70",
        file_offset: "0x2a5a70",
        resolved_word: "0x7affa",
        encoding: "RELA",
      },
      {
        address: "0x2ada78",
        file_offset: "0x2a5a78",
        resolved_word: "0xfa11c",
        encoding: "RELA",
      },
    ],
  });
  assert.equal(
    BigInt(candidate.table.table_address) +
      BigInt(candidate.table.entry.entry_index) * 24n,
    0x2ada68n,
  );
}

function checkSummary(view, report) {
  assert.equal(view.kind, "summary");
  assert.equal(view.parent_operation, "inspect_android_jni_bindings");
  assert.deepEqual(view.artifact, report.apk);
  const summary = view.summary;
  for (const collection of [
    "bindings",
    "declarations",
    "candidates",
    "libraries",
  ])
    assert.equal(summary.counts[collection], report[collection].length);
  assert.equal(summary.bindings.length, Math.min(64, report.bindings.length));
  assert.deepEqual(summary.bindings, report.bindings.slice(0, 64));
  assert.equal(view.coverage.total, report.bindings.length);
  assert.deepEqual(summary.native_inventory, report.native_inventory);
  assert.deepEqual(summary.library_inventory, report.library_inventory);
  assert.deepEqual(
    summary.libraries,
    report.libraries,
    "Summary retains diagnostics even without positive candidate edges",
  );
  assert.equal(
    summary.counts.selected_declarations,
    report.selected_declaration_ids.length,
  );
  assert.deepEqual(
    summary.selected_declaration_ids,
    report.selected_declaration_ids.slice(0, 64),
  );
  assert.equal(
    summary.declaration_coverage.total,
    report.selected_declaration_ids.length,
  );
  assert.equal(
    summary.declaration_coverage.examined,
    Math.min(64, report.selected_declaration_ids.length),
  );
  assert.equal(
    summary.declaration_coverage.exhausted,
    report.selected_declaration_ids.length <= 64,
  );
  assert.equal(
    summary.declaration_coverage.next_offset,
    report.selected_declaration_ids.length <= 64 ? null : 64,
  );
  for (const [collection, identity] of [
    ["declarations", "declaration_id"],
    ["candidates", "candidate_id"],
    ["libraries", "library_id"],
  ]) {
    const originals = new Map(
      report[collection].map((row) => [row[identity], row]),
    );
    for (const row of summary[collection])
      assert.deepEqual(row, originals.get(row[identity]));
  }
  const declarations = new Set(
    summary.declarations.map((row) => row.declaration_id),
  );
  const libraries = new Set(summary.libraries.map((row) => row.library_id));
  const candidates = new Map(
    summary.candidates.map((row) => [row.candidate_id, row]),
  );
  for (const id of summary.selected_declaration_ids)
    assert.ok(declarations.has(id));
  for (const binding of summary.bindings) {
    assert.ok(declarations.has(binding.declaration_id));
    for (const id of binding.candidate_ids) {
      const candidate = candidates.get(id);
      assert.ok(candidate && libraries.has(candidate.library_id));
      for (const declaration of candidate.declaration_ids)
        assert.ok(declarations.has(declaration));
    }
  }
}

function checkPage(view, report) {
  assert.equal(view.kind, "android-jni");
  assert.equal(view.parent_operation, "inspect_android_jni_bindings");
  assert.deepEqual(view.artifact, report.apk);
  const request = view.view;
  assert.deepEqual(view.source, {
    native_inventory: report.native_inventory,
    library_inventory: report.library_inventory,
    selection: report.selection,
  });
  const accepts = (values, value) =>
    values === undefined || values.includes(value);
  const rows = report[request.collection]
    .map((row, row_index) => ({ ...row, row_index }))
    .filter((row) => {
      if (!accepts(request.indices, row.row_index)) return false;
      switch (request.collection) {
        case "declarations":
          return (
            accepts(request.declaration_ids, row.declaration_id) &&
            accepts(request.descriptors, row.descriptor) &&
            accepts(request.class_names, row.class_name) &&
            accepts(request.method_names, row.method_name)
          );
        case "libraries":
          return (
            accepts(request.library_ids, row.library_id) &&
            accepts(request.abis, row.abi)
          );
        case "candidates":
          return (
            accepts(request.candidate_ids, row.candidate_id) &&
            accepts(request.library_ids, row.library_id) &&
            (request.declaration_ids === undefined ||
              row.declaration_ids.some((id) =>
                request.declaration_ids.includes(id),
              ))
          );
        case "bindings":
          return (
            accepts(request.declaration_ids, row.declaration_id) &&
            accepts(request.abis, row.abi) &&
            accepts(request.statuses, row.status)
          );
        default:
          throw new Error(`Unknown retained collection ${request.collection}`);
      }
    });
  const selected = rows
    .slice(request.offset, request.offset + request.limit)
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([key]) =>
            key === "row_index" ||
            request.fields === undefined ||
            request.fields.includes(key),
        ),
      ),
    );
  assert.deepEqual(view.items, selected);
  assert.equal(view.coverage.total, rows.length);
  assert.equal(view.coverage.examined, selected.length);
  const exhausted =
    request.offset >= rows.length ||
    request.offset + selected.length >= rows.length;
  assert.equal(view.coverage.exhausted, exhausted);
  assert.equal(
    view.coverage.next_offset,
    exhausted ? null : request.offset + selected.length,
  );
}

function collectionPages(preview) {
  const declarationIds = preview.selected_declaration_ids.slice(0, 2);
  const candidateIds = preview.candidates
    .slice(0, 2)
    .map((row) => row.candidate_id);
  assert.ok(declarationIds.length > 0 && candidateIds.length > 0);
  const page = (collection, extra) => ({
    kind: "android-jni",
    collection,
    offset: 0,
    limit: 2,
    ...extra,
  });
  return [
    page("bindings", {
      limit: 7,
      fields: ["declaration_id", "abi", "status", "coverage", "candidate_ids"],
    }),
    page("bindings", {
      offset: 1,
      statuses: ["ambiguous"],
      fields: ["declaration_id", "abi", "status"],
    }),
    page("bindings", { statuses: [], fields: ["declaration_id", "coverage"] }),
    page("declarations", {
      offset: 1,
      fields: [
        "declaration_id",
        "class_name",
        "method_name",
        "descriptor",
        "source_index",
        "dex_entry",
        "dex_entry_index",
        "class_index",
        "method_index",
      ],
    }),
    page("declarations", {
      class_names: [],
      fields: ["declaration_id", "source_index"],
    }),
    page("libraries", {
      offset: 1,
      fields: [
        "library_id",
        "path",
        "source_path",
        "abi",
        "sha256",
        "source_key",
        "source_index",
        "coverage",
        "failure",
      ],
    }),
    page("libraries", { library_ids: [], fields: ["library_id", "coverage"] }),
    page("candidates", {
      indices: [0, 2],
      fields: [
        "candidate_id",
        "library_id",
        "basis",
        "name",
        "descriptor",
        "address",
        "declaration_ids",
        "table",
      ],
    }),
    page("candidates", {
      declaration_ids: [],
      fields: ["candidate_id", "table"],
    }),
    page("declarations", { limit: 1, fields: [] }),
    page("declarations", {
      declaration_ids: declarationIds,
      fields: [
        "declaration_id",
        "class_name",
        "method_name",
        "descriptor",
        "dex_entry_index",
        "class_index",
        "method_index",
        "source_index",
      ],
    }),
    page("candidates", {
      candidate_ids: candidateIds,
      fields: [
        "candidate_id",
        "library_id",
        "declaration_ids",
        "address",
        "table",
      ],
    }),
  ];
}

async function qualifyRetainedRemoval(invoke) {
  const ownedCopy = join(output, "owned-retained-source.apk");
  assert.notEqual(ownedCopy, target);
  let copyOwned = false;
  const start = performance.now(),
    firstCall = calls.length;
  try {
    await copyFile(target, ownedCopy, constants.COPYFILE_EXCL);
    copyOwned = true;
    const query =
      values.variant === "conscrypt"
        ? { ...queries[0], path: ownedCopy }
        : {
            path: ownedCopy,
            class_name: "fixture.jni.Bindings",
            method_names: ["registeredData"],
            descriptors: ["(I)I"],
            abis: ["arm64-v8a"],
            library_paths: ["lib/arm64-v8a/libfixture.so"],
          };
    const parent = await invoke("inspect_android_jni_bindings", {
      ...query,
      detail: "complete",
    });
    assert.equal(parent.operation, "inspect_android_jni_bindings");
    assert.equal(parent.subject.digest.sha256, targetSha);
    assert.equal(parent.normalized_result.apk.path, ownedCopy);
    const report = parent.normalized_result;
    (values.variant === "conscrypt" ? checkConscrypt : checkFixture)(
      report,
      query,
    );
    const before = factDigest(report);
    await unlink(ownedCopy);
    copyOwned = false;
    await assert.rejects(stat(ownedCopy), { code: "ENOENT" });
    // After deletion only retained views and a bundle export are requested.
    // No target-analysis call or caller's original path is used for recovery.
    const source = {
      kind: "retained-evidence",
      evidence_id: parent.evidence_id,
    };
    const summary = await invoke("inspect_analysis_view", {
      source,
      view: { kind: "summary" },
    });
    assert.equal(
      summary.normalized_result.parent_evidence_id,
      parent.evidence_id,
    );
    checkSummary(summary.normalized_result, report);
    const declarations = report.bindings.map(
      (binding) => binding.declaration_id,
    );
    const pages = [
      {
        kind: "android-jni",
        collection: "candidates",
        offset: 0,
        limit: 64,
        declaration_ids: declarations,
        fields: [
          "candidate_id",
          "library_id",
          "basis",
          "name",
          "descriptor",
          "address",
          "declaration_ids",
          "class_attribution",
          "table",
        ],
      },
      {
        kind: "android-jni",
        collection: "bindings",
        offset: 0,
        limit: 1,
        fields: [
          "declaration_id",
          "abi",
          "status",
          "coverage",
          "candidate_ids",
        ],
      },
    ];
    let tableEntries = 0;
    for (const view of pages) {
      const evidence = await invoke("inspect_analysis_view", { source, view });
      assert.equal(
        evidence.normalized_result.parent_evidence_id,
        parent.evidence_id,
      );
      checkPage(evidence.normalized_result, report);
      tableEntries += evidence.normalized_result.items.filter(
        (row) => row.table != null,
      ).length;
    }
    if (values.variant !== "aps2")
      assert.ok(
        tableEntries > 0,
        "Relocated slot evidence must remain available after APK removal",
      );
    const proof = join(output, "retained-removal-evidence.json");
    await invoke("export_evidence_bundle", { path: proof });
    const bundle = JSON.parse(await readFile(proof, "utf8"));
    const retained = bundle.records.find(
      (row) => row.evidence_id === parent.evidence_id,
    );
    assert.ok(retained);
    assert.deepEqual(retained, parent);
    assert.equal(factDigest(retained.normalized_result), before);
    assert.equal(
      createHash("sha256")
        .update(await readFile(target))
        .digest("hex"),
      targetSha,
    );
    return {
      name: "retained-removal",
      elapsed_ms: performance.now() - start,
      calls: calls.length - firstCall,
      first_call: firstCall,
      question:
        "After deleting only the harness-owned APK copy, retrieve retained summary, exact candidate slots and selected binding fields, then export unchanged complete parent Evidence.",
      owned_copy: ownedCopy,
      original_path: target,
      original_sha256: targetSha,
      parent_evidence_id: parent.evidence_id,
      fact_digest: before,
      retained_table_rows: tableEntries,
      scope:
        "Observed public SDK success after owned-copy removal; only retained-view/export calls follow deletion. No target code executes; internal engine calls are not directly instrumented by this public harness.",
    };
  } finally {
    if (copyOwned) await unlink(ownedCopy);
  }
}

const require = createRequire(join(repo, "package.json"));
const { Client } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client"))
);
const { StdioClientTransport } = await import(
  pathToFileURL(require.resolve("@modelcontextprotocol/client/stdio"))
);
const { Ajv2020 } = await import(
  pathToFileURL(require.resolve("ajv/dist/2020.js"))
);
const environment = {
  PATH: process.env.PATH,
  JAVA_HOME: resolve(values["java-home"]),
  REA_JADX_MCP_JAR: resolve(values.jar),
  REA_JADX_HEAP_MIB: "1024",
  REA_JADX_ACTIVE_PROCESSOR_COUNT: "2",
  NODE_OPTIONS: "--max-old-space-size=3072",
  UV_THREADPOOL_SIZE: "2",
  REA_LOG_LEVEL: "silent",
  REA_MCP_TOOL_FAMILIES:
    values.pages || values["retained-removal"]
      ? "android,application,session"
      : values.proof
        ? "android,session"
        : "android",
  REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(repo, "scripts/rea.mjs"), "mcp"],
  cwd: repo,
  env: environment,
  stderr: "pipe",
  maxBufferSize: 16 * 1024 * 1024,
});
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  if (stderr.length < 65536)
    stderr += chunk.toString().slice(0, 65536 - stderr.length);
});
const client = new Client({ name: "rea-real-android-jni", version: "1" });
const calls = [],
  runs = [],
  parents = [];
let firstReport;
let receipt;
let callPhase = "task";
let validateJniOutput;
const queries =
  values.variant === "conscrypt"
    ? [
        {
          path: target,
          class_name: "org.conscrypt.NativeCrypto",
          method_names: ["EVP_PKEY_new_RSA"],
          descriptors: ["([B[B[B[B[B[B[B[B)J"],
          abis: ["arm64-v8a"],
          library_paths: ["lib/arm64-v8a/libconscrypt_jni.so"],
        },
      ]
    : [
        { path: target },
        {
          path: target,
          class_name: "fixture.jni.Bindings",
          method_names: ["ambiguous"],
          descriptors: ["(I)I"],
          abis: ["arm64-v8a"],
        },
        { path: target, method_names: ["registered_表𐐀"], abis: ["arm64-v8a"] },
        {
          path: target,
          method_names: ["sharedExport"],
          abis: ["arm64-v8a"],
          library_paths: ["lib/arm64-v8a/libduplicate.so"],
        },
      ];
try {
  const discoveryStart = performance.now();
  await client.connect(transport);
  const catalog = await client.listTools();
  const startup_catalog_elapsed_ms = performance.now() - discoveryStart;
  await writeFile(join(output, "catalog.json"), JSON.stringify(catalog));
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const contracts = new Map();
  for (const name of [
    "inspect_android_jni_bindings",
    ...(values.proof || values["retained-removal"]
      ? ["export_evidence_bundle"]
      : []),
    ...(values.pages || values["retained-removal"]
      ? ["inspect_analysis_view"]
      : []),
  ]) {
    const selected = catalog.tools.filter((tool) => tool.name === name);
    assert.equal(selected.length, 1);
    assert.ok(selected[0].outputSchema);
    contracts.set(name, {
      definition: selected[0],
      input: ajv.compile(selected[0].inputSchema),
      output: ajv.compile(selected[0].outputSchema),
    });
  }
  validateJniOutput = contracts.get("inspect_android_jni_bindings").output;
  const invoke = async (name, args) => {
    const contract = contracts.get(name);
    const sent = { ...args };
    if (
      values["omit-detail"] &&
      name === "inspect_android_jni_bindings" &&
      sent.detail === "summary"
    )
      delete sent.detail;
    assert.ok(contract.input(sent), JSON.stringify(contract.input.errors));
    const start = performance.now();
    const result = await client.callTool(
      { name, arguments: sent },
      { toolDefinition: contract.definition, timeout: 120000 },
    );
    calls.push({
      phase: callPhase,
      name,
      arguments: sent,
      result,
      elapsed_ms: performance.now() - start,
    });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    assert.ok(
      contract.output(result.structuredContent),
      JSON.stringify(contract.output.errors),
    );
    return result.structuredContent;
  };
  let coldDigests;
  for (let pass = 0; pass < repeats; pass++) {
    const start = performance.now(),
      firstCall = calls.length,
      firstParent = parents.length;
    const digests = [];
    for (const query of queries) {
      const selectedView =
        values.detail === "summary" && values.pages && query === queries[1]
          ? {
              kind: "android-jni",
              collection: "bindings",
              offset: 0,
              limit: 1,
              fields: [
                "declaration_id",
                "abi",
                "status",
                "coverage",
                "candidate_ids",
              ],
            }
          : undefined;
      const evidence = await invoke("inspect_android_jni_bindings", {
        ...query,
        detail: values.detail,
        ...(selectedView === undefined ? {} : { view: selectedView }),
      });
      assert.equal(
        evidence.operation,
        values.detail === "summary"
          ? "inspect_analysis_view"
          : "inspect_android_jni_bindings",
      );
      assert.equal(evidence.subject.digest.sha256, targetSha);
      const parent = {
        id:
          values.detail === "summary"
            ? evidence.normalized_result.parent_evidence_id
            : evidence.evidence_id,
        query,
        normalized:
          values.detail === "complete" ? evidence.normalized_result : undefined,
        view:
          values.detail === "summary" ? evidence.normalized_result : undefined,
        pages: [],
      };
      if (values.detail === "summary") assert.equal(evidence.raw_result, null);
      parents.push(parent);
      if (values.pages && query === queries[0]) {
        const preview =
          values.detail === "summary"
            ? evidence.normalized_result.summary
            : evidence.normalized_result;
        for (const view of collectionPages(preview)) {
          const result = await invoke("inspect_analysis_view", {
            source: { kind: "retained-evidence", evidence_id: parent.id },
            view,
          });
          parent.pages.push(result.normalized_result);
          assert.equal(result.normalized_result.parent_evidence_id, parent.id);
        }
      }
    }
    let bundle;
    if (values.proof) {
      const path = join(output, `pass-${pass}-evidence.json`);
      await invoke("export_evidence_bundle", { path });
      bundle = JSON.parse(await readFile(path, "utf8"));
    }
    for (const delivered of parents.slice(firstParent)) {
      let report = delivered.normalized;
      if (values.proof) {
        const parent = bundle.records.find(
          (record) => record.evidence_id === delivered.id,
        );
        assert.ok(parent, "Complete source Evidence must remain exportable");
        assert.equal(parent.operation, "inspect_android_jni_bindings");
        assert.equal(parent.subject.digest.sha256, targetSha);
        if (report !== undefined)
          assert.deepEqual(parent.normalized_result, report);
        report = parent.normalized_result;
        for (const [key, value] of Object.entries(delivered.query))
          assert.deepEqual(parent.parameters[key], value);
      }
      assert.ok(report);
      const { path: _path, ...selection } = delivered.query;
      assert.deepEqual(report.selection, selection);
      assert.equal(report.apk.path, target);
      assert.equal(report.apk.sha256, targetSha);
      (values.variant === "conscrypt" ? checkConscrypt : checkFixture)(
        report,
        delivered.query,
      );
      if (delivered.view?.kind === "android-jni")
        checkPage(delivered.view, report);
      else if (delivered.view) checkSummary(delivered.view, report);
      for (const page of delivered.pages) checkPage(page, report);
      digests.push(factDigest(report));
      firstReport ??= report;
    }
    if (pass === 0) coldDigests = digests;
    else
      assert.deepEqual(
        digests,
        coldDigests,
        "Warm reuse must preserve exact normalized facts",
      );
    runs.push({
      temperature: pass === 0 ? "cold-provider" : "warm-session",
      elapsed_ms: performance.now() - start,
      calls: calls.length - firstCall,
      fact_digests: digests,
    });
  }
  const summary = {
    targetSha,
    variant: values.variant,
    detail: values.detail,
    omit_detail: values["omit-detail"],
    proof: values.proof,
    pages: values.pages,
    question:
      values.variant === "conscrypt"
        ? "Resolve NativeCrypto.EVP_PKEY_new_RSA to its static arm64 Conscrypt implementation and retain exact library identity and relocated slot evidence."
        : "Resolve every fixture native declaration by ABI and library; preserve overloads, Unicode, global class ambiguity, duplicate libraries, unmatched methods and relocation uncertainty.",
    baseline:
      "Earlier main has no batch JNI operation. Manual inventory/export lookup cannot recover RegisterNatives with equivalent coverage; no equivalent before-speedup claim.",
    startup_catalog_elapsed_ms,
    elapsed_scope:
      "Per-run task includes investigation calls, selected pages, proof export and local oracle checks. Startup/catalog and final transport cleanup are separate one-time costs. Resource supervisor measures the whole process family, including these phases.",
    runs,
    task_calls: calls.length,
    calls: calls.length,
    qualifications: [],
  };
  receipt = summary;
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(join(output, "calls.json"), JSON.stringify(calls));
  if (values["retained-removal"]) {
    callPhase = "qualification";
    summary.qualifications.push(await qualifyRetainedRemoval(invoke));
    summary.calls = calls.length;
    await writeFile(
      join(output, "summary.json"),
      JSON.stringify(summary, null, 2),
    );
  }
  console.log(JSON.stringify(summary));
} finally {
  const closeStart = performance.now();
  try {
    await client.close();
  } finally {
    if (receipt) {
      receipt.transport_close_elapsed_ms = performance.now() - closeStart;
      await writeFile(
        join(output, "summary.json"),
        JSON.stringify(receipt, null, 2),
      );
    }
    await writeFile(join(output, "calls.json"), JSON.stringify(calls));
    await writeFile(join(output, "stderr.log"), stderr);
  }
}

// CLI parity runs once after the MCP transport has joined its provider cleanup,
// keeping a second JVM out of the live warm-session measurement and memory set.
if (values.cli) {
  const { path: _path, ...query } = queries[0];
  const proof = join(output, "cli-evidence.json");
  const args = [
    join(repo, "scripts/rea.mjs"),
    "inspect-android-jni-bindings",
    target,
    "--query",
    JSON.stringify(query),
    "--detail",
    values.detail,
    "--json",
  ];
  if (values.detail === "summary") args.push("--evidence_output", proof);
  const page =
    values.pages && values.detail === "summary"
      ? {
          kind: "android-jni",
          collection: "bindings",
          offset: 0,
          limit: 7,
          fields: [
            "declaration_id",
            "abi",
            "status",
            "coverage",
            "candidate_ids",
          ],
        }
      : undefined;
  if (page) args.push("--view", JSON.stringify(page));
  const start = performance.now();
  let command;
  try {
    command = await promisify(execFile)(process.execPath, args, {
      cwd: repo,
      env: environment,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120000,
      killSignal: "SIGINT",
    });
  } catch (cause) {
    await writeFile(join(output, "cli-stdout.json"), cause.stdout ?? "");
    await writeFile(join(output, "cli-stderr.log"), cause.stderr ?? "");
    throw cause;
  }
  const { stdout, stderr } = command;
  await writeFile(join(output, "cli-stdout.json"), stdout);
  await writeFile(join(output, "cli-stderr.log"), stderr);
  const response = JSON.parse(stdout);
  const evidence = values.detail === "summary" ? response.summary : response;
  assert.ok(
    validateJniOutput(evidence),
    JSON.stringify(validateJniOutput.errors),
  );
  let report = evidence.normalized_result;
  if (values.detail === "summary") {
    const bundle = JSON.parse(await readFile(proof, "utf8"));
    const parent = bundle.records.find(
      (row) =>
        row.evidence_id === evidence.normalized_result.parent_evidence_id,
    );
    assert.ok(parent);
    report = parent.normalized_result;
    if (page) checkPage(evidence.normalized_result, report);
    else checkSummary(evidence.normalized_result, report);
  }
  assert.equal(factDigest(report), factDigest(firstReport));
  await writeFile(
    join(output, "cli-parity.json"),
    JSON.stringify(
      {
        arguments: args,
        elapsed_ms: performance.now() - start,
        fact_digest: factDigest(report),
        response,
        stderr,
        scope:
          "One cold CLI parity check after MCP cleanup; separate from MCP task/token measurements.",
      },
      null,
      2,
    ),
  );
}
