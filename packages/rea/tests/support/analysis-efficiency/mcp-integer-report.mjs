// One producer for the numerical sections of the committed allocation report.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    data: { type: "string" },
    markdown: { type: "string" },
    check: { type: "boolean", default: false },
  },
});
const reportDirectory = new URL(
  "../../../docs/verification/analysis-efficiency/",
  import.meta.url,
);
const dataPath =
  values.data ?? new URL("mcp-integer-allocation.json", reportDirectory);
const markdownPath =
  values.markdown ?? new URL("mcp-integer-allocation.md", reportDirectory);
const data = JSON.parse(await readFile(dataPath, "utf8"));
assert.equal(data.status, "passed");
const original = await readFile(markdownPath, "utf8");
const fixed = (value, digits = 3) => {
  assert.ok(Number.isFinite(value));
  return value.toFixed(digits);
};
const mib = (value, digits = 1) => fixed(value / 2 ** 20, digits);
const median = (values) => {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};
const table = (headers, rows, right = []) =>
  [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map((_, index) => (right.includes(index) ? "---:" : "---")).join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
const pair = (item, key, format = fixed) =>
  `${format(item.baseline[key].median)} → ${format(item.candidate[key].median)}`;
const heapMetric = "retained_v8_heap_bytes_after_gc";
const heaps = data.heap_diagnostics.summary;
const changes = heaps.map(
  (item) =>
    (item.baseline[heapMetric].median - item.candidate[heapMetric].median) /
    2 ** 20,
);
const changesText = [...new Set(changes.map((value) => fixed(value, 1)))].join(
  "–",
);
const separated = heaps.every(
  (item) => item.baseline[heapMetric].min > item.candidate[heapMetric].max,
);
const provenance = `Baseline \`main@${data.measurement_inputs.baseline_revision}\`; candidate \`${data.measurement_inputs.candidate_revision}\`. This is a pinned comparison.\n\nIn separate inspector/forced-GC diagnostics, retained REA V8 heap decreases by about ${changesText} MiB. ${separated ? "The three-pair ranges do not overlap in either profile." : "Ranges overlap; inspect the observations below."} Inspector perturbation is included. Normal task timing, CPU and peak memory are reported separately; these observations do not establish a general latency or peak-memory reduction.`;
const normal = table(
  [
    "Task",
    "Cache",
    "Input profile",
    "Wall s",
    "Family CPU s",
    "Family peak MiB",
  ],
  data.summary.map((item) => [
    item.artifact ?? "directory",
    item.cache,
    item.profile,
    pair(item, "wall_seconds"),
    pair(item, "cpu_seconds"),
    pair(item, "kernel_family_peak_bytes_including_page_cache", mib),
  ]),
  [3, 4, 5],
);
const discovery = data.summary.find(
  (item) =>
    item.phase === "discovery" &&
    item.cache === "cold" &&
    item.profile === "default",
);
assert.ok(discovery);
const audit = (role) =>
  median(
    data.records
      .filter(
        (row) =>
          row.phase === "discovery" &&
          row.cache === "cold" &&
          row.profile === "default" &&
          row.role === role,
      )
      .map(
        (row) =>
          (row.runtime_audit_ms.before + row.runtime_audit_ms.after) / 1000,
      ),
  );
const sdk =
  `Cold/default directory audit wall medians are ${fixed(audit("baseline"))} s baseline / ${fixed(audit("candidate"))} s candidate; SDK spans are ${pair(discovery, "sdk_task_elapsed_seconds")} s. Whole-family costs include those experimental audits. Their cause and per-span CPU are unmeasured.\n\n${data.sdk_task_elapsed_scope}\n\n` +
  table(
    ["Task", "Cache", "Inputs", "SDK span s, baseline → candidate"],
    data.summary.map((item) => [
      item.artifact ?? "directory",
      item.cache,
      item.profile,
      pair(item, "sdk_task_elapsed_seconds"),
    ]),
    [3],
  );
const heap = table(
  [
    "Inputs",
    "REA V8 retained MiB",
    "Baseline range",
    "Candidate range",
    "Diagnostic wall s",
    "CPU s",
    "Family peak MiB",
  ],
  heaps.map((item) => [
    item.profile,
    pair(item, heapMetric, (value) => mib(value, 3)),
    ...["baseline", "candidate"].map(
      (role) =>
        `${mib(item[role][heapMetric].min, 3)}–${mib(item[role][heapMetric].max, 3)}`,
    ),
    pair(item, "wall_seconds"),
    pair(item, "cpu_seconds"),
    pair(item, "kernel_family_peak_bytes_including_page_cache", mib),
  ]),
  [1, 2, 3, 4, 5, 6],
);
const integer = (value) => new Intl.NumberFormat("en-US").format(value);
const tokens = (profile, phase, artifact) => {
  const values = data.records
    .filter(
      (row) =>
        row.profile === profile &&
        row.phase === phase &&
        row.artifact === artifact,
    )
    .map((row) => row.tokens_estimated.whole_task);
  assert.ok(values.length > 0);
  return [...new Set([Math.min(...values), Math.max(...values)])]
    .map(integer)
    .join("–");
};
const catalogs = data.catalogs;
const context =
  `${data.tokenizer}. Actual model usage is unmeasured.\n\n` +
  table(
    [
      "Profile",
      "Input directory once",
      "Directory task",
      "ripgrep task",
      "Zellij task",
    ],
    ["default", "full"].map((profile) => [
      profile,
      integer(catalogs[profile].input_catalog_tokens),
      tokens(profile, "discovery", null),
      tokens(profile, "analysis", "ripgrep"),
      tokens(profile, "analysis", "zellij"),
    ]),
    [1, 2, 3, 4],
  ) +
  `\n\nRaw SDK directory costs per list: ${integer(catalogs.default.raw_catalog_tokens)}/${integer(catalogs.full.raw_catalog_tokens)} tokens and ${integer(catalogs.default.raw_catalog_bytes)}/${integer(catalogs.full.raw_catalog_bytes)} bytes for default/full.\n\n${data.context_scope}`;
const sections = { provenance, normal, sdk, heap, context };
// oxfmt may pad table cells and separator dashes; neither changes report facts.
const normalized = (value) =>
  value
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s*\|\s*/gu, "|")
    .replace(
      /(?<=\|)(:)?-{3,}(:)?(?=\|)/gu,
      (_, left, right) => `${left ?? ""}---${right ?? ""}`,
    );
let rendered = original;
const changed = [];
for (const [name, content] of Object.entries(sections)) {
  const begin = `<!-- BEGIN:allocation-report:${name} -->`;
  const end = `<!-- END:allocation-report:${name} -->`;
  assert.equal(
    rendered.split(begin).length,
    2,
    `Expected one opening report marker: ${name}`,
  );
  assert.equal(
    rendered.split(end).length,
    2,
    `Expected one closing report marker: ${name}`,
  );
  const start = rendered.indexOf(begin) + begin.length;
  const finish = rendered.indexOf(end);
  assert.ok(finish > start, `Invalid report marker order: ${name}`);
  if (normalized(rendered.slice(start, finish)) !== normalized(content)) {
    changed.push(name);
    rendered =
      rendered.slice(0, start) + `\n\n${content}\n\n` + rendered.slice(finish);
  }
}
if (values.check) {
  assert.equal(
    changed.length,
    0,
    `Generated allocation report differs: ${changed.join(", ")}`,
  );
  console.log("Allocation report matches committed receipt data");
} else if (changed.length) {
  await writeFile(markdownPath, rendered);
  console.log(`Updated allocation report sections: ${changed.join(", ")}`);
}
