import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { toolContract } from "../../../dist/contracts/toolContracts.js";
import {
  artifactCliEvidence,
  artifactMcpCall,
  withArtifactMcp,
  withBundleResourcesMcp,
} from "../../lib/artifact-e2e.mjs";

const exec = promisify(execFile);

// dyld_info abbreviates a terminal .dylib suffix; padding is part of the name.
const INSTALL_NAME_CASES = [
  { installName: "leading.dylib", importSource: "leading" },
  { installName: "  leading.dylib  ", importSource: "  leading.dylib  " },
];

/** Inspect the compiled bundle with real native utilities through both adapters. */
export async function verifyNativeProvenance(app, executable) {
  const original = await readFile(executable);
  const sha256 = createHash("sha256").update(original).digest("hex");
  const symbols = ["_", "$s4main3FooV", "_", "plain_symbol", "__"];
  const operations = [
    ["inspect_macho", []],
    ["inspect_signature", []],
    ["list_architectures", []],
    ["demangle_swift", symbols],
  ];
  const observations = [];
  const resourcePlistCli = toolContract("inspect_plist").outputSchema.parse(
    await artifactCliEvidence("inspect-plist", app),
  );
  assert.equal(resourcePlistCli.subject, null);
  assert.equal(resourcePlistCli.raw_result, null);
  await withBundleResourcesMcp(app, async (client) => {
    const response = await artifactMcpCall(client, {
      name: "inspect_plist",
      arguments: {},
    });
    assert.notEqual(response.isError, true, JSON.stringify(response));
    const mcp = toolContract("inspect_plist").outputSchema.parse(
      response.structuredContent,
    );
    assert.equal(mcp.subject, null);
    assert.equal(mcp.raw_result, null);
    assert.deepEqual(mcp.normalized_result, resourcePlistCli.normalized_result);
    assert.deepEqual(
      JSON.parse(response.content.find((item) => item.type === "text").text),
      response.structuredContent,
    );
    await client.ping();
    observations.push({
      operation: "inspect_plist_resource_root",
      commands: resourcePlistCli.normalized_result.provenance.length,
      cli_bytes: Buffer.byteLength(JSON.stringify(resourcePlistCli)),
      mcp_bytes: Buffer.byteLength(JSON.stringify(response)),
    });
  });

  const binaryPlistCli = toolContract("inspect_plist").outputSchema.parse(
    await artifactCliEvidence("inspect-plist", executable),
  );
  assert.equal(binaryPlistCli.subject?.digest.sha256, sha256);
  assert.equal(binaryPlistCli.raw_result, null);
  assert.equal(binaryPlistCli.normalized_result.resource_root, undefined);
  await withArtifactMcp(app, async (client) => {
    const plistResponse = await artifactMcpCall(client, {
      name: "inspect_plist",
      arguments: {},
    });
    assert.notEqual(plistResponse.isError, true, JSON.stringify(plistResponse));
    const binaryPlistMcp = toolContract("inspect_plist").outputSchema.parse(
      plistResponse.structuredContent,
    );
    assert.equal(binaryPlistMcp.subject?.digest.sha256, sha256);
    assert.equal(binaryPlistMcp.raw_result, null);
    assert.equal(binaryPlistMcp.normalized_result.resource_root, undefined);
    assert.deepEqual(
      binaryPlistMcp.normalized_result,
      binaryPlistCli.normalized_result,
    );
    assert.deepEqual(
      JSON.parse(
        plistResponse.content.find((item) => item.type === "text").text,
      ),
      plistResponse.structuredContent,
    );
    await client.ping();
    observations.push({
      operation: "inspect_plist_binary_bound",
      commands: binaryPlistCli.normalized_result.provenance.length,
      cli_bytes: Buffer.byteLength(JSON.stringify(binaryPlistCli)),
      mcp_bytes: Buffer.byteLength(JSON.stringify(plistResponse)),
    });

    for (const [operation, arguments_] of operations) {
      const cli = toolContract(operation).outputSchema.parse(
        await artifactCliEvidence(
          operation.replaceAll("_", "-"),
          app,
          arguments_,
        ),
      );
      const response = await artifactMcpCall(client, {
        name: operation,
        arguments: operation === "demangle_swift" ? { symbols } : {},
      });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      const mcp = toolContract(operation).outputSchema.parse(
        response.structuredContent,
      );
      assert.equal(cli.raw_result, null);
      assert.equal(mcp.raw_result, null);
      assert.ok(cli.normalized_result.provenance.length > 0);
      assert.deepEqual(mcp.normalized_result, cli.normalized_result);
      if (operation === "demangle_swift")
        assert.deepEqual(cli.normalized_result.symbols, [
          { input: "_", output: "", status: "invalid" },
          { input: "$s4main3FooV", output: "main.Foo", status: "demangled" },
          { input: "_", output: "", status: "invalid" },
          {
            input: "plain_symbol",
            output: "plain_symbol",
            status: "unchanged",
          },
          { input: "__", output: "_", status: "unchanged" },
        ]);

      if (operation === "inspect_macho") {
        const encryption = cli.normalized_result.encryption;
        assert.equal(encryption.exhaustive, true);
        assert.ok(encryption.total > 0);
        assert.equal(encryption.items.length, encryption.total);
        for (const slice of encryption.items) {
          assert.equal(slice.status, "absent");
          assert.deepEqual(slice.commands, []);
          assert.equal(slice.range, null);
        }
        const delayed = cli.normalized_result.load_commands.items.find(
          ({ fields }) => fields.name === "@rpath/libdelay.dylib (offset 28)",
        );
        assert.equal(delayed?.kind, "LC_LOAD_DYLIB");
        assert.equal(delayed.fields.options, 8); // DYLIB_USE_DELAYED_INIT
        assert.equal(delayed.fields["time stamp"], undefined);
        assert.ok(
          cli.normalized_result.dependencies.items.some(
            ({ path }) => path === "@rpath/libdelay.dylib",
          ),
        );
      }
      assert.deepEqual(
        JSON.parse(response.content.find((item) => item.type === "text").text),
        response.structuredContent,
      );
      await client.ping();
      observations.push({
        operation,
        commands: cli.normalized_result.provenance.length,
        cli_bytes: Buffer.byteLength(JSON.stringify(cli)),
        mcp_bytes: Buffer.byteLength(JSON.stringify(response)),
      });
    }
  });
  assert.deepEqual(await readFile(executable), original);
  return {
    real_native_utilities: true,
    target_sha256: sha256,
    bytes_unchanged: true,
    observations,
    install_names: await verifyInstallNames(),
  };
}

/** Compile independent inputs; their unusual loader paths are never executed. */
async function verifyInstallNames() {
  const root = await mkdtemp(join(tmpdir(), "rea-macho-install-names-"));
  const observations = [];
  try {
    const librarySource = join(root, "library.c");
    const consumerSource = join(root, "consumer.c");
    await writeFile(librarySource, "int exported_value(void) { return 42; }\n");
    await writeFile(
      consumerSource,
      "extern int exported_value(void); int main(void) { return exported_value(); }\n",
    );
    for (const [
      index,
      { installName, importSource },
    ] of INSTALL_NAME_CASES.entries()) {
      const library = join(root, `library-${index}.dylib`);
      const consumer = join(root, `consumer-${index}`);
      const rpath = "  @loader_path/Frameworks  ";
      await exec("/usr/bin/xcrun", [
        "clang",
        "-dynamiclib",
        librarySource,
        `-Wl,-install_name,${installName}`,
        "-o",
        library,
      ]);
      await exec("/usr/bin/xcrun", [
        "clang",
        consumerSource,
        library,
        `-Wl,-rpath,${rpath}`,
        "-o",
        consumer,
      ]);
      const original = await readFile(consumer);
      const originalLibrary = await readFile(library);
      const { stdout } = await exec("/usr/bin/xcrun", [
        "otool",
        "-l",
        consumer,
      ]);
      const lines = stdout.split("\n").map((line) => line.trimStart());
      const nameRow = lines.find((line) =>
        line.startsWith(`name ${installName} (offset `),
      );
      const pathRow = lines.find((line) =>
        line.startsWith(`path ${rpath} (offset `),
      );
      assert.ok(nameRow, "linker did not retain the selected install name");
      assert.ok(pathRow, "linker did not retain the selected rpath");
      const cli = toolContract("inspect_macho").outputSchema.parse(
        await artifactCliEvidence("inspect-macho", consumer),
      );
      const result = cli.normalized_result;
      assert.equal(cli.raw_result, null);
      assert.ok(
        result.dependencies.items.some(({ path }) => path === installName),
      );
      assert.ok(
        result.load_commands.items.some(
          ({ kind, fields }) =>
            kind === "LC_LOAD_DYLIB" &&
            fields.name === nameRow.slice("name ".length),
        ),
      );
      assert.ok(
        result.load_commands.items.some(
          ({ kind, fields }) =>
            kind === "LC_RPATH" &&
            fields.path === pathRow.slice("path ".length),
        ),
      );
      assert.equal(
        result.imports.items.find(({ name }) => name === "_exported_value")
          ?.source,
        importSource,
      );
      assert.ok(result.provenance.some(({ tool }) => tool === "dyld_info"));
      await withArtifactMcp(consumer, async (client) => {
        const response = await artifactMcpCall(client, {
          name: "inspect_macho",
          arguments: {},
        });
        assert.notEqual(response.isError, true, JSON.stringify(response));
        const mcp = toolContract("inspect_macho").outputSchema.parse(
          response.structuredContent,
        );
        assert.deepEqual(mcp.normalized_result, result);
      });
      assert.deepEqual(await readFile(consumer), original);
      assert.deepEqual(await readFile(library), originalLibrary);
      observations.push({
        install_name: installName,
        rpath,
        target_sha256: createHash("sha256").update(original).digest("hex"),
        bytes_unchanged: true,
        cli_mcp_parity: true,
      });
    }
    return observations;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
