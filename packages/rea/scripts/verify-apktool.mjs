import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import { ApktoolResourceAnalysisService } from "../dist/application/apktool/ApktoolResourceAnalysisService.js";
import { createApktoolResourceAnalysisProvider } from "../dist/composition/apktool.js";

const options = parseArguments(process.argv.slice(2));
if (options.help) {
  process.stdout.write(
    "Usage: npm run verify:apktool [-- --apk PATH]\n" +
      "Requires a caller-selected apktool launcher (REA_APKTOOL_COMMAND or\n" +
      "PATH) and a Java runtime. Without --apk, only client availability is\n" +
      "checked. Supply a local APK to verify decoding; nothing is downloaded or built.\n",
  );
  process.exit(0);
}

const provider = createApktoolResourceAnalysisProvider(process.env);
const service = new ApktoolResourceAnalysisService(provider);
let failures = 0;
const check = (name, condition, detail = "") => {
  const mark = condition ? "ok" : "FAIL";
  process.stdout.write(
    `[${mark}] ${name}${detail === "" ? "" : ` — ${detail}`}\n`,
  );
  if (!condition) failures += 1;
};

const run = async (operation, input) => {
  const result = await service.execute(operation, input);
  if (!result.ok) {
    process.stdout.write(`[FAIL] ${operation} — ${result.error.message}\n`);
    failures += 1;
    return null;
  }
  if (operation === "decode_android_resources") {
    const evidence = result.value;
    const target = evidence.normalized_result.target;
    check(
      "resource Evidence preserves the decoded APK subject identity",
      evidence.subject?.digest.sha256 === target.sha256 &&
        evidence.subject?.local_path === target.path &&
        evidence.subject?.format === "apk",
    );
  }
  return result.value.normalized_result;
};

try {
  const client = await run("inspect_apktool_client", {});
  if (client !== null) {
    check(
      "apktool launcher reports a version",
      typeof client.client.apktool_version === "string" &&
        client.client.apktool_version !== "",
      `command=${client.client.command} version=${client.client.apktool_version}`,
    );
  }

  if (options.apk !== null) {
    const decoded = await run("decode_android_resources", {
      path: options.apk,
      include_strings: true,
    });
    if (decoded !== null) {
      const bytes = await stat(options.apk).then((info) => info.size);
      const digest = createHash("sha256")
        .update(await readFile(options.apk))
        .digest("hex");
      check(
        "decoded target identity matches the file on disk",
        decoded.target.bytes === bytes && decoded.target.sha256 === digest,
        `${bytes} bytes`,
      );
      check(
        "metadata carries version and SDK facts",
        typeof decoded.metadata.version_name === "string" &&
          decoded.metadata.min_sdk_version !== null &&
          decoded.metadata.target_sdk_version !== null,
        `version=${String(decoded.metadata.version_name)} sdk=${String(decoded.metadata.min_sdk_version)}..${String(decoded.metadata.target_sdk_version)}`,
      );
      check(
        "decoded manifest names the package",
        typeof decoded.metadata.package_name === "string" &&
          decoded.manifest !== null &&
          decoded.manifest.includes(decoded.metadata.package_name),
        String(decoded.metadata.package_name),
      );
      check(
        "string resources projected",
        decoded.strings.length > 0,
        `${decoded.strings.length} string(s)`,
      );
      if (decoded.locales.length > 0) {
        const locale = await run("decode_android_resources", {
          path: options.apk,
          include_strings: true,
          locale: decoded.locales[0],
        });
        if (locale !== null)
          check(
            `locale table projected for ${String(decoded.locales[0])}`,
            Array.isArray(locale.strings),
            `${locale.strings.length} string(s)`,
          );

        const selectedLocales = decoded.locales.slice(0, 2);
        const batched = await run("decode_android_resources", {
          path: options.apk,
          include_strings: true,
          locales: selectedLocales,
        });
        if (batched !== null) {
          const expectedLocales = [null, ...selectedLocales];
          const hasExpectedTables =
            Array.isArray(batched.string_tables) &&
            expectedLocales.every((expected) =>
              batched.string_tables.some(
                (table) =>
                  table.locale === expected && table.status === "present",
              ),
            );
          check(
            "batched string tables projected with expected locales and status",
            hasExpectedTables,
            `${String(batched.string_tables?.length)} table(s) present`,
          );
        }
      }
    }
  }
} catch (cause) {
  failures += 1;
  process.stdout.write(
    `[FAIL] verifier execution — ${cause instanceof Error ? cause.message : String(cause)}\n`,
  );
} finally {
  try {
    await provider.close();
  } catch (cause) {
    failures += 1;
    process.stdout.write(
      `[FAIL] provider cleanup — ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
  }
}

if (failures > 0) {
  process.stdout.write(`\n${failures} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("\nall apktool checks passed\n");

function parseArguments(argv) {
  const parsed = { help: false, apk: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") parsed.help = true;
    else if (argument === "--apk") {
      const path = argv[index + 1];
      if (path === undefined) {
        process.stderr.write("--apk requires a local APK path\n");
        process.exit(2);
      }
      parsed.apk = path;
      index += 1;
    } else {
      process.stderr.write(`unknown argument: ${argument}\n`);
      process.exit(2);
    }
  }
  return parsed;
}
