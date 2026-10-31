import { readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const mode = process.env.REA_RECOVERY_FIXTURE_MODE ?? "normal";
if (args.includes("--version")) {
  console.log(
    mode === "wrong-version"
      ? "wakaru 0.0.0"
      : mode === "additive"
        ? "wakaru 1.99.0"
        : "wakaru 1.14.0",
  );
} else {
  const input = args[0];
  const output = args[args.indexOf("-o") + 1];
  const inputs = args.slice(
    0,
    args.findIndex((arg) => arg.startsWith("--")),
  );
  if (inputs.length > 1) {
    const modules = [];
    const provenance = {
      format: "unknown",
      strategy: "structural",
      modules: {},
    };
    for (const [index, selected] of inputs.entries()) {
      const bytes = await readFile(selected);
      const filename = `module-${index}.js`;
      modules.push({ filename, kind: "javascript", status: "decompiled" });
      await writeFile(join(output, filename), bytes);
      provenance.modules[filename] = {
        input:
          index === 1 && mode === "secondary-foreign"
            ? "/unselected.js"
            : selected,
        ranges: [
          [
            0,
            index === 1 && mode === "secondary-overflow"
              ? bytes.length + 1
              : bytes.length,
          ],
        ],
        context_ranges: [
          [0, index === 1 && mode === "secondary-utf8" ? 2 : bytes.length],
        ],
        extraction: "structural",
      };
    }
    if (mode === "redistribute") {
      const primary = process.env.REA_RECOVERY_ORIGINAL_PATH;
      const secondary = process.env.REA_RECOVERY_ADDITIONAL_PATH;
      const first = await readFile(primary);
      const second = await readFile(secondary);
      await writeFile(primary, Buffer.concat([first, second.subarray(0, 1)]));
      await writeFile(secondary, second.subarray(1));
    }
    if (mode === "secondary-change")
      await writeFile(
        process.env.REA_RECOVERY_ADDITIONAL_PATH,
        "changed additional input",
      );
    await writeFile(
      join(output, "provenance.json"),
      JSON.stringify(provenance),
    );
    console.log(
      JSON.stringify({
        detected_formats: [],
        safety: "normal",
        modules,
        warnings: [],
        total: modules.length,
        failed: 0,
        elapsed_ms: 1,
      }),
    );
    process.exit(0);
  }
  const bytes = await readFile(input);
  await writeFile(join(dirname(output), "recovery-started"), "started");
  if (mode === "hang") await new Promise(() => setInterval(() => {}, 1000));
  if (mode === "startup-error") {
    console.error("fixture: unsupported producer dependency");
    process.exit(2);
  }
  if (mode === "snapshot-change")
    await writeFile(input, Buffer.alloc(bytes.length, 0x61));
  if (mode === "engine-change")
    await writeFile(
      process.env.REA_RECOVERY_ENGINE_PATH,
      "#!/bin/sh\nexit 1\n",
    );
  if (mode === "source-change")
    await writeFile(process.env.REA_RECOVERY_ORIGINAL_PATH, "changed original");
  const filename = mode === "escaping" ? "../escaped.js" : "module.js";
  const modules = [
    mode === "additive"
      ? {
          filename,
          kind: "javascript",
          status: "future_status",
          future_module_field: true,
        }
      : { filename, kind: "javascript", status: "decompiled" },
  ];
  if (mode === "duplicate") modules.push(modules[0]);
  if (mode !== "missing-file" && mode !== "escaping") {
    if (mode === "symlink") await symlink(input, join(output, filename));
    else
      await writeFile(join(output, filename), "export const recovered = 42;\n");
  }
  if (mode === "extra-file")
    await writeFile(join(output, "extra.js"), "unreported");
  if (mode === "directory-symlink")
    await symlink(dirname(input), join(output, "nested"));
  if (mode === "bad-map") await writeFile(join(output, "module.js.map"), "{}");
  if (mode === "normal")
    await writeFile(
      join(output, "module.js.map"),
      JSON.stringify({
        version: 3,
        file: "module.js",
        sources: ["../inputs/bundle.js"],
        names: [],
        mappings: "AAAA",
      }),
    );
  const ranges =
    mode === "overflow-range"
      ? [[0, bytes.length + 1]]
      : mode === "utf8-range"
        ? [[0, 2]]
        : [[0, bytes.length]];
  const provenance = {
    format: "unknown",
    strategy: "structural",
    modules: {
      [filename]: {
        input: mode === "source-mismatch" ? "/different.js" : input,
        ranges,
        extraction: "structural",
      },
    },
  };
  if (mode === "additive") {
    provenance.future_top_field = "added";
    provenance.modules[filename].future_entry_field = [1];
  }
  if (mode === "extra-provenance")
    provenance.modules["extra.js"] = provenance.modules[filename];
  if (mode !== "missing-provenance")
    await writeFile(
      join(output, "provenance.json"),
      JSON.stringify(provenance),
    );
  const report = {
    detected_formats: [],
    safety: "normal",
    modules,
    warnings:
      mode === "partial"
        ? [
            {
              filename,
              kind: "parse_error",
              is_error: true,
              message: "fixture transform failed; retained source",
            },
          ]
        : mode === "additive"
          ? [
              {
                filename,
                kind: "notice",
                is_error: false,
                message: "future warning",
                code: "W001",
              },
            ]
          : [],
    ...(mode === "additive" ? { future_report_field: { nested: true } } : {}),
    total: modules.length,
    failed: mode === "partial" ? 1 : 0,
    elapsed_ms: 1,
  };
  console.log(
    mode === "malformed-report" ? "{invalid}" : JSON.stringify(report),
  );
  if (mode === "partial") process.exitCode = 1;
}
