import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseBinaryTarget } from "../../../dist/application/BinaryTargetResolver.js";
import { ArtifactResourceScope } from "../../../dist/artifacts/ArtifactResourceScope.js";
import { inspectAppleDispatchMetadata } from "../../../dist/native/AppleDispatchMetadata.js";
import {
  artifactCliEvidence,
  artifactMcpCall,
  artifactMcpResult,
  withArtifactMcp,
} from "../../lib/artifact-e2e.mjs";
import { nativeDispatchMetadataResultSchema } from "../../../dist/domain/native/objcSwiftMetadata.js";
import { analysisErrorProjectionSchema } from "../../../dist/contracts/errorSchemas.js";
import { cliOperationFailurePayload } from "../../../dist/cliLogging.js";
import { requireMcpToolError } from "../../lib/mcp-verifier-results.mjs";

if (process.platform !== "darwin")
  throw new Error(
    "Apple dispatch verification requires macOS with a host Objective-C compiler and Foundation SDK",
  );
const exec = promisify(execFile);
const source = (name) =>
  fileURLToPath(
    new URL(`../../../tests/conformance/native/${name}`, import.meta.url),
  );

/** Both link modes: legacy LC_DYLD_INFO binds and the default chained fixups. */
const LINK_MODES = [
  {
    mode: "dyld-info",
    flags: ["-Wl,-no_fixup_chains"],
    fixups: "LC_DYLD_INFO rebase opcodes",
    swift: true,
  },
  { mode: "chained", flags: [], fixups: "chained fixups:", swift: true },
  // arm64e uses authenticated chained pointers (DYLD_CHAINED_PTR_ARM64E_*).
  ...(process.arch === "arm64"
    ? [
        {
          mode: "chained-arm64e",
          flags: ["-arch", "arm64e"],
          fixups: "chained fixups: DYLD_CHAINED_PTR_ARM64E",
          swift: false,
        },
      ]
    : []),
];

const fixupCoverage = (metadata) =>
  metadata.coverage.find(({ facet }) => facet === "pointer_fixups");

const inspect = async (path) => {
  const target = await parseBinaryTarget(path);
  if (!target.ok) throw target.error;
  const resources = new ArtifactResourceScope();
  try {
    return {
      target: target.value,
      metadata: (
        await resources.run(() =>
          inspectAppleDispatchMetadata(target.value, 5000, resources),
        )
      ).result,
    };
  } finally {
    // Retry any descriptor whose close failed, surfacing unresolved cleanup.
    await resources.close();
  }
};

const checkObjc = (metadata, mode) => {
  assert.equal(fixupCoverage(metadata)?.status, "complete");
  const fixture = metadata.objc_classes.find(
    ({ name, is_meta_class: meta }) => name === "ReaDispatchFixture" && !meta,
  );
  const category = metadata.objc_categories.find(
    ({ name }) => name === "ReaDispatchAdditions",
  );
  const objcCoverage = metadata.coverage.find(
    ({ facet }) => facet === "objc_class_method_ivar_metadata",
  );
  assert.equal(fixture?.is_meta_class, false);
  assert.equal(fixture?.is_root_class, false);
  assert.equal(
    fixture?.properties.find(({ name }) => name === "fixtureName")?.atomicity,
    "nonatomic",
  );
  assert.equal(
    fixture?.properties.find(({ name }) => name === "atomicValue")?.atomicity,
    "atomic",
  );
  for (const method of fixture.methods) {
    assert.equal(method.is_required, null);
    assert.equal(method.is_optional, null);
  }
  for (const property of fixture.properties)
    for (const attribute of property.attributes)
      assert.deepEqual(Object.keys(attribute).sort(), ["name", "value"]);
  const protocol = metadata.objc_protocols.find(
    ({ name }) => name === "ReaDispatchProtocol",
  );
  const protocolProperty = protocol?.properties.find(
    ({ name }) => name === "fixtureName",
  );
  assert.equal(protocolProperty?.name, "fixtureName");
  assert.equal(protocolProperty?.type_encoding, '@"NSString"');
  assert.equal(protocolProperty?.atomicity, "nonatomic");
  assert.equal(protocol?.methods[0]?.is_required, true);
  assert.equal(protocol?.methods[0]?.is_optional, false);
  assert.equal(protocol?.optional_methods[0]?.is_required, false);
  assert.equal(protocol?.optional_methods[0]?.is_optional, true);
  if (
    !metadata.objc_dispatch_implementations.some(
      (item) =>
        item.class_name === "ReaDispatchFixture" &&
        item.selector === "performAction:" &&
        item.implementation_address !== null,
    ) ||
    !metadata.objc_dispatch_implementations.some(
      (item) =>
        item.selector === "fixtureVersion" && item.method_type === "class",
    ) ||
    !metadata.objc_ivars.some(
      (item) => item.name === "state" && item.offset !== null,
    ) ||
    !metadata.objc_protocol_records.some(
      (protocol) =>
        protocol.name === "ReaDispatchProtocol" &&
        protocol.methods.some(
          (method) => method.selector === "performAction:",
        ) &&
        protocol.optional_methods.some(
          (method) => method.selector === "optionalFixtureValue",
        ),
    ) ||
    // The superclass lives in libobjc, so it comes from a bind fixup.
    fixture?.super_class !== "NSObject" ||
    fixture.decode.status !== "decoded" ||
    !fixture.properties.some(
      (property) =>
        property.name === "fixtureName" &&
        property.type_encoding === '@"NSString"' &&
        property.attributes.some(({ name }) => name === "C"),
    ) ||
    category?.class_name !== "NSString" ||
    category.class_source !== "external" ||
    !category.instance_methods.includes("reaFixtureLength") ||
    !metadata.objc_dispatch_implementations.some(
      (item) =>
        item.class_name === "NSString" &&
        item.category === "ReaDispatchAdditions" &&
        item.selector === "reaFixtureLength",
    ) ||
    objcCoverage?.status !== "complete" ||
    fixupCoverage(metadata)?.reason?.startsWith(mode.fixups) !== true ||
    (mode.mode === "dyld-info") !==
      (fixupCoverage(metadata)?.reason?.includes(
        "LC_DYLD_INFO bind opcodes",
      ) ===
        true)
  )
    throw new Error(
      `Apple metadata fixture drifted (${mode.mode}): ${JSON.stringify(metadata)}`,
    );
};

const checkSwift = (metadata, mode) => {
  assert.equal(fixupCoverage(metadata)?.status, "complete");
  for (const context of ["ReaNestedA", "ReaNestedB"]) {
    const type = `${context}.Implementation`;
    const protocol = `${context}.Requirement`;
    assert.ok(
      metadata.swift_conformances.some(
        (item) =>
          item.type_name === type &&
          item.protocol_name === protocol &&
          item.module === "ReaWitnessFixture" &&
          item.decode.status === "decoded",
      ),
      `Nested Swift conformance ${type}: ${protocol} missing (${mode.mode})`,
    );
    assert.ok(
      metadata.swift_dispatch_slots.some(
        (item) =>
          item.table_kind === "witness_table" &&
          item.owner === `${type}: ${protocol}` &&
          item.implementation_address !== null &&
          item.decode.status === "decoded",
      ),
      `Nested Swift witness ${type}: ${protocol} missing (${mode.mode})`,
    );
  }

  if (
    !metadata.swift_dispatch_slots.some(
      (slot) =>
        slot.table_kind === "class_vtable" &&
        slot.owner === "ReaVtableFixture" &&
        slot.decode.status === "decoded",
    )
  )
    throw new Error(
      `Swift class vtable fixture unavailable (${mode.mode}): ${JSON.stringify(metadata.coverage)}`,
    );
  if (
    !metadata.swift_conformances.some(
      (item) =>
        item.type_name === "ReaWitnessFixture" &&
        item.protocol_name === "ReaWitnessFixtureProtocol",
    ) ||
    !metadata.swift_dispatch_slots.some(
      (item) =>
        item.owner === "ReaWitnessFixture: ReaWitnessFixtureProtocol" &&
        item.implementation_address !== null,
    ) ||
    fixupCoverage(metadata)?.reason?.startsWith(mode.fixups) !== true ||
    (mode.mode === "dyld-info") !==
      (fixupCoverage(metadata)?.reason?.includes(
        "LC_DYLD_INFO bind opcodes",
      ) ===
        true)
  )
    throw new Error(
      `Swift metadata fixture drifted (${mode.mode}): ${JSON.stringify(metadata)}`,
    );
};

/** Declarations from dispatch.swift that survive stripping unchanged. */
const EXPECTED_SWIFT_DECLS = [
  ["struct", "ReaWitnessFixture", false],
  ["class", "ReaVtableFixture", false],
  ["enum", "ReaDeclFixtureEnum", false],
  ["struct", "ReaDeclFixtureOuter", false],
  ["struct", "ReaDeclFixtureOuter.Inner", false],
  ["struct", "ReaDeclFixtureGeneric", true],
  ["actor", "ReaDeclFixtureActor", false],
  ["enum", "ReaNestedA", false],
  ["struct", "ReaNestedA.Implementation", false],
  ["enum", "ReaNestedB", false],
  ["struct", "ReaNestedB.Implementation", false],
];

/** Stable declaration facts compared across the symbols and stripped builds. */
const swiftDeclarations = (metadata) =>
  metadata.swift_decls.map((item) => ({
    kind: item.kind,
    qualified_name: item.qualified_name,
    module: item.module,
    generic: item.generic,
    descriptor: item.location.address,
    accessor: item.accessor_address,
    status: item.decode.status,
  }));

const checkSwiftDeclarations = (metadata, mode) => {
  const declarations = swiftDeclarations(metadata);
  for (const [kind, qualifiedName, generic] of EXPECTED_SWIFT_DECLS)
    assert.ok(
      declarations.some(
        (item) =>
          item.kind === kind &&
          item.qualified_name === qualifiedName &&
          item.module === "ReaWitnessFixture" &&
          item.generic === generic &&
          item.accessor !== null &&
          item.status === "decoded",
      ),
      `Swift declaration ${qualifiedName} missing (${mode.mode}): ${JSON.stringify(declarations)}`,
    );
  assert.equal(
    metadata.coverage.find(({ facet }) => facet === "swift_declarations")
      ?.status,
    "complete",
  );
  return declarations;
};

/** Descriptor and accessor addresses must be the compiler's Mn/Ma symbols. */
const checkSwiftSymbolAddresses = async (path, declarations) => {
  const { stdout } = await exec("/usr/bin/nm", ["--defined-only", path]);
  const symbols = (suffix) =>
    new Set(
      stdout.split("\n").flatMap((line) => {
        const [address, , name] = line.trim().split(/\s+/u);
        return name?.endsWith(suffix) === true
          ? [`0x${BigInt(`0x${address}`).toString(16)}`]
          : [];
      }),
    );
  const descriptors = symbols("Mn");
  const accessors = symbols("Ma");
  for (const item of declarations) {
    assert.ok(descriptors.has(item.descriptor), JSON.stringify(item));
    assert.ok(accessors.has(item.accessor), JSON.stringify(item));
  }
};

const root = await mkdtemp(join(tmpdir(), "rea-dispatch-"));
let report;
try {
  const results = [];
  const commands = 4097;
  const commandTable = Buffer.alloc(32 + commands * 16);
  commandTable.writeUInt32LE(0xfeedfacf);
  commandTable.writeUInt32LE(0x0100000c, 4);
  commandTable.writeUInt32LE(2, 12);
  commandTable.writeUInt32LE(commands, 16);
  commandTable.writeUInt32LE(commands * 16, 20);
  for (let cursor = 32; cursor < commandTable.length; cursor += 16) {
    commandTable.writeUInt32LE(0x2a, cursor); // LC_SOURCE_VERSION
    commandTable.writeUInt32LE(16, cursor + 4);
  }
  const commandTablePath = join(root, "many-commands.macho");
  await writeFile(commandTablePath, commandTable);
  const cli = await artifactCliEvidence(
    "inspect-native-dispatch-metadata",
    commandTablePath,
    ["--max-input-bytes", String(commandTable.length)],
  );
  const cliResult = nativeDispatchMetadataResultSchema.parse(
    cli.normalized_result,
  );
  assert.deepEqual(cliResult.input_admission, {
    maximum_bytes: commandTable.length,
    source: "caller",
    retained_bytes: commandTable.length,
  });
  assert.equal(
    cliResult.result.target_selection.byte_length,
    commandTable.length,
  );
  assert.deepEqual(cliResult.result.objc_classes, []);
  await withArtifactMcp(commandTablePath, async (client) => {
    const mcpResult = nativeDispatchMetadataResultSchema.parse(
      await artifactMcpResult(client, "inspect_native_dispatch_metadata", {
        max_input_bytes: commandTable.length,
      }),
    );
    assert.deepEqual(mcpResult, cliResult);
  });
  results.push({
    variant: "many-load-commands",
    commands,
    target_sha256: cliResult.target_sha256,
  });
  for (const { section, size, reason } of [
    {
      section: "__objc_classlist",
      size: 12,
      reason: "Misaligned Objective-C class-list size",
    },
    {
      section: "__swift5_types",
      size: 6,
      reason: "Misaligned Swift type section",
    },
  ]) {
    const bytes = Buffer.alloc(4096);
    bytes.writeUInt32LE(0xfeedfacf);
    bytes.writeUInt32LE(0x0100000c, 4);
    bytes.writeUInt32LE(2, 12);
    bytes.writeUInt32LE(1, 16);
    bytes.writeUInt32LE(152, 20);
    bytes.writeUInt32LE(0x19, 32); // LC_SEGMENT_64
    bytes.writeUInt32LE(152, 36);
    bytes.write("__DATA", 40);
    bytes.writeBigUInt64LE(0x100000000n, 56);
    bytes.writeBigUInt64LE(4096n, 64);
    bytes.writeBigUInt64LE(4096n, 80);
    bytes.writeUInt32LE(7, 88);
    bytes.writeUInt32LE(5, 92);
    bytes.writeUInt32LE(1, 96);
    bytes.write(section, 104);
    bytes.write("__DATA", 120);
    bytes.writeBigUInt64LE(0x100000200n, 136);
    bytes.writeBigUInt64LE(BigInt(size), 144);
    bytes.writeUInt32LE(512, 152);
    const path = join(root, `malformed-${section}.macho`);
    await writeFile(path, bytes);
    const target = await parseBinaryTarget(path);
    assert.ok(
      target.ok,
      "Malformed section fixture must pass target admission",
    );
    let cliFailure;
    try {
      await artifactCliEvidence("inspect-native-dispatch-metadata", path);
      assert.fail("Malformed metadata unexpectedly succeeded");
    } catch (cause) {
      assert.equal(cause.code, 1);
      cliFailure = analysisErrorProjectionSchema.parse(
        cliOperationFailurePayload(JSON.parse(cause.stdout)),
      );
    }
    assert.equal(cliFailure.code, "unsupported_target");
    assert.equal(cliFailure.category, "unsupported_target");
    assert.deepEqual(cliFailure.details, {
      operation: "inspect_native_dispatch_metadata",
      path: target.value.path,
      reason,
    });
    await withArtifactMcp(path, async (client) => {
      const failure = requireMcpToolError(
        await artifactMcpCall(client, {
          name: "inspect_native_dispatch_metadata",
          arguments: {},
        }),
      );
      assert.equal(failure.code, cliFailure.code);
      assert.deepEqual(failure.details, cliFailure.details);
    });
    results.push({ variant: `malformed-${section}`, reason });
  }
  for (const mode of LINK_MODES) {
    const objcPath = join(root, `fixture-${mode.mode}`);
    await exec("/usr/bin/xcrun", [
      "clang",
      "-O2",
      "-framework",
      "Foundation",
      ...mode.flags,
      source("dispatch.m"),
      "-o",
      objcPath,
    ]);
    for (const variant of ["symbols", "stripped"]) {
      if (variant === "stripped")
        await exec("/usr/bin/strip", ["-x", objcPath]);
      const { target, metadata } = await inspect(objcPath);
      checkObjc(metadata, mode);
      if (mode.mode === "chained" && variant === "stripped") {
        const cli = await artifactCliEvidence(
          "inspect-native-dispatch-metadata",
          objcPath,
        );
        const cliResult = nativeDispatchMetadataResultSchema.parse(
          cli.normalized_result,
        );
        assert.equal(cliResult.target_sha256, target.sha256);
        checkObjc(cliResult.result, mode);
        await withArtifactMcp(objcPath, async (client) => {
          const mcpResult = nativeDispatchMetadataResultSchema.parse(
            await artifactMcpResult(client, "inspect_native_dispatch_metadata"),
          );
          assert.equal(mcpResult.target_sha256, target.sha256);
          checkObjc(mcpResult.result, mode);
          assert.deepEqual(mcpResult.result, cliResult.result);
        });
      }
      results.push({
        variant: `objc-${mode.mode}-${variant}`,
        target_sha256: target.sha256,
        classes: metadata.objc_classes.length,
        categories: metadata.objc_categories.length,
        implementations: metadata.objc_dispatch_implementations.length,
        fixups: fixupCoverage(metadata)?.reason,
      });
    }
    if (!mode.swift) continue;
    const swiftPath = join(root, `libReaWitnessFixture-${mode.mode}.dylib`);
    await exec("/usr/bin/xcrun", [
      "swiftc",
      "-emit-library",
      "-module-name",
      "ReaWitnessFixture",
      "-O",
      ...mode.flags
        .map((flag) => flag.replace(/^-Wl,/u, "-Xlinker\0"))
        .flatMap((flag) => flag.split("\0")),
      source("dispatch.swift"),
      "-o",
      swiftPath,
    ]);
    let unstrippedDeclarations;
    for (const variant of ["symbols", "stripped"]) {
      if (variant === "stripped")
        await exec("/usr/bin/strip", ["-x", swiftPath]);
      const { target, metadata } = await inspect(swiftPath);
      checkSwift(metadata, mode);
      const declarations = checkSwiftDeclarations(metadata, mode);
      if (variant === "symbols") {
        await checkSwiftSymbolAddresses(swiftPath, declarations);
        unstrippedDeclarations = declarations;
      } else assert.deepEqual(declarations, unstrippedDeclarations);
      if (mode.mode === "chained" && variant === "stripped") {
        const cli = await artifactCliEvidence(
          "inspect-native-dispatch-metadata",
          swiftPath,
        );
        const cliResult = nativeDispatchMetadataResultSchema.parse(
          cli.normalized_result,
        );
        assert.equal(cliResult.target_sha256, target.sha256);
        checkSwift(cliResult.result, mode);
        await withArtifactMcp(swiftPath, async (client) => {
          const mcpResult = nativeDispatchMetadataResultSchema.parse(
            await artifactMcpResult(client, "inspect_native_dispatch_metadata"),
          );
          assert.equal(mcpResult.target_sha256, target.sha256);
          checkSwift(mcpResult.result, mode);
          assert.deepEqual(mcpResult.result, cliResult.result);
        });
      }

      results.push({
        variant: `swift-${mode.mode}-${variant}`,
        target_sha256: target.sha256,
        declarations: declarations.length,
        conformances: metadata.swift_conformances.length,
        slots: metadata.swift_dispatch_slots.length,
        fixups: fixupCoverage(metadata)?.reason,
      });
    }
  }
  report = { ok: true, target_executed: false, fixtures: results };
} finally {
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(report)}\n`);
