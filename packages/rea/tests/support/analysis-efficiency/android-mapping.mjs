/** Public MCP mapping investigation with a source inventory and raw DEX oracle. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";

const { values } = parseArgs({
  options: {
    repository: { type: "string" },
    target: { type: "string" },
    mapping: { type: "string" },
    output: { type: "string" },
    "java-home": { type: "string" },
    jar: { type: "string" },
    oracle: { type: "string" },
    expectations: { type: "string" },
    "class-name": { type: "string" },
    repeats: { type: "string", default: "2" },
    variants: { type: "boolean", default: false },
    methods: { type: "string" },
    detail: { type: "string" },
    proof: { type: "boolean", default: false },
  },
});
for (const name of [
  "repository",
  "target",
  "mapping",
  "output",
  "java-home",
  "jar",
])
  assert.ok(values[name], `Missing --${name}`);
const repo = resolve(values.repository),
  target = resolve(values.target),
  mapping = resolve(values.mapping),
  output = resolve(values.output);
await mkdir(output, { mode: 0o700 });
const sha256 = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const targetSha = await sha256(target),
  mappingSha = await sha256(mapping);
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
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(repo, "scripts/rea.mjs"), "mcp"],
  cwd: repo,
  env: {
    PATH: process.env.PATH,
    JAVA_HOME: resolve(values["java-home"]),
    REA_JADX_MCP_JAR: resolve(values.jar),
    REA_JADX_HEAP_MIB: "1024",
    REA_JADX_ACTIVE_PROCESSOR_COUNT: "2",
    NODE_OPTIONS: "--max-old-space-size=3072",
    UV_THREADPOOL_SIZE: "2",
    REA_LOG_LEVEL: "silent",
    REA_MCP_TOOL_FAMILIES: values.proof ? "android,session" : "android",
    REA_MCP_INPUT_SCHEMA_PROFILE: "compact",
  },
  stderr: "pipe",
  maxBufferSize: 16 * 1024 * 1024,
});
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  if (stderr.length < 65536)
    stderr += chunk.toString().slice(0, 65536 - stderr.length);
});
const client = new Client({ name: "rea-real-android-mapping", version: "1" });
const calls = [],
  runs = [];
let catalog;
try {
  await client.connect(transport);
  catalog = await client.listTools();
  await writeFile(join(output, "catalog.json"), JSON.stringify(catalog));
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const contracts = new Map();
  for (const name of [
    "inspect_android_class",
    "inspect_android_method",
    ...(values.proof ? ["export_evidence_bundle"] : []),
  ]) {
    const definitions = catalog.tools.filter((tool) => tool.name === name);
    assert.equal(definitions.length, 1);
    assert.ok(definitions[0].outputSchema);
    contracts.set(name, {
      definition: definitions[0],
      validate: ajv.compile(definitions[0].outputSchema),
    });
  }
  const parents = [];
  assert.ok(values.detail === undefined || values.detail === "summary");
  const invoke = async (name, input) => {
    const args = {
      ...input,
      ...(name !== "export_evidence_bundle" && values.detail !== undefined
        ? { detail: values.detail }
        : {}),
    };
    const contract = contracts.get(name),
      start = performance.now();
    const result = await client.callTool(
      { name, arguments: args },
      { toolDefinition: contract.definition, timeout: 120000 },
    );
    const elapsed_ms = performance.now() - start;
    calls.push({ name, arguments: args, result, elapsed_ms });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    assert.ok(
      contract.validate(result.structuredContent),
      JSON.stringify(contract.validate.errors),
    );
    const evidence = result.structuredContent;
    if (name === "export_evidence_bundle") return evidence;
    assert.equal(evidence.subject.digest.sha256, targetSha);
    const projection = evidence.normalized_result;
    const normalized =
      values.detail === "summary" ? projection.summary : projection;
    if (values.detail === "summary") {
      assert.equal(evidence.operation, "inspect_analysis_view");
      assert.equal(evidence.raw_result, null);
      assert.equal(projection.parent_operation, name);
    } else assert.equal(evidence.parameters.mapping_path, args.mapping_path);
    parents.push({
      id:
        values.detail === "summary"
          ? projection.parent_evidence_id
          : evidence.evidence_id,
      name,
      args,
      normalized,
    });
    const report = normalized.mapping;
    assert.equal(report.association, "caller-selected");
    assert.equal(report.file.path, args.mapping_path);
    assert.equal(report.file.sha256, await sha256(args.mapping_path));
    assert.equal(
      report.coverage.mapped +
        report.coverage.ambiguous +
        report.coverage.unmapped,
      report.coverage.symbols,
    );
    return normalized;
  };
  const raw = values.oracle
    ? JSON.parse(await readFile(values.oracle, "utf8"))
    : undefined;
  const expected = values.expectations
    ? JSON.parse(await readFile(values.expectations, "utf8")).classes
    : undefined;
  // Only class header identities are read here; member resolution is checked
  // against handwritten original prototypes and independently decoded DEX.
  const classNames = new Map(
    [
      ...(await readFile(mapping, "utf8")).matchAll(
        /^([^\s:]+) -> ([^\s:]+):$/gm,
      ),
    ].map((match) => [match[2], match[1]]),
  );
  const primitive = {
    boolean: "Z",
    byte: "B",
    char: "C",
    short: "S",
    int: "I",
    long: "J",
    float: "F",
    double: "D",
    void: "V",
  };
  const originalType = (type) => {
    if (type.endsWith("[]")) return "[" + originalType(type.slice(0, -2));
    return primitive[type] ?? `L${type.replaceAll(".", "/")};`;
  };
  const selected = values["class-name"]
    ? [values["class-name"]]
    : raw?.map((cls) => cls.raw_type.slice(1, -1).replaceAll("/", "."));
  assert.ok(selected?.length);
  if (expected) assert.equal(selected.length, expected.length);
  const repeats = Number(values.repeats);
  const requestedMethods =
    values.methods === undefined
      ? undefined
      : new Set(values.methods.split(","));
  assert.ok(Number.isSafeInteger(repeats) && repeats > 0 && repeats <= 20);
  for (let pass = 0; pass < repeats; pass++) {
    const firstCall = calls.length,
      start = performance.now();
    const firstParent = parents.length;
    for (const class_name of selected) {
      const result = await invoke("inspect_android_class", {
        path: target,
        class_name,
        mapping_path: mapping,
      });
      assert.equal(result.mapping.coverage.unmapped, 0);
      assert.equal(result.mapping.coverage.ambiguous, 0);
      if (!expected) continue;
      const source = expected.find(
        (cls) => cls.original_name === classNames.get(class_name),
      );
      const dex = raw.find(
        (cls) => cls.raw_type === `L${class_name.replaceAll(".", "/")};`,
      );
      assert.ok(source && dex);
      const fields = [],
        methods = [];
      for (const symbol of result.mapping.symbols) {
        assert.equal(symbol.resolution.status, "mapped");
        const mapped = symbol.resolution.mapped;
        if (symbol.kind === "class") {
          assert.equal(mapped.name, classNames.get(symbol.raw_name));
          continue;
        }
        assert.equal(mapped.class, source.original_name);
        if (symbol.kind === "field") {
          assert.ok(
            dex.fields.some(
              (field) =>
                field.raw_name === symbol.raw_name &&
                field.dex_type === symbol.dex_type,
            ),
          );
          fields.push([mapped.name, originalType(mapped.type)]);
        } else {
          assert.ok(
            dex.methods.some(
              (method) =>
                method.raw_name === symbol.raw_name &&
                method.dex_descriptor === symbol.dex_descriptor,
            ),
          );
          const descriptor = `(${mapped.parameter_types.map(originalType).join("")})${originalType(mapped.return_type)}`;
          methods.push([mapped.name, descriptor]);
          if (
            requestedMethods !== undefined &&
            !requestedMethods.has(mapped.name)
          )
            continue;
          const body = await invoke("inspect_android_method", {
            path: target,
            class_name,
            method_name: symbol.name,
            overload_index: symbol.overload_index,
            mapping_path: mapping,
          });
          const annotation = body.mapping.symbols.filter(
            (row) => row.kind === "method",
          );
          assert.equal(annotation.length, 1);
          assert.deepEqual(annotation[0], symbol);
          assert.equal(body.method.dex_descriptor, symbol.dex_descriptor);
        }
      }
      assert.deepEqual(fields.sort(), Object.entries(source.fields).sort());
      assert.deepEqual(
        methods.sort(),
        Object.entries(source.methods)
          .flatMap(([name, descriptors]) =>
            descriptors.map((descriptor) => [name, descriptor]),
          )
          .sort(),
      );
      if (requestedMethods !== undefined)
        for (const name of requestedMethods)
          assert.ok(
            methods.some(([observed]) => observed === name),
            `Requested original method absent: ${name}`,
          );
      assert.equal(fields.length, dex.fields.length);
      assert.equal(methods.length, dex.methods.length);
    }
    if (values.proof) {
      const path = join(output, `pass-${pass}-evidence.json`);
      await invoke("export_evidence_bundle", { path });
      const bundle = JSON.parse(await readFile(path, "utf8"));
      for (const expected of parents.slice(firstParent)) {
        const parent = bundle.records.find(
          (record) => record.evidence_id === expected.id,
        );
        assert.ok(parent, "Complete source Evidence must remain exportable");
        assert.equal(parent.operation, expected.name);
        assert.equal(parent.subject.digest.sha256, targetSha);
        assert.equal(
          parent.parameters.mapping_path,
          expected.args.mapping_path,
        );
        assert.deepEqual(parent.normalized_result, expected.normalized);
        assert.notEqual(parent.raw_result, null);
      }
    }
    runs.push({
      temperature: pass === 0 ? "cold-provider" : "warm-session",
      elapsed_ms: performance.now() - start,
      calls: calls.length - firstCall,
    });
  }
  if (values.variants) {
    assert.ok(expected, "Variants require the source-built fixture");
    const text = await readFile(mapping, "utf8");
    const class_name = [...classNames].find(
      ([, original]) => original === "fixture.mapping.Original",
    )?.[0];
    assert.ok(class_name);
    const lines = text.split("\n");
    const fieldLine = lines.findIndex((line) =>
      /^\s+java\.lang\.String title -> /u.test(line),
    );
    assert.ok(fieldLine > 0);
    const partial = [...lines];
    partial.splice(fieldLine, 1, "    malformed member");
    const partialPath = join(output, "partial-malformed.txt");
    await writeFile(partialPath, partial.join("\n"));
    const partialResult = await invoke("inspect_android_class", {
      path: target,
      class_name,
      mapping_path: partialPath,
    });
    assert.equal(partialResult.mapping.records.malformed, 1);
    assert.equal(partialResult.mapping.coverage.unmapped, 1);
    assert.equal(partialResult.mapping.coverage.ambiguous, 0);
    assert.ok(partialResult.mapping.coverage.mapped > 1);
    const header = lines.findIndex(
      (line) => line === `fixture.mapping.Original -> ${class_name}:`,
    );
    let end = header + 1;
    while (end < lines.length && !/^[^\s#].* -> .*:$/u.test(lines[end])) end++;
    const duplicatePath = join(output, "duplicate-class.txt");
    await writeFile(
      duplicatePath,
      text + "\n" + lines.slice(header, end).join("\n"),
    );
    const duplicate = await invoke("inspect_android_class", {
      path: target,
      class_name,
      mapping_path: duplicatePath,
    });
    assert.ok(duplicate.mapping.coverage.ambiguous > 0);
    assert.equal(duplicate.mapping.coverage.unmapped, 0);
    const owner = duplicate.mapping.symbols.find(
      (row) => row.kind === "class" && row.raw_name === class_name,
    );
    assert.equal(owner.resolution.status, "ambiguous");
    assert.equal(owner.resolution.candidate_count, 2);
    const conflicting = [...lines];
    conflicting.splice(
      fieldLine + 1,
      0,
      '# {"id":"com.android.tools.r8.residualsignature","signature":"Ljava/lang/String;"}',
      '# {"id":"com.android.tools.r8.residualsignature","signature":"I"}',
    );
    const conflictPath = join(output, "conflicting-residual.txt");
    await writeFile(conflictPath, conflicting.join("\n"));
    const conflict = await invoke("inspect_android_class", {
      path: target,
      class_name,
      mapping_path: conflictPath,
    });
    assert.ok(
      conflict.mapping.symbols.some(
        (row) =>
          row.kind === "field" &&
          row.resolution.reason === "residual-signature-conflict",
      ),
    );
  }
  await writeFile(join(output, "calls.json"), JSON.stringify(calls));
  await writeFile(
    join(output, "summary.json"),
    JSON.stringify(
      {
        targetSha,
        mappingSha,
        classes: selected.length,
        runs,
        calls: calls.length,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      targetSha,
      mappingSha,
      classes: selected.length,
      runs,
      calls: calls.length,
    }),
  );
} finally {
  await client.close();
  await writeFile(join(output, "stderr.log"), stderr);
}
