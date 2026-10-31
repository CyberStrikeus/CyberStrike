import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { expect, it } from "vitest";

import { GHIDRA_BRIDGE_SOURCES } from "../../../src/ghidra/GhidraBridgeSources.js";

const execFileAsync = promisify(execFile);
const listingUrl = pathToFileURL(
  resolve("scripts/lib/verify-package-listing.mjs"),
).href;
const bridgeUrl = pathToFileURL(
  resolve("scripts/verify-packed-bridge.mjs"),
).href;
const bridge = "package/bridge/hopper_bridge.py";
const members = [
  bridge,
  "package/bridge/cutter/rea_bridge.py",
  ...Object.values(GHIDRA_BRIDGE_SOURCES).map(
    (name) => `package/bridge/ghidra/${name}`,
  ),
];

async function verifyListing(listing: string) {
  const { stdout } = await execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { parseTarListing } from ${JSON.stringify(listingUrl)};
import { verifyPackedBridge } from ${JSON.stringify(bridgeUrl)};
let bridgeParsed = false;
const commands = { exec: async (command) => {
  if (command !== "python3") throw new Error("Unexpected command: " + command);
  bridgeParsed = true;
  return { stdout: "", stderr: "" };
} };
try {
  await verifyPackedBridge({ tarball: "fixture.tgz", packedFiles: parseTarListing(${JSON.stringify(listing)}), commands });
  process.stdout.write(JSON.stringify({ bridgeParsed }));
} catch (cause) {
  process.stdout.write(JSON.stringify({ error: cause.message, bridgeParsed }));
}`,
  ]);
  return JSON.parse(stdout);
}

it("preserves a literal trailing CR in an LF-listed member", async () => {
  const listing =
    members.map((path) => (path === bridge ? `${path}\r` : path)).join("\n") +
    "\n";
  expect(await verifyListing(listing)).toEqual({
    error: `package omitted ${bridge}`,
    bridgeParsed: false,
  });
});

it.each(["\r\n", "\n"])(
  "accepts exact bridge identities with %j line endings",
  async (ending) => {
    expect(await verifyListing(members.join(ending) + ending)).toEqual({
      bridgeParsed: true,
    });
  },
);

it.each(["package/bridge/stale.pyc", "package/bridge/__pycache__/stale"])(
  "rejects generated Python assets before parsing a bridge: %s",
  async (generated) => {
    expect(
      await verifyListing([...members, generated].join("\r\n") + "\r\n"),
    ).toEqual({
      error: "package contained generated Python bytecode",
      bridgeParsed: false,
    });
  },
);
