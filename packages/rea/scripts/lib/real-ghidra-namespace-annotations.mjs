import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inspectVerifierGhidraInstallation } from "./ghidra-installation-inspection.mjs";

/** Exercise qualified annotation names against real demangled C++ ABI symbols. */
export async function verifyGhidraNamespaceAnnotations({
  call,
  evidence,
  reject,
  target,
  entrypoint,
  env,
}) {
  await requireNamespaceDemangler(env);
  const exec = promisify(execFile);
  const compiler = process.env.REA_CC ?? "cc";
  try {
    await exec(compiler, ["--version"], { env, timeout: 30000 });
  } catch (cause) {
    throw new Error(
      `Ghidra namespace annotation verification requires a working host C compiler '${compiler}'.`,
      { cause },
    );
  }
  const workspace = await mkdtemp(join(tmpdir(), "rea-ghidra-namespaces-"));
  const source = fileURLToPath(
    new URL("../../tests/conformance/ghidra/namespaces.c", import.meta.url),
  );
  const path = join(workspace, "namespaces");
  try {
    await exec(compiler, ["-O0", "-fno-inline", source, "-o", path], {
      env,
      timeout: 30000,
    });
    const bytes = await readFile(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await call("close_binary");
    await call("open_binary", { path, provider_id: "ghidra" });
    const procedures = await call("list_procedures");
    const namespaces = ["alpha", "beta", "outer::inner"];
    const entries = namespaces.map((namespace) => {
      const procedure = procedures.find(
        ({ value }) => value === `${namespace}::same`,
      );
      assert.ok(
        procedure,
        `Missing demangled fixture function ${namespace}::same`,
      );
      return { namespace, address: procedure.address };
    });
    const names = await call("list_names");
    const globals = ["alpha", "outer::inner"].map((namespace) => {
      const symbol = names.find(
        (item) => item.value === `${namespace}::value` && item.symbol.primary,
      );
      assert.ok(symbol, `Missing demangled fixture global ${namespace}::value`);
      return { namespace, address: symbol.address };
    });
    await verifyDuplicateAddressNames(call, evidence, procedures, names);
    const ambiguous = await reject("procedure_address", { procedure: "same" });
    assert.equal(ambiguous.code, "invalid_request");
    for (const { address } of entries)
      assert.ok(JSON.stringify(ambiguous.details.issues).includes(address));
    for (const { namespace, address } of entries) {
      const leaf = await call("annotate_native_function", {
        procedure: address,
        name: "renamed",
        comment: "Preserve this comment",
        inline_comment: "Preserve this inline comment",
      });
      assert.equal(leaf.annotations.name, `${namespace}::renamed`);
      const qualified = await call("annotate_native_function", {
        procedure: address,
        name: `${namespace}::qualified`,
      });
      assert.equal(qualified.annotations.name, `${namespace}::qualified`);
      for (let repeat = 0; repeat < 2; repeat++) {
        const replay = await call("annotate_native_function", {
          procedure: qualified.annotations.name,
          name: qualified.annotations.name,
        });
        assert.deepEqual(replay.annotations, qualified.annotations);
        assert.equal(replay.dossier.procedure.address, address);
      }
      assert.equal(
        await call("procedure_address", {
          procedure: qualified.annotations.name,
        }),
        address,
      );
      for (const name of [
        "other::literal",
        `${namespace}::child::literal`,
        "0xnothex",
        "address%GG:0x1",
        "address:0xnothex",
      ]) {
        const literal = await call("annotate_native_function", {
          procedure: address,
          name,
        });
        const expected = name.startsWith(`${namespace}::`)
          ? name
          : `${namespace}::${name}`;
        assert.equal(literal.annotations.name, expected);
        const repeated = await call("annotate_native_function", {
          procedure: expected,
          name: expected,
        });
        assert.deepEqual(repeated.annotations, literal.annotations);
      }
      await call("annotate_native_function", {
        procedure: address,
        name: qualified.annotations.name,
      });
      const failure = await reject("annotate_native_function", {
        procedure: address,
        name: `${namespace}::`,
        comment: "MUST NOT REPLACE",
        inline_comment: "MUST NOT REPLACE",
      });
      assert.equal(failure.code, "invalid_request");
      assert.deepEqual(failure.details.issues[0].path, ["name"]);
      assert.match(failure.details.issues[0].message, /empty leaf/u);
      const unchanged = await call("annotate_native_function", {
        procedure: address,
        name: qualified.annotations.name,
      });
      assert.deepEqual(unchanged.annotations, qualified.annotations);
    }
    await verifyAddressNames(call, [entries[0], entries[2]], "function");
    await verifyAddressNames(call, globals, "label");
    // Equal leaf names in different namespaces are distinct destinations.
    const shared = "rea_namespace_shared";
    assert.deepEqual(
      await call("set_addresses_names", {
        names: Object.fromEntries(
          entries.map(({ address }) => [address, shared]),
        ),
      }),
      Object.fromEntries(entries.map(({ address }) => [address, true])),
    );
    for (const { namespace, address } of entries)
      assert.equal(
        await call("address_name", { address }),
        `${namespace}::${shared}`,
      );
    for (const { namespace, address } of entries) {
      assert.equal(
        await call("set_address_name", {
          address,
          name: `${namespace}::qualified`,
        }),
        true,
      );
    }
    const { stdout } = await exec(
      process.execPath,
      [
        entrypoint,
        "annotate-native-function",
        path,
        "alpha::same",
        "--name",
        "alpha::cli_renamed",
        "--provider",
        "ghidra",
        "--json",
      ],
      { env, timeout: 240000, maxBuffer: 72 * 1024 * 1024 },
    );
    assert.equal(
      JSON.parse(stdout).normalized_result.annotations.name,
      "alpha::cli_renamed",
    );
    assert.equal(
      (
        await call("analyze_function", {
          procedure: entries[0].address,
          detail: "complete",
        })
      ).procedure.name,
      "alpha::qualified",
      "The independent CLI session must not alter the active MCP database",
    );
    assert.deepEqual(await readFile(path), bytes);
    assert.equal((await call("binary_session")).sha256, sha256);
    await call("close_binary");
    await call("open_binary", { path: target.path, provider_id: "ghidra" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function verifyDuplicateAddressNames(call, evidence, procedures, names) {
  const functionEntries = [
    "rea_duplicate_function_a",
    "rea_duplicate_function_b",
  ].map((name) => {
    const procedure = procedures.find(
      ({ value }) => value === name || value === `_${name}`,
    );
    assert.ok(procedure, `Missing duplicate-name fixture function ${name}`);
    return { address: procedure.address, original: procedure.value };
  });
  const labelEntries = ["rea_duplicate_label_a", "rea_duplicate_label_b"].map(
    (name) => {
      const symbol = names.find(
        (item) =>
          (item.value === name || item.value === `_${name}`) &&
          item.symbol.primary,
      );
      assert.ok(symbol, `Missing duplicate-name fixture label ${name}`);
      return { address: symbol.address, original: symbol.value };
    },
  );

  for (const [kind, entries] of [
    ["function", functionEntries],
    ["label", labelEntries],
  ]) {
    const [owner, duplicate] = entries;
    const name = `rea_duplicate_${kind}`;
    assert.equal(
      await call("set_address_name", { address: owner.address, name }),
      true,
    );
    assert.equal(
      await call("set_address_name", { address: owner.address, name }),
      true,
      "Renaming the current owner to its existing name remains idempotent",
    );
    assert.equal(
      await call("set_address_name", { address: duplicate.address, name }),
      false,
    );
    assert.equal(
      await call("address_name", { address: duplicate.address }),
      duplicate.original,
      "A rejected duplicate leaves the other address unchanged",
    );

    const readback = async (ownerName, message) => {
      assert.equal(
        await call("address_name", { address: owner.address }),
        ownerName,
        message,
      );
      assert.equal(
        await call("address_name", { address: duplicate.address }),
        duplicate.original,
        message,
      );
    };
    // Object member order is not an ordering choice: each batch is decided
    // from the names held before it, so both orders must agree.
    const batchName = `rea_batch_duplicate_${kind}`;
    const moved = `${name}_moved`;
    const competing = "duplicate_requested_name";
    const selected = "name_held_by_selected_address";
    for (const [requested, expected, ownerName, reasons, message] of [
      [
        { [owner.address]: batchName, [duplicate.address]: batchName },
        { [owner.address]: false, [duplicate.address]: false },
        name,
        { [owner.address]: competing, [duplicate.address]: competing },
        "Competing requests for one name apply neither address",
      ],
      [
        { [owner.address]: duplicate.original, [duplicate.address]: name },
        { [owner.address]: false, [duplicate.address]: false },
        name,
        { [owner.address]: selected, [duplicate.address]: selected },
        "A swap between selected addresses is not ordered implicitly",
      ],
      [
        { [duplicate.address]: name, [owner.address]: moved },
        { [owner.address]: true, [duplicate.address]: false },
        moved,
        { [duplicate.address]: selected },
        "A name held by another selected address is not taken by member order",
      ],
      [
        { [duplicate.address]: name },
        { [duplicate.address]: false },
        name,
        { [duplicate.address]: "name_held_by_unselected_address" },
        "A name held by an unselected address is not moved",
      ],
    ]) {
      const facts = [];
      for (const ordered of [
        requested,
        Object.fromEntries(Object.entries(requested).reverse()),
      ]) {
        const record = await evidence("set_addresses_names", {
          names: ordered,
        });
        assert.deepEqual(record.normalized_result, expected, message);
        const { failures, conflicts } = record.raw_result;
        assert.deepEqual(
          Object.fromEntries(
            Object.entries(failures).map(([key, { reason }]) => [key, reason]),
          ),
          reasons,
          message,
        );
        // Each contested global name is reported once and names its requester.
        for (const [key, failure] of Object.entries(failures)) {
          const conflict = conflicts[failure.conflict];
          assert.equal(conflict.namespace, null, message);
          assert.equal(conflict.name, requested[key], message);
          assert.ok(conflict.requested_by.includes(failure.address), message);
        }
        assert.equal(
          conflicts.length,
          new Set(Object.keys(failures).map((key) => requested[key])).size,
          message,
        );
        facts.push(record.raw_result);
        await readback(ownerName, message);
        if (ownerName !== name)
          assert.equal(
            await call("set_address_name", { address: owner.address, name }),
            true,
          );
      }
      assert.deepEqual(facts[1], facts[0], message);
    }
    assert.deepEqual(
      (await call("list_names")).filter((item) => item.value === batchName),
      [],
      "A rejected competing name has no owner",
    );
    // An explicit later call may take a name released by an earlier one.
    assert.equal(
      await call("set_address_name", { address: owner.address, name: moved }),
      true,
    );
    assert.equal(
      await call("set_address_name", { address: duplicate.address, name }),
      true,
    );
    // Ghidra symbol names are case-sensitive, so case variants do not compete.
    const cased = {
      [owner.address]: `${batchName}_Case`,
      [duplicate.address]: `${batchName}_case`,
    };
    assert.deepEqual(await call("set_addresses_names", { names: cased }), {
      [owner.address]: true,
      [duplicate.address]: true,
    });
    for (const [address, expected] of Object.entries(cased))
      assert.equal(await call("address_name", { address }), expected);
  }
}

async function verifyAddressNames(call, symbols, kind) {
  for (const { namespace, address } of symbols) {
    assert.equal(
      await call("set_address_name", {
        address,
        name: `address_renamed_${kind}`,
      }),
      true,
    );
    const qualified = `${namespace}::address_qualified_${kind}`;
    assert.equal(
      await call("set_address_name", { address, name: qualified }),
      true,
    );
    assert.equal(await call("address_name", { address }), qualified);
    assert.equal(
      await call("set_address_name", {
        address,
        name: `other::literal_${kind}`,
      }),
      true,
    );
    const literal = await call("address_name", { address });
    assert.equal(literal, `${namespace}::other::literal_${kind}`);
    assert.equal(
      await call("set_address_name", { address, name: literal }),
      true,
    );
    assert.equal(await call("address_name", { address }), literal);
    assert.equal(
      await call("set_address_name", { address, name: qualified }),
      true,
    );
    for (let repeat = 0; repeat < 2; repeat++) {
      const readback = await call("address_name", { address });
      assert.deepEqual(
        await call("set_addresses_names", { names: { [address]: readback } }),
        { [address]: true },
      );
      assert.equal(await call("address_name", { address }), qualified);
    }
    assert.equal(
      await call("set_address_name", { address, name: `${namespace}::` }),
      false,
    );
    const session = await call("binary_session");
    for (const operation of [
      "set_address_name",
      "set_addresses_names",
      "address_name",
      "list_names",
    ])
      assert.equal(
        session.capabilities.find((item) => item.operation === operation)
          ?.available,
        true,
        `An invalid name must not mark ${operation} unavailable`,
      );
    assert.equal(await call("address_name", { address }), qualified);
  }
  const [valid, invalid] = symbols;
  assert.deepEqual(
    await call("set_addresses_names", {
      names: {
        [valid.address]: `${valid.namespace}::batch_renamed_${kind}`,
        [invalid.address]: `${invalid.namespace}::`,
      },
    }),
    { [valid.address]: true, [invalid.address]: false },
  );
  assert.equal(
    await call("address_name", { address: valid.address }),
    `${valid.namespace}::batch_renamed_${kind}`,
  );
  assert.equal(
    await call("address_name", { address: invalid.address }),
    `${invalid.namespace}::address_qualified_${kind}`,
  );
  const names = await call("list_names");
  for (const { namespace, address } of symbols) {
    const expected =
      address === valid.address
        ? `${namespace}::batch_renamed_${kind}`
        : `${namespace}::address_qualified_${kind}`;
    assert.ok(
      names.some(
        (item) =>
          item.address === address &&
          item.value === expected &&
          item.symbol.primary,
      ),
      `Missing refreshed primary symbol ${expected}`,
    );
  }
}

async function requireNamespaceDemangler(env) {
  const inspection = await inspectVerifierGhidraInstallation({
    environment: env,
    installDir: env.GHIDRA_INSTALL_DIR,
    ...(env.JAVA_HOME === undefined ? {} : { javaHome: env.JAVA_HOME }),
  });
  if (
    inspection.status !== "available" ||
    inspection.nativeDecompilerPath === null
  )
    throw new Error(
      `Ghidra namespace verification requires an available installation: ${JSON.stringify(inspection)}`,
    );
  const nativeDirectory = basename(dirname(inspection.nativeDecompilerPath));
  const executable =
    process.platform === "win32"
      ? "demangler_gnu_v2_41.exe"
      : "demangler_gnu_v2_41";
  const failures = [];
  for (const location of ["os", "build/os"]) {
    const path = join(
      inspection.installDir,
      "GPL",
      "DemanglerGnu",
      location,
      nativeDirectory,
      executable,
    );
    try {
      await access(path, constants.X_OK);
      if ((await stat(path)).isFile()) return;
      failures.push(`${path}: not a regular file`);
    } catch (cause) {
      failures.push(
        `${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  throw new Error(
    `Ghidra namespace annotation verification requires the matching GNU demangler native component. Provide ${executable} for ${nativeDirectory} in GPL/DemanglerGnu/os or its build/os equivalent; REA does not build it. Checked: ${failures.join("; ")}`,
  );
}
