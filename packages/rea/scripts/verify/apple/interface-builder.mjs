#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  artifactCli,
  artifactCliEvidence,
  artifactMcpResult,
  withArtifactMcp,
  withBundleResourcesMcp,
} from "../../lib/artifact-e2e.mjs";

const exec = promisify(execFile);
const fixtureRoot = await mkdtemp(join(tmpdir(), "rea-interface-builder-"));
const appPath = join(fixtureRoot, "Fixture.app");
const resourcesPath = join(appPath, "Contents", "Resources");
const executablePath = join(appPath, "Contents", "MacOS", "Fixture");
const nibPath = join(resourcesPath, "Main.nib");
const sourceRoot = fileURLToPath(
  new URL("../../../tests/conformance/interface-builder/", import.meta.url),
);
const mainSource = join(sourceRoot, "Main.xib");
// ibtool property names mapped to the keys AppKit archives for NSControl.
const buttonBooleanKeys = {
  continuous: "NSControlContinuous",
  refusesFirstResponder: "NSControlRefusesFirstResponder",
};
const plistDocument = (body) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">${body}</plist>\n`;
const compileNib = (source) =>
  exec("xcrun", [
    "ibtool",
    "--errors",
    "--warnings",
    "--compile",
    nibPath,
    source,
  ]);
/** Apple's source-level property values: the oracle for compiled booleans. */
const exportedButtonBooleans = async (source) => {
  const exported = join(fixtureRoot, "export.plist");
  const { stdout } = await exec("xcrun", [
    "ibtool",
    "--export",
    join(fixtureRoot, "export-request.plist"),
    source,
  ]);
  await writeFile(exported, stdout);
  const { stdout: json } = await exec("plutil", [
    "-convert",
    "json",
    "-o",
    "-",
    exported,
  ]);
  return JSON.parse(json)["com.apple.ibtool.document.export"].button;
};
const decodedButtonBooleans = (result) => {
  const button = result.graph.nodes.find(
    (node) => node.kind === "control" && node.name === "NSButton",
  );
  assert.ok(button, "compiled button control was not decoded");
  return Object.fromEntries(
    Object.entries(buttonBooleanKeys).map(([property, key]) => [
      property,
      button.attributes.nibValues?.[key],
    ]),
  );
};

let report;
try {
  await mkdir(join(appPath, "Contents", "MacOS"), { recursive: true });
  await mkdir(resourcesPath, { recursive: true });
  await writeFile(
    join(appPath, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Fixture</string><key>CFBundleIdentifier</key><string>dev.rea.interface-builder-fixture</string></dict></plist>\n`,
  );
  await compileNib(mainSource);
  await exec("cc", [join(sourceRoot, "fixture.c"), "-o", executablePath]);

  const evidence = await artifactCliEvidence(
    "decode-interface-builder",
    appPath,
  );
  const decoded = evidence.normalized_result;
  const executableSha256 = createHash("sha256")
    .update(await readFile(executablePath))
    .digest("hex");
  await withBundleResourcesMcp(appPath, async (client) => {
    const mcp = await artifactMcpResult(client, "decode_interface_builder");
    assert.deepEqual(
      mcp,
      decoded,
      "CLI and MCP compiled archive results differ",
    );
  });
  const { resource_root, target_sha256, ...resourcePayload } = decoded;
  assert.equal(resource_root.executable_sha256, null);
  assert.equal(target_sha256, null);
  await withArtifactMcp(appPath, async (client) => {
    const binary = await artifactMcpResult(client, "decode_interface_builder");
    assert.equal(binary.target_sha256, executableSha256);
    assert.equal(binary.graph.target_sha256, executableSha256);
    assert.deepEqual(binary, {
      ...resourcePayload,
      target_sha256: executableSha256,
      graph: { ...decoded.graph, target_sha256: executableSha256 },
    });
  });
  assert.equal(decoded.documents.length, 1);
  assert.equal(
    decoded.documents[0]?.relative_path,
    "Contents/Resources/Main.nib",
  );
  assert.equal(decoded.documents[0]?.document_kind, "nib");
  assert.equal(decoded.documents[0]?.hierarchy_complete, true);
  assert.ok(decoded.documents[0]?.object_count > 0);
  assert.ok(decoded.documents[0]?.connection_count >= 2);

  const button = decoded.graph.nodes.find(
    (node) => node.kind === "control" && node.name === "NSButton",
  );
  const action = decoded.graph.nodes.find(
    (node) => node.kind === "action" && node.name === "runAction:",
  );
  assert.ok(button, "compiled button control was not decoded");
  assert.ok(action, "compiled action selector was not decoded");
  assert.ok(
    decoded.graph.edges.some(
      (edge) =>
        edge.relation === "target_action" &&
        edge.resolution === "observed" &&
        (edge.from === action.id || edge.to === action.id),
    ),
    "compiled target/action connection was not represented as observed",
  );
  assert.ok(
    decoded.graph.coverage.some(
      (facet) =>
        facet.facet === "archive_decode" && facet.status === "complete",
    ),
  );
  assert.equal(decoded.graph.truncated, false);

  // Compiled booleans must keep their source polarity in both directions.
  const properties = Object.keys(buttonBooleanKeys);
  await writeFile(
    join(fixtureRoot, "export-request.plist"),
    plistDocument(
      `<dict><key>NSControl</key><array>${properties.map((property) => `<string>${property}</string>`).join("")}</array></dict>`,
    ),
  );
  await writeFile(
    join(fixtureRoot, "toggle.plist"),
    plistDocument(
      `<dict><key>button</key><dict>${properties.map((property) => `<key>${property}</key><true/>`).join("")}</dict></dict>`,
    ),
  );
  const toggledSource = join(fixtureRoot, "Toggled.xib");
  await exec("xcrun", [
    "ibtool",
    "--import",
    join(fixtureRoot, "toggle.plist"),
    "--write",
    toggledSource,
    mainSource,
  ]);
  const mainBooleans = await exportedButtonBooleans(mainSource);
  const toggledBooleans = await exportedButtonBooleans(toggledSource);
  assert.deepEqual(mainBooleans, {
    continuous: false,
    refusesFirstResponder: false,
  });
  assert.deepEqual(toggledBooleans, {
    continuous: true,
    refusesFirstResponder: true,
  });
  assert.deepEqual(
    decodedButtonBooleans(decoded),
    mainBooleans,
    "compiled false booleans differ from the source export",
  );
  await compileNib(toggledSource);
  assert.deepEqual(
    decodedButtonBooleans(
      await artifactCli("decode-interface-builder", appPath),
    ),
    toggledBooleans,
    "compiled true booleans differ from the source export",
  );

  report = {
    ok: true,
    fixture: "compiled-appkit-nib",
    provider: evidence.provider,
    public_cli: true,
    public_stdio_mcp: true,
    target_sha256: decoded.target_sha256,
    archive_sha256: decoded.documents[0].archive_sha256,
    objects: decoded.documents[0].object_count,
    connections: decoded.documents[0].connection_count,
    recovered_control: button.name,
    recovered_action: action.name,
    button_booleans: { main: mainBooleans, toggled: toggledBooleans },
    hierarchy_complete: decoded.documents[0].hierarchy_complete,
    truncated: decoded.graph.truncated,
  };
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report)}\n`);
