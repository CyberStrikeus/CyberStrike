import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test } from "vitest";

import { V8InspectorProvider } from "../../../src/inspector/V8InspectorProvider.js";
import { startFakeV8Inspector } from "../../fixtures/inspector/fakeV8Inspector.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

async function entryFile(name: string): Promise<string> {
  const root = await createTestTempDirectory("rea-node-discovery-");
  const entry = join(root, name);
  await writeFile(entry, "setInterval(() => {}, 1000);\n");
  return entry;
}

test("lists and observes a Windows target without inventing a decoded path", async () => {
  const entry = await entryFile("entry.js");
  const reported = "file://C:_tools_entry.js";
  const fake = await startFakeV8Inspector({
    targetUrl: reported,
    scriptUrls: [pathToFileURL(entry).href],
  });
  try {
    const provider = new V8InspectorProvider();
    const listed = await provider.listTargets({
      inspector_endpoint: fake.endpoint,
    });
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toMatchObject([
      {
        target_id: fake.targetId,
        location: {
          kind: "unresolved",
          reported_url: reported,
          reason: "unverifiable-file-location",
        },
      },
    ]);
    expect(listed.value.excluded.unsupported_location).toBe(0);
    expect(fake.commands).toEqual([]);

    const missing = await provider.observe({
      inspector_endpoint: fake.endpoint,
      target_id: "not-the-selected-target",
      observation_ms: 10,
    });
    expect(missing).toMatchObject({
      ok: false,
      error: { reason: "target_not_found" },
    });
    expect(fake.commands).toEqual([]);

    const observed = await provider.observe({
      inspector_endpoint: fake.endpoint,
      target_id: fake.targetId,
      observation_ms: 10,
    });
    if (!observed.ok) throw observed.error;
    expect(observed.value.target.location).toEqual(
      listed.value.targets[0]?.location,
    );
    expect(observed.value.scripts.items).toMatchObject([
      { location: { kind: "file", file_path: entry } },
    ]);
    expect(observed.value.unknowns).toContain(
      "The discovery-reported file location cannot be verified; loaded script locations are resolved independently from Debugger.scriptParsed.",
    );
    expect(fake.commands.map(({ method }) => method)).toEqual([
      "Runtime.enable",
      "Debugger.enable",
    ]);
  } finally {
    await fake.close();
  }
});

test
  .runIf(process.platform !== "win32")
  .each(["entry#hash.js", "entry%percent.js", "entry%23hash.js"])(
  "interprets %s as a literal Node discovery path on POSIX",
  async (name) => {
    const entry = await entryFile(name);
    const fake = await startFakeV8Inspector({ targetUrl: `file://${entry}` });
    try {
      const listed = await new V8InspectorProvider().listTargets({
        inspector_endpoint: fake.endpoint,
      });
      if (!listed.ok) throw listed.error;
      expect(listed.value.targets).toMatchObject([
        { location: { kind: "file", file_path: entry } },
      ]);
    } finally {
      await fake.close();
    }
  },
);

test("keeps a lossy discovery name unresolved even when its underscore alias exists", async () => {
  const alias = await entryFile("entry_quote.js");
  const reported = `file://${alias}`;
  const fake = await startFakeV8Inspector({ targetUrl: reported });
  try {
    const listed = await new V8InspectorProvider().listTargets({
      inspector_endpoint: fake.endpoint,
    });
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toMatchObject([
      { location: { kind: "unresolved", reported_url: reported } },
    ]);
  } finally {
    await fake.close();
  }
});

test.each([
  "file://",
  "file://remote.test/share/entry.js",
  "javascript:entry()",
  "file://a:secret@remote.test/entry.js",
])("keeps unsupported discovery location %s excluded", async (targetUrl) => {
  const fake = await startFakeV8Inspector({ targetUrl });
  try {
    const listed = await new V8InspectorProvider().listTargets({
      inspector_endpoint: fake.endpoint,
    });
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toEqual([]);
    expect(listed.value.excluded.unsupported_location).toBe(1);
  } finally {
    await fake.close();
  }
});

test.each([
  { targetType: "page" as const },
  { runtimeProduct: "Chrome/132.0" },
])("does not apply Node discovery semantics to %j", async (context) => {
  const fake = await startFakeV8Inspector({
    targetUrl: "file://C:_tools_entry.js",
    ...context,
  });
  try {
    const listed = await new V8InspectorProvider().listTargets({
      inspector_endpoint: fake.endpoint,
    });
    if (!listed.ok) throw listed.error;
    expect(listed.value.targets).toEqual([]);
    expect(listed.value.excluded.unsupported_location).toBe(1);
  } finally {
    await fake.close();
  }
});

test("does not reinterpret lossy discovery paths in script metadata", async () => {
  const entry = await entryFile("entry.js");
  const fake = await startFakeV8Inspector({
    targetUrl: "file://C:_tools_entry.js",
    scriptUrls: [
      "file://C:_tools_entry.js",
      "file://remote.test/share/entry.js",
      pathToFileURL(entry).href,
    ],
  });
  try {
    const observed = await new V8InspectorProvider().observe({
      inspector_endpoint: fake.endpoint,
      target_id: fake.targetId,
      observation_ms: 10,
    });
    if (!observed.ok) throw observed.error;
    expect(observed.value.scripts.items).toMatchObject([
      { location: { kind: "file", file_path: entry } },
    ]);
    expect(observed.value.scripts.excluded.unsupported_location).toBe(2);
  } finally {
    await fake.close();
  }
});
