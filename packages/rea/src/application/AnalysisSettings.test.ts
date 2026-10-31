import { expect, it } from "vitest";
import { AnalysisSettings } from "./AnalysisSettings.js";
import {
  runtimeAnalysisConfig,
  runtimeAsarHeaderAdmission,
} from "../config/runtimeAnalysisSettings.js";
import { parseConfig } from "../config/parseConfig.js";

it("updates atomically, restores launch values, and refuses stale or invalid writes", () => {
  const store = new AnalysisSettings({ REA_ASAR_MAX_HEADER_BYTES: "20000000" });
  const inspect = () => store.inspect({ settings: ["asar.max_header_bytes"] });
  expect(inspect().settings[0]).toMatchObject({
    value: 20000000,
    source: "setting",
  });
  expect(
    store.update({
      changes: [
        { setting: "asar.max_header_bytes", action: "set", value: 30000000 },
      ],
      expected_revision: 0,
    }).ok,
  ).toBe(true);
  expect(inspect()).toMatchObject({
    revision: 1,
    settings: [{ value: 30000000, source: "runtime" }],
  });
  expect(
    store.update({
      changes: [
        { setting: "asar.max_header_bytes", action: "set", value: 30000000 },
      ],
    }),
  ).toMatchObject({ ok: true, value: { changed: false, revision: 1 } });
  for (const changes of [
    [
      { setting: "asar.max_header_bytes", action: "set", value: 100 },
      { setting: "wasm.command_timeout_ms", action: "set", value: 0 },
    ],
    [
      { setting: "asar.max_header_bytes", action: "reset" },
      { setting: "asar.max_header_bytes", action: "set", value: 100 },
    ],
    [{ setting: "NODE_OPTIONS", action: "set", value: 1 }],
  ])
    expect(store.update({ changes }).ok).toBe(false);
  expect(
    store.update({
      changes: [{ setting: "asar.max_header_bytes", action: "reset" }],
      expected_revision: 0,
    }).ok,
  ).toBe(false);
  expect(inspect().revision).toBe(1);
  expect(
    store.update({
      changes: [{ setting: "asar.max_header_bytes", action: "reset" }],
    }),
  ).toMatchObject({
    ok: true,
    value: { revision: 2, settings: [{ value: 20000000, source: "setting" }] },
  });
  expect(new AnalysisSettings({}).inspect().revision).toBe(0);
});

it("keeps accepted operations and their typed provider views stable across concurrent updates", async () => {
  const store = new AnalysisSettings({});
  const config = parseConfig({});
  if (!config.ok) throw config.error;
  const live = runtimeAnalysisConfig(config.value, store.read);
  const asar = runtimeAsarHeaderAdmission({}, store.read);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = store.run(async () => {
    await barrier;
    expect(asar.maximumBytes).toBe(16777216);
    expect(live.ghidraStartupTimeoutMs).toBe(330000);
    expect(live.regexMatchingDeadline.deadlineMs).toBe(5000);
    expect(store.read().revision).toBe(0);
  });
  try {
    const changed = store.update({
      changes: [
        { setting: "asar.max_header_bytes", action: "set", value: 33554432 },
        { setting: "ghidra.startup_timeout_ms", action: "set", value: 999999 },
        { setting: "regex.matching_deadline_ms", action: "set", value: 10000 },
      ],
    });
    expect(changed.ok).toBe(true);
  } finally {
    release();
    await Promise.allSettled([pending]);
  }
  await pending;
  store.run(() => {
    expect(asar.maximumBytes).toBe(33554432);
    expect(live.ghidraStartupTimeoutMs).toBe(999999);
    expect(live.regexMatchingDeadline.deadlineMs).toBe(10000);
  });
});

it("exposes shared provider controls and preserves the explicit unbounded decompile value", () => {
  const environment = { REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: "7" };
  const store = new AnalysisSettings(environment);
  const parsed = parseConfig(environment);
  if (!parsed.ok) throw parsed.error;
  const config = runtimeAnalysisConfig(parsed.value, store.read);
  expect(
    store
      .inspect({ provider: "ghidra", operation: "search_strings" })
      .settings.map(({ setting }) => setting),
  ).toEqual(["ghidra.startup_timeout_ms"]);
  expect(
    store
      .inspect({ provider: "ida", operation: "search_strings" })
      .settings.map(({ setting }) => setting),
  ).toEqual(["regex.matching_deadline_ms", "regex.worker_heap_request_mib"]);
  expect(
    store
      .inspect({ operation: "inventory_artifact" })
      .settings.map(({ setting }) => setting),
  ).toEqual(["asar.max_header_bytes"]);
  expect(
    store.update({
      changes: [
        {
          setting: "ghidra.decompile_timeout_seconds",
          action: "set",
          value: null,
        },
      ],
    }).ok,
  ).toBe(true);
  expect(config.ghidraDecompileTimeoutSeconds).toBeUndefined();
  expect(
    store.inspect({ settings: ["ghidra.decompile_timeout_seconds"] })
      .settings[0],
  ).toMatchObject({ value: null, launch_value: 7, source: "runtime" });
  for (const [setting, value] of [
    ["asar.max_header_bytes", null],
    ["asar.max_header_bytes", 268435457],
    ["javascript.max_heap_mb", 127],
    ["regex.matching_deadline_ms", 1.5],
  ]) {
    expect(
      store.update({ changes: [{ setting, action: "set", value }] }).ok,
    ).toBe(false);
  }
  expect(store.inspect().revision).toBe(1);
  expect(
    store.update({
      changes: [
        { setting: "ghidra.decompile_timeout_seconds", action: "reset" },
      ],
    }).ok,
  ).toBe(true);
  expect(config.ghidraDecompileTimeoutSeconds).toBe(7);
});
