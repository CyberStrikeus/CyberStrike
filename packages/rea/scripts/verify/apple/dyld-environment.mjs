import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  artifactCli,
  artifactMcpResult,
  withArtifactMcp,
} from "../../lib/artifact-e2e.mjs";

const exec = promisify(execFile);

const SEARCH_CASES = [
  {
    setting: "DYLD_FALLBACK_LIBRARY_PATH=",
    image: "library",
    found: "resolved",
    missing: "undetermined",
    foundCoverage: "partial",
    missingCoverage: "partial",
    rootSearch: true,
  },
  {
    setting: "DYLD_FALLBACK_LIBRARY_PATH=:",
    image: "library",
    found: "resolved",
    missing: "undetermined",
    foundCoverage: "partial",
    missingCoverage: "partial",
    rootSearch: true,
  },
  {
    setting: "DYLD_LIBRARY_PATH=",
    image: "library",
    found: "conditional",
    missing: "undetermined",
    foundCoverage: "partial",
    missingCoverage: "partial",
    rootSearch: true,
  },
  {
    setting: "DYLD_FALLBACK_FRAMEWORK_PATH=",
    image: "framework",
    found: "resolved",
    missing: "undetermined",
    foundCoverage: "complete",
    missingCoverage: "partial",
    rootSearch: true,
  },
  {
    setting: "DYLD_FRAMEWORK_PATH=",
    image: "framework",
    found: "conditional",
    missing: "undetermined",
    foundCoverage: "partial",
    missingCoverage: "partial",
    rootSearch: true,
  },
  {
    setting: "DYLD_VERSIONED_LIBRARY_PATH=",
    image: "library",
    found: "resolved",
    missing: "unresolved",
    foundCoverage: "complete",
    missingCoverage: "complete",
    rootSearch: false,
  },
  {
    setting: "DYLD_VERSIONED_LIBRARY_PATH=:",
    image: "library",
    found: "resolved",
    missing: "unresolved",
    foundCoverage: "complete",
    missingCoverage: "complete",
    rootSearch: false,
  },
  {
    setting: "DYLD_VERSIONED_FRAMEWORK_PATH=",
    image: "framework",
    found: "resolved",
    missing: "unresolved",
    foundCoverage: "complete",
    missingCoverage: "complete",
    rootSearch: false,
  },
  {
    setting: "DYLD_IMAGE_SUFFIX=:",
    image: "library",
    found: "resolved",
    missing: "unresolved",
    foundCoverage: "complete",
    missingCoverage: "complete",
    rootSearch: false,
  },
  {
    setting: "DYLD_IMAGE_SUFFIX=:_debug:",
    image: "library",
    found: "conditional",
    missing: "undetermined",
    foundCoverage: "partial",
    missingCoverage: "partial",
    rootSearch: false,
  },
];

const verifyTrace = async (program, expected) => {
  const { setting, installName, status, coverage } = expected;
  const trace = await artifactCli("trace-dylib-resolution", program);
  const edge = trace.edges.find(
    ({ install_name }) => install_name === installName,
  );
  assert.equal(edge?.resolution.status, status, setting);
  assert.equal(trace.coverage.status, coverage, setting);
  assert.deepEqual(
    trace.images.find(({ path }) => path === "program")?.slices[0]
      ?.dyld_environment,
    [setting],
  );
  await withArtifactMcp(program, async (client) => {
    assert.deepEqual(
      await artifactMcpResult(client, "trace_dylib_resolution"),
      trace,
    );
  });
};

const missingRuntime = async (program) => {
  try {
    await exec(program, [], {
      env: { PATH: "/usr/bin:/bin", DYLD_PRINT_SEARCHING: "1" },
    });
  } catch (cause) {
    assert.equal(typeof cause?.stderr, "string");
    assert.ok(cause.stderr.includes("Library not loaded:"), cause.stderr);
    return cause.stderr;
  }
  assert.fail(
    "The required dependency was removed, but the executable launched",
  );
};

const verifyCase = async (directory, source, sample) => {
  const {
    setting,
    installName,
    found,
    missing,
    foundCoverage,
    missingCoverage,
    rootSearch,
  } = sample;
  const library = join(directory, installName.slice("@loader_path/".length));
  const program = join(directory, "program");
  await mkdir(dirname(library), { recursive: true });
  await exec("/usr/bin/xcrun", [
    "clang",
    "-dynamiclib",
    source.library,
    "-o",
    library,
    `-Wl,-install_name,${installName}`,
  ]);
  await exec("/usr/bin/xcrun", [
    "clang",
    source.main,
    library,
    "-o",
    program,
    `-Wl,-dyld_env,${setting}`,
  ]);
  await exec(program, [], { env: { PATH: "/usr/bin:/bin" } });
  await verifyTrace(program, {
    setting,
    installName,
    status: found,
    coverage: foundCoverage,
  });
  await rm(library);
  const searches = await missingRuntime(program);
  const rootCandidate = installName.replace("@loader_path/", "/");
  assert.equal(searches.includes(`"${rootCandidate}"`), rootSearch, searches);
  await verifyTrace(program, {
    setting,
    installName,
    status: missing,
    coverage: missingCoverage,
  });
};

/** Check empty embedded settings against real dyld search diagnostics and CLI/MCP results. */
export async function verifyDyldEnvironment(root) {
  const directory = join(root, "dyld-environment");
  await mkdir(directory);
  const source = {
    main: join(directory, "main.c"),
    library: join(directory, "child.c"),
  };
  await writeFile(
    source.main,
    "int value(void); int main(void) { return value() == 7 ? 0 : 1; }",
  );
  await writeFile(source.library, "int value(void) { return 7; }");
  // A per-workspace name avoids collisions with real files in filesystem root.
  const name = `rea-${basename(root)}-child`;
  const libraryName = `@loader_path/${name}.dylib`;
  const frameworkName = `@loader_path/${name}.framework/${name}`;

  for (const [index, { image, ...sample }] of SEARCH_CASES.entries()) {
    await verifyCase(join(directory, String(index)), source, {
      ...sample,
      installName: image === "framework" ? frameworkName : libraryName,
    });
  }
  return {
    settings: SEARCH_CASES.length,
    dependency_states: ["present", "missing"],
    cli: true,
    stdio_mcp: true,
    real_dyld: true,
  };
}
