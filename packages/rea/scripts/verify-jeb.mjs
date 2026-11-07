import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { JebAnalysisService } from "../dist/application/jeb/JebAnalysisService.js";
import { createJebAnalysisProvider } from "../dist/composition/jeb.js";
import { withVerifierCleanup } from "./lib/verifier-cleanup.mjs";

const run = promisify(execFile);

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(
    "Usage: npm run verify:jeb [-- --item-address ADDRESS --marker TEXT]\n" +
      "Requires a running JEB client serving MCP at REA_JEB_MCP_URL\n" +
      "(default http://127.0.0.1:8425/mcp) with a project already open.\n" +
      "JEB 5.48 headless instances open their target at start (--infile or\n" +
      "the documented programmatic launcher); open_jeb_project is verified\n" +
      "only when the engine advertises it. Without --item-address, a tiny\n" +
      "Java fixture is compiled and its known method is decompiled.\n",
  );
  process.exit(0);
}

const provider = createJebAnalysisProvider(process.env);
const service = new JebAnalysisService(provider);
let fixtureDirectory;
try {
  const report = await withVerifierCleanup(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "rea-jeb-"));
    const client = await service.execute("inspect_jeb_client", {});
    if (!client.ok) throw new Error(client.error.message);
    const engine = client.value.normalized_result.engine;
    if (engine.version === null)
      throw new Error("The JEB client did not report its version");

    // JEB 5.48 headless clients do not advertise open_project; a project opened
    // at engine start is the supported target-selection route there. Attempt the
    // tool and record the engine's exact refusal when it is unavailable.
    let openRefusal = null;
    const target = await resolveTarget(options, fixtureDirectory);
    const opened = await service.execute("open_jeb_project", {
      path: target.path,
    });
    if (opened.ok) {
      const artifact = opened.value.normalized_result.input_files.find(
        (file) => typeof file === "object" && file !== null,
      );
      if (
        artifact === undefined ||
        !/^[0-9a-f]{64}$/u.test(artifact.contents_sha256_hash)
      )
        throw new Error("The engine did not report an input artifact digest");
    } else {
      openRefusal = opened.error.message;
    }

    const units = await service.execute("list_jeb_units", { count: 100 });
    if (!units.ok) throw new Error(units.error.message);
    if (units.value.normalized_result.units.length === 0)
      throw new Error("The engine reported no project units");

    const decompiled = await service.execute("decompile_jeb_item", {
      item_address: target.itemAddress,
      item_kind: "method",
    });
    if (!decompiled.ok) throw new Error(decompiled.error.message);
    const text = decompiled.value.normalized_result.text;
    if (!text.includes(target.marker))
      throw new Error(
        "Decompiled pseudo-code did not contain the fixture marker",
      );

    return {
      ok: true,
      provider: "jeb",
      host_platform: process.platform,
      engine_version: engine.version,
      engine_gui: engine.gui_client,
      endpoint: engine.endpoint,
      open_project_observed: openRefusal === null,
      ...(openRefusal === null ? {} : { open_project_refusal: openRefusal }),
      unit_count: units.value.normalized_result.units.length,
      decompiled_marker_observed: true,
    };
  }, [
    async () => {
      await provider.close();
      if (fixtureDirectory !== undefined) {
        await rm(fixtureDirectory, { recursive: true, force: true });
        fixtureDirectory = undefined;
      }
    },
  ]);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (cause) {
  if (fixtureDirectory !== undefined)
    process.stderr.write(`JEB fixture retained at ${fixtureDirectory}\n`);
  const causes = cause instanceof AggregateError ? cause.errors : [cause];
  process.stderr.write(
    `JEB real-provider verification failed: ${causes.map((reason) => (reason instanceof Error ? reason.message : String(reason))).join("; ")}\n`,
  );
  process.exitCode = 1;
}

async function resolveTarget(selected, directory) {
  if (selected.itemAddress !== undefined)
    return {
      path: "/engine-side/target",
      itemAddress: selected.itemAddress,
      marker: selected.marker ?? "",
    };
  await writeFile(
    join(directory, "Hello.java"),
    [
      "public class Hello {",
      "  public static String greet(String name) {",
      '    return "Hello, " + name + "!";',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  try {
    await run("javac", [join(directory, "Hello.java")]);
  } catch {
    throw new Error(
      "javac is required to build the default verification fixture",
    );
  }
  return {
    path: join(directory, "Hello.class"),
    itemAddress: "LHello;->greet(Ljava/lang/String;)Ljava/lang/String;",
    marker: "Hello, ",
  };
}

function parseArguments(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      (flag !== "--item-address" && flag !== "--marker") ||
      value === undefined
    )
      throw new Error(
        "Expected no arguments, or --item-address ADDRESS [--marker TEXT]",
      );
    values.set(flag, value);
    index += 1;
  }
  return {
    help: false,
    ...(values.has("--item-address")
      ? { itemAddress: values.get("--item-address") }
      : {}),
    ...(values.has("--marker") ? { marker: values.get("--marker") } : {}),
  };
}
