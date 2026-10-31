import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

type Provider = "frida" | "jeb";
type Primary = "undefined" | "null" | "success";

const cases = (["frida", "jeb"] as const).flatMap((provider) =>
  [
    { primary: "undefined", closeFails: false },
    { primary: "null", closeFails: false },
    { primary: "undefined", closeFails: true },
    { primary: "success", closeFails: true },
  ].map(({ primary, closeFails }) => ({
    provider,
    primary: primary as Primary,
    closeFails,
  })),
);

/** Copy the actual script; substitute only the engine-facing module boundary. */
const verifierFixture = async (provider: Provider) => {
  const root = await createTestTempDirectory("rea-provider-verifier-cleanup-");
  const temporary = join(root, "temporary");
  await mkdir(temporary);
  await mkdir(join(root, "scripts", "lib"), { recursive: true });
  await mkdir(join(root, "dist", "application", provider), { recursive: true });
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  const script = join(root, "scripts", `verify-${provider}.mjs`);
  await copyFile(
    new URL(`../../../scripts/verify-${provider}.mjs`, import.meta.url),
    script,
  );
  await copyFile(
    new URL("../../../scripts/lib/verifier-cleanup.mjs", import.meta.url),
    join(root, "scripts", "lib", "verifier-cleanup.mjs"),
  );
  const closeBody = `
    await appendFile(process.env.REA_TEST_VERIFIER_CLOSE_LOG, "${provider}\\n");
    if (process.env.REA_TEST_VERIFIER_CLOSE_FAIL === "1")
      throw new Error("controlled ${provider} cleanup denial");
  `;
  const primaryBody = `
    if (process.env.REA_TEST_VERIFIER_PRIMARY === "undefined") throw undefined;
    if (process.env.REA_TEST_VERIFIER_PRIMARY === "null") throw null;
  `;

  if (provider === "frida") {
    await mkdir(join(root, "dist", "frida"));
    await mkdir(join(root, "dist", "contracts"));
    await writeFile(
      join(root, "dist", "frida", "FridaInstrumentationManager.js"),
      `import { appendFile } from "node:fs/promises";
export class FridaInstrumentationManager {
  async closeAll() { ${closeBody} }
}
`,
    );
    await writeFile(
      join(
        root,
        "dist",
        "application",
        "frida",
        "FridaInstrumentationService.js",
      ),
      `export class FridaInstrumentationService {
  async instrument() {
    ${primaryBody}
    return { ok: true, value: {
      cleanupError: null,
      evidence: { normalized_result: {
        pid: 77,
        messages: [{ type: "send", payload: { rea_frida_verification: "ok", pid: 77 } }],
      } },
    } };
  }
}
`,
    );
    await writeFile(
      join(root, "dist", "contracts", "fridaRemoteAddress.js"),
      "export const isValidFridaRemoteAddress = () => false;\n",
    );
  } else {
    await mkdir(join(root, "dist", "composition"));
    await writeFile(
      join(root, "dist", "composition", "jeb.js"),
      `import { appendFile } from "node:fs/promises";
export const createJebAnalysisProvider = () => ({
  async close() { ${closeBody} },
});
`,
    );
    await writeFile(
      join(root, "dist", "application", "jeb", "JebAnalysisService.js"),
      `export class JebAnalysisService {
  async execute(operation) {
    ${primaryBody}
    const result = {
      inspect_jeb_client: { engine: { version: "simulated", gui_client: false, endpoint: "simulated" } },
      open_jeb_project: { input_files: [{ contents_sha256_hash: "${"a".repeat(64)}" }] },
      list_jeb_units: { units: [{ id: "simulated-unit" }] },
      decompile_jeb_item: { text: "simulated marker" },
    }[operation];
    if (result === undefined) throw new Error("Unexpected simulated operation: " + operation);
    return { ok: true, value: { normalized_result: result } };
  }
}
`,
    );
  }

  return { root, script, temporary, closeLog: join(root, "close.log") };
};

// These are simulated provider outcomes exercising real verifier orchestration;
// they establish no Frida instrumentation or JEB engine behavior.
processTest.for(cases)(
  "$provider verifier preserves primary=$primary with closeFails=$closeFails",
  async ({ provider, primary, closeFails }, { processes }) => {
    const fixture = await verifierFixture(provider);
    const result = await processes.run(
      process.execPath,
      [
        fixture.script,
        ...(provider === "jeb"
          ? ["--item-address", "simulated-item", "--marker", "simulated marker"]
          : []),
      ],
      {
        cwd: fixture.root,
        env: {
          ...process.env,
          TMPDIR: fixture.temporary,
          TEMP: fixture.temporary,
          TMP: fixture.temporary,
          REA_TEST_VERIFIER_PRIMARY: primary,
          REA_TEST_VERIFIER_CLOSE_FAIL: closeFails ? "1" : "0",
          REA_TEST_VERIFIER_CLOSE_LOG: fixture.closeLog,
        },
        timeoutMs: 10_000,
      },
    );

    expect(result.signal, result.stderr).toBeNull();
    expect(result.exitCode, result.stderr).toBe(1);
    const reasons = [
      ...(primary === "success" ? [] : [primary]),
      ...(closeFails ? [`controlled ${provider} cleanup denial`] : []),
    ];
    const label = provider === "frida" ? "Frida" : "JEB";
    const retained = await readdir(fixture.temporary);
    let retainedMessage = "";
    if (provider === "jeb" && closeFails) {
      expect(retained).toHaveLength(1);
      const name = retained[0];
      if (name === undefined) throw new Error("Missing retained JEB fixture");
      expect(name).toMatch(/^rea-jeb-/u);
      retainedMessage = `JEB fixture retained at ${join(fixture.temporary, name)}\n`;
    } else expect(retained).toEqual([]);
    expect(result.stderr).toBe(
      `${retainedMessage}${label} real-provider verification failed: ${reasons.join("; ")}\n`,
    );
    expect(result.stdout).toBe("");
    expect(await readFile(fixture.closeLog, "utf8")).toBe(`${provider}\n`);
  },
);
