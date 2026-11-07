import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import {
  artifactCliEvidence,
  artifactMcpResult,
  artifactMcpCall,
  withArtifactMcp,
} from "../../lib/artifact-e2e.mjs";

const exec = promisify(execFile);

const MAIN = "Contents/MacOS/MacFixture";
const SERVICE = "Contents/XPCServices/Svc.xpc/Contents/MacOS/Svc";
const CORE = "Contents/Frameworks/Core.framework/Versions/A/Core";
const DEPENDENCY_COMMANDS = new Set([
  "LC_LOAD_DYLIB",
  "LC_LOAD_WEAK_DYLIB",
  "LC_REEXPORT_DYLIB",
  "LC_LAZY_LOAD_DYLIB",
  "LC_LOAD_UPWARD_DYLIB",
]);

/** Dependencies, rpaths and install name of one slice as Apple's otool reports them. */
const otoolLoadCommands = async (path, architecture) => {
  const { stdout } = await exec(
    "/usr/bin/xcrun",
    ["otool", "-arch", architecture, "-l", path],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const result = { dependencies: [], rpaths: [], install_name: null };
  for (const block of stdout.split(/\nLoad command \d+\n/u)) {
    const command = /^\s*cmd (\S+)/mu.exec(block)?.[1];
    const name = /^\s*name (.+?) \(offset \d+\)$/mu.exec(block)?.[1];
    if (command === "LC_RPATH")
      result.rpaths.push(/^\s*path (.+?) \(offset \d+\)$/mu.exec(block)?.[1]);
    else if (command === "LC_ID_DYLIB") result.install_name = name;
    else if (DEPENDENCY_COMMANDS.has(command))
      result.dependencies.push(`${command} ${name}`);
  }
  return result;
};

/** In-bundle images dyld actually loaded, in load order. */
const loadedImages = async (app, executable) => {
  const { stderr } = await exec(join(app, executable), [], {
    env: { PATH: "/usr/bin:/bin", DYLD_PRINT_LIBRARIES: "1" },
  });
  const appRoot = await realpath(app);
  const loaded = [];
  for (const line of stderr.split("\n")) {
    const path = /^dyld\[\d+\]: <[0-9A-F-]+> (.+)$/u.exec(line)?.[1];
    if (path === undefined) continue;
    // Shared-cache libraries are reported by path but are not files on disk.
    const real = await realpath(path).catch(() => undefined);
    if (real?.startsWith(`${appRoot}/`) === true)
      loaded.push(relative(appRoot, real));
  }
  return loaded;
};

/** Images a process root loads according to the trace, in first-load order. */
const predictedImages = (trace, root) => {
  const loaded = [root];
  for (const edge of trace.edges)
    if (
      edge.root === root &&
      ["resolved", "conditional"].includes(edge.resolution.status) &&
      !loaded.includes(edge.resolution.image)
    )
      loaded.push(edge.resolution.image);
  return loaded;
};

const findEdge = (trace, root, loader, installName) => {
  const edge = trace.edges.find(
    (candidate) =>
      candidate.root === root &&
      candidate.loader === loader &&
      candidate.install_name === installName,
  );
  assert.ok(edge, `missing edge ${root}: ${loader} -> ${installName}`);
  return edge;
};

const verifyResolutionShapes = (trace) => {
  const core = findEdge(
    trace,
    MAIN,
    MAIN,
    "@rpath/Core.framework/Versions/A/Core",
  );
  assert.deepEqual(
    core.candidates.map(({ source, outcome }) => [source, outcome]),
    [
      ["rpath", "absent"],
      ["rpath", "resolved"],
    ],
  );
  assert.deepEqual(core.resolution, { status: "resolved", image: CORE });
  const weak = findEdge(trace, MAIN, MAIN, "@rpath/libgone.dylib");
  assert.equal(weak.weak, true);
  assert.equal(weak.resolution.status, "unresolved");
  const delayed = findEdge(trace, MAIN, MAIN, "@rpath/libdelay.dylib");
  assert.equal(delayed.encoding, "dylib_use_command");
  assert.equal(delayed.delayed_init, true);
  const chain = findEdge(trace, MAIN, CORE, "@rpath/libchain.dylib");
  assert.equal(
    chain.resolution.image,
    "Contents/Frameworks/Core.framework/Versions/A/Libraries/libchain.dylib",
    "the loading image's own LC_RPATH must be searched first",
  );
  const service = findEdge(
    trace,
    SERVICE,
    SERVICE,
    "@rpath/Core.framework/Versions/A/Core",
  );
  assert.equal(service.candidates[0]?.outcome, "outside-target");
  assert.deepEqual(service.resolution, { status: "conditional", image: CORE });
  const system = trace.edges.filter(({ install_name: name }) =>
    name.startsWith("/usr/lib/"),
  );
  assert.ok(system.length > 0);
  assert.ok(
    system.every(({ resolution }) => resolution.status === "undetermined"),
  );
  const kinds = trace.findings.map(({ kind, image }) => `${kind}:${image}`);
  assert.ok(kinds.includes(`weak-load-unresolved:${MAIN}`));
  assert.ok(kinds.includes(`earlier-rpath-candidate-absent:${MAIN}`));
};

const verifyParserConformance = async (app, trace) => {
  let slices = 0;
  for (const image of trace.images)
    for (const slice of image.slices) {
      const expected = await otoolLoadCommands(
        join(app, image.path),
        slice.architecture,
      );
      // otool -l prints LC_LAZY_LOAD_DYLIB_INFO without its linkedit install
      // name, so this comparison cannot expect that edge. The structural
      // reader tests own the payload.
      const edges = trace.edges.filter(
        ({ loader, architecture, root, command }) =>
          command !== "LC_LAZY_LOAD_DYLIB_INFO" &&
          loader === image.path &&
          architecture === slice.architecture &&
          root ===
            trace.edges.find(
              (edge) =>
                edge.loader === image.path &&
                edge.architecture === slice.architecture,
            )?.root,
      );
      assert.deepEqual(
        {
          dependencies: edges.map(
            ({ command, install_name: name }) => `${command} ${name}`,
          ),
          rpaths: slice.rpaths,
          install_name: slice.install_name,
        },
        expected,
        `${image.path} (${slice.architecture}) differs from otool -l`,
      );
      slices += 1;
    }
  return slices;
};

/** Verify trace_dylib_resolution against otool and the real dyld on the fixture app. */
export async function verifyDylibResolution(app) {
  const trace = (await artifactCliEvidence("trace-dylib-resolution", app))
    .normalized_result;
  await withArtifactMcp(app, async (client) => {
    assert.deepEqual(
      await artifactMcpResult(client, "trace_dylib_resolution"),
      trace,
    );
    const invalid = await artifactMcpCall(client, {
      name: "trace_dylib_resolution",
      arguments: { roots: ["../outside"] },
    });
    assert.equal(invalid.isError, true);
    // Selecting the observed roots removes discovery uncertainty while retaining
    // complete dependency-resolution coverage for this known fixture.
    const roots = [...new Set(trace.roots.map(({ image }) => image))];
    const selected = (
      await artifactCliEvidence(
        "trace-dylib-resolution",
        app,
        roots.flatMap((root) => ["--root", root]),
      )
    ).normalized_result;
    assert.deepEqual(
      await artifactMcpResult(client, "trace_dylib_resolution", { roots }),
      selected,
    );
    assert.equal(selected.coverage.status, "complete");
    assert.deepEqual(selected.roots, trace.roots);
    assert.deepEqual(selected.images, trace.images);
    assert.deepEqual(selected.edges, trace.edges);
    assert.deepEqual(selected.findings, trace.findings);
  });
  // Framework aliases are deliberately not followed while discovering process
  // roots; their possible executable descendants remain unknown.
  assert.deepEqual(trace.coverage, {
    status: "partial",
    unparsed_images: [],
    roots_without_architecture: [],
  });
  assert.ok(
    trace.limitations.some((item) =>
      item.startsWith("Executable-root discovery did not follow "),
    ),
    "Framework symlinks must retain the root-discovery limitation",
  );
  assert.deepEqual(trace.roots.map(({ image }) => image).sort(), [
    "Contents/Frameworks/Core.framework/Versions/A/XPCServices/FwSvc.xpc/Contents/MacOS/FwSvc",
    "Contents/Helpers/rea-tool",
    "Contents/Library/LaunchServices/com.example.rea.helper",
    "Contents/Library/LoginItems/Login.app/Contents/MacOS/Login",
    MAIN,
    "Contents/PlugIns/Ext.appex/Contents/MacOS/Ext",
    SERVICE,
  ]);
  verifyResolutionShapes(trace);
  const slices = await verifyParserConformance(app, trace);
  for (const root of [MAIN, SERVICE])
    assert.deepEqual(
      await loadedImages(app, root),
      predictedImages(trace, root),
      `${root} load order differs from DYLD_PRINT_LIBRARIES`,
    );
  return {
    roots: trace.roots.length,
    edges: trace.edges.length,
    otool_slices: slices,
    dyld_runtime_roots: 2,
  };
}
