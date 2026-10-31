import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/** Verify imported entry aliases through CLI/MCP without admitting interior labels. */
export async function verifyGhidraEntryAliases({
  call,
  reject,
  target,
  entrypoint,
  env,
}) {
  const exec = promisify(execFile);
  const compiler = process.env.REA_CC ?? "cc";
  const workspace = await mkdtemp(join(tmpdir(), "rea-ghidra-entry-aliases-"));
  const source = fileURLToPath(
    new URL("../../tests/conformance/ghidra/entry-aliases.c", import.meta.url),
  );
  const path = join(workspace, "entry-aliases");
  try {
    await exec(compiler, ["-O0", "-g", "-fno-inline", source, "-o", path], {
      env,
      timeout: 30000,
    });
    const bytes = await readFile(path);
    await call("close_binary");
    const imported = await call("open_binary", { path, provider_id: "ghidra" });
    const prefix = imported.format === "mach-o" ? "_" : "";
    const names = await call("list_names");
    const alias = names.find(
      ({ value }) => value === `${prefix}rea_entry_alias`,
    );
    assert.ok(alias, "Fixture entry alias was not imported");
    assert.equal(
      alias.symbol.primary,
      false,
      "The regression must exercise a secondary entry symbol",
    );
    assert.equal(alias.symbol.source, "imported");
    const canonical = (await call("list_procedures")).find(
      ({ address }) => address === alias.address,
    );
    assert.ok(canonical, "Fixture alias is not at a function entry");
    const xrefsSelectors = [];
    // CLI xrefs keeps bare hexadecimal selectors as addresses. A Mach-O
    // primary label such as "dead" is tested below as a procedure name instead.
    for (const value of [
      `${prefix}rea_alias_target`,
      alias.value,
      `${prefix}rea_xrefs_data`,
      `${prefix}rea_xrefs_unreferenced`,
    ]) {
      const symbol = names.find((item) => item.value === value);
      assert.ok(symbol, `Missing xrefs selector ${value}`);
      const expected = await call("xrefs", { address: symbol.address });
      if (value === `${prefix}rea_xrefs_unreferenced`)
        assert.deepEqual(expected, []);
      else assert.ok(expected.length > 0, `Missing references for ${value}`);
      xrefsSelectors.push({ symbol, expected });
    }
    for (const procedure of [
      alias.value,
      "dead",
      canonical.value,
      alias.address,
    ]) {
      assert.equal(
        await call("procedure_address", { procedure }),
        alias.address,
      );
      assert.equal(
        (await call("analyze_function", { procedure, detail: "complete" }))
          .procedure.address,
        alias.address,
      );
      assert.equal(
        await call("procedure_pseudo_code", { procedure }),
        await call("procedure_pseudo_code", { procedure: alias.address }),
      );
    }
    // Leaf and qualified forms of the primary name must not duplicate a match.
    assert.equal(
      (await call("procedure_info", { procedure: alias.value })).entrypoint,
      alias.address,
    );
    const interior = names.find(
      ({ value }) => value === `${prefix}rea_interior`,
    );
    assert.ok(interior);
    assert.notEqual(interior.address, alias.address);
    assert.equal(
      interior.symbol.type,
      "label",
      "Fixture interior control must remain an imported label",
    );
    assert.equal(
      (await call("list_procedures")).some(
        ({ address }) => address === interior.address,
      ),
      false,
      "Fixture interior control must not be a Ghidra procedure entry",
    );
    const failure = await reject("procedure_address", {
      procedure: interior.value,
    });
    assert.equal(failure.code, "invalid_request");
    assert.match(
      JSON.stringify(failure.details.issues),
      /Unknown Ghidra procedure name or address/u,
    );
    assert.equal(
      await call("procedure_address", { procedure: interior.address }),
      alias.address,
      "Explicit interior addresses keep their existing containment semantics",
    );
    const edited = await call("annotate_native_function", {
      procedure: alias.value,
      comment: "Selected by imported entry alias",
    });
    assert.equal(edited.annotations.address, alias.address);
    assert.equal(
      edited.annotations.comment,
      "Selected by imported entry alias",
    );
    assert.equal(
      await call("procedure_address", { procedure: alias.value }),
      alias.address,
    );
    await call("close_binary");
    const { stdout } = await exec(
      process.execPath,
      [
        entrypoint,
        "function",
        path,
        alias.value,
        "--provider",
        "ghidra",
        "--json",
      ],
      { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
    );
    assert.equal(
      JSON.parse(stdout).normalized_result.procedure.address,
      alias.address,
    );
    for (const { symbol, expected } of xrefsSelectors) {
      for (const selector of [
        [symbol.value],
        ["--address", symbol.value],
        [symbol.address],
      ]) {
        const { stdout } = await exec(
          process.execPath,
          [
            entrypoint,
            "xrefs",
            path,
            ...selector,
            "--provider",
            "ghidra",
            "--json",
          ],
          { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
        );
        const evidence = JSON.parse(stdout);
        assert.deepEqual(
          evidence.normalized_result,
          expected,
          `CLI xrefs mismatch for ${JSON.stringify(selector)}`,
        );
        assert.equal(evidence.parameters.address, selector.at(-1));
      }
    }
    await assert.rejects(
      exec(
        process.execPath,
        [
          entrypoint,
          "xrefs",
          path,
          "rea_missing_symbol",
          "--provider",
          "ghidra",
          "--json",
        ],
        { env, timeout: 240000, maxBuffer: 16 * 1024 * 1024 },
      ),
      (error) => {
        const failure = JSON.parse(error.stdout);
        assert.equal(failure.code, "invalid_request");
        assert.equal(failure.details.operation, "xrefs");
        assert.match(
          JSON.stringify(failure.details.issues),
          /Unknown analyzed symbol name.*rea_missing_symbol/u,
        );
        return true;
      },
    );
    assert.deepEqual(await readFile(path), bytes);
    await call("open_binary", { path: target.path, provider_id: "ghidra" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
