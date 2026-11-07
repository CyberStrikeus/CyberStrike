import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

processTest(
  "renderer DOM callbacks report rejected bridge actions and preserve successful actions",
  async ({ processes }) => {
    const cases = [
      {
        path: fileURLToPath(
          new URL(
            "../../../website/public/examples/notes-electron/renderer.js",
            import.meta.url,
          ),
        ),
        button: "#export",
        output: "#status",
        failure: "Export failed",
        diagnostic: "Notes export failed",
        successfulReply: "/selected/notes.csv",
        success: "Saved to /selected/notes.csv",
        api: "notes",
      },
      {
        path: fileURLToPath(
          new URL(
            "../../conformance/readiness/electron/renderer.js",
            import.meta.url,
          ),
        ),
        button: "#run",
        output: "#result",
        failure: "Echo failed",
        diagnostic: "Renderer echo failed",
        successfulReply: "renderer reply",
        success: "renderer reply",
        api: "readiness",
      },
    ];
    // Execute the real classic scripts with controlled DOM/bridge seams. This
    // covers discarded event returns, not a live Electron or browser runtime.
    const source = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
for (const scenario of ${JSON.stringify(cases)}) {
  const failure = new Error("selected bridge rejected");
  const errors = [];
  let action, deepLink, finish, text = "";
  let reply = () => Promise.reject(failure);
  const output = {
    get textContent() { return text; },
    set textContent(value) { text = value; finish(); },
  };
  const button = { addEventListener(type, callback) {
    assert.equal(type, "click"); action = callback;
  }};
  const api = scenario.api === "notes"
    ? { exportCsv: () => reply() }
    : { echo: (value) => { assert.equal(value, "renderer"); return reply(); },
        onDeepLink: (callback) => { deepLink = callback; } };
  runInNewContext(readFileSync(scenario.path, "utf8"), {
    document: { querySelector(selector) {
      if (selector === scenario.button) return button;
      assert.equal(selector, scenario.output); return output;
    }},
    window: { [scenario.api]: api },
    console: { error: (...arguments_) => errors.push(arguments_) },
  }, { filename: scenario.path });
  let completed = new Promise((resolve) => { finish = resolve; });
  action(); // DOM event dispatch ignores any callback return value.
  await completed;
  assert.equal(text, scenario.failure);
  assert.deepEqual(errors, [[scenario.diagnostic, failure]]);
  reply = () => Promise.resolve(scenario.successfulReply);
  completed = new Promise((resolve) => { finish = resolve; });
  action();
  await completed;
  assert.equal(text, scenario.success);
  assert.equal(errors.length, 1);
  if (deepLink) {
    deepLink({}, "rea://selected/link");
    assert.equal(text, "rea://selected/link");
  }
}
`;
    const result = await processes.run(
      process.execPath,
      [
        "--unhandled-rejections=strict",
        "--input-type=module",
        "--eval",
        source,
      ],
      { timeoutMs: 10_000 },
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr).toBe(0);
  },
);

processTest(
  "theme translation failure preserves the applied base theme and hides the toggle",
  async ({ processes }) => {
    const failureRoot = await createTestTempDirectory("rea-theme-failure-");
    const successRoot = await createTestTempDirectory("rea-theme-success-");
    const theme = fileURLToPath(
      new URL("../../../website/public/assets/theme.js", import.meta.url),
    );
    await Promise.all([
      ...[failureRoot, successRoot].map((root) =>
        copyFile(theme, join(root, "theme.js")),
      ),
      ...[failureRoot, successRoot].map((root) =>
        writeFile(join(root, "package.json"), '{"type":"module"}\n'),
      ),
      writeFile(
        join(failureRoot, "i18n.js"),
        "throw globalThis.translationFailure;\n",
      ),
      writeFile(
        join(successRoot, "i18n.js"),
        'export const t = (value) => "translated:" + value;\n',
      ),
    ]);
    const source = `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Script } from "node:vm";
globalThis.translationFailure = new Error("selected theme translation failed");
for (const [directory, fails] of ${JSON.stringify([
      [failureRoot, true],
      [successRoot, false],
    ])}) {
  const errors = [], listeners = new Map(), clicks = new Map(), writes = [];
  const root = { dataset: {} }, meta = { content: "" };
  let ready, finish, hidden = true;
  const settled = new Promise((resolve) => { finish = resolve; });
  const button = {
    get hidden() { return hidden; },
    set hidden(value) { hidden = value; if (!value) finish(); },
    setAttribute(key, value) { this[key] = value; },
    addEventListener(type, callback) { clicks.set(type, callback); },
  };
  const path = join(directory, "theme.js");
  new Script(readFileSync(path, "utf8"), {
    filename: path,
    importModuleDynamically: (specifier) => import(new URL(specifier, pathToFileURL(path)).href),
  }).runInNewContext({
    document: {
      documentElement: root,
      querySelector(selector) {
        if (selector === 'meta[name="theme-color"]') return meta;
        assert.equal(selector, "[data-theme-toggle]"); return button;
      },
      addEventListener(type, callback) { assert.equal(type, "DOMContentLoaded"); ready = callback; },
    },
    window: {
      localStorage: { getItem: () => null, setItem: (...values) => writes.push(values) },
      matchMedia: () => ({ matches: true, addEventListener() {} }),
      addEventListener(type, callback) { listeners.set(type, callback); },
      dispatchEvent(event) { listeners.get(event.type)?.(event); },
    },
    Event,
    console: { error: (...arguments_) => { errors.push(arguments_); finish(); } },
  });
  assert.equal(root.dataset.theme, "dark");
  assert.equal(meta.content, "#1e1e2e");
  assert.equal(hidden, true);
  ready(); // No event dispatcher awaits this return value.
  await settled;
  if (fails) {
    assert.deepEqual(errors, [["Theme toggle initialization failed", globalThis.translationFailure]]);
    assert.equal(hidden, true);
    assert.equal(root.dataset.theme, "dark");
    assert.equal(meta.content, "#1e1e2e");
    assert.equal(clicks.size, 0);
  } else {
    assert.deepEqual(errors, []);
    assert.equal(hidden, false);
    assert.equal(button["aria-label"], "translated:Switch to light mode");
    clicks.get("click")();
    assert.equal(root.dataset.theme, "light");
    assert.equal(meta.content, "#ffffff");
    assert.equal(button["aria-label"], "translated:Switch to dark mode");
    assert.deepEqual(writes, [["rea-theme", "light"]]);
  }
}
`;
    const result = await processes.run(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--unhandled-rejections=strict",
        "--input-type=module",
        "--eval",
        source,
      ],
      { timeoutMs: 10_000 },
    );
    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr).toBe(0);
  },
);
