import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "binds relative Hopper launchers once for availability, profile and real bridge lifecycle",
  async () => {
    const root = await createTestTempDirectory("rea-hopper-relative-launcher-");
    const away = join(root, "away");
    await mkdir(away);
    await mkdir(join(root, "physical/child"), { recursive: true });
    await symlink(join(root, "physical/child"), join(root, "link"));
    const target = join(root, "target");
    await copyFile("/usr/bin/true", target);
    const fakeBridge = new URL(
      "../../../fixtures/fakeHopper.mjs",
      import.meta.url,
    ).href;
    const helper = join(root, "bridge-helper.mjs");
    await writeFile(
      helper,
      `
      import { readFileSync, writeFileSync } from 'node:fs';
      const bootstrap = readFileSync(process.argv[process.argv.indexOf('-Y') + 1], 'utf8');
      const setting = name => JSON.parse(bootstrap.split('\\n').find(line => line.startsWith(name + ' = ')).slice(name.length + 3));
      writeFileSync(process.env.REA_LAUNCHER_MARKER, process.env.REA_SELECTED_LAUNCHER);
      process.argv = [process.execPath, ${JSON.stringify(fakeBridge)}, setting('REA_SOCKET'), setting('REA_TOKEN'), setting('REA_RUN_ID')];
      await import(${JSON.stringify(fakeBridge)});
    `,
    );
    const script = `#!/bin/sh\nREA_SELECTED_LAUNCHER="$0" exec '${process.execPath}' '${helper}' "$@"\n`;
    for (const path of [
      join(root, "my-hopper"),
      join(root, "physical/my-hopper"),
    ])
      await writeFile(path, script, { mode: 0o700 });
    await writeFile(join(away, "my-hopper"), "#!/bin/sh\nexit 87\n", {
      mode: 0o700,
    });
    const module = (path: string) =>
      new URL(`../../../../src/${path}.ts`, import.meta.url).href;
    const source = `
      import { HopperProvider } from ${JSON.stringify(module("hopper/HopperProvider"))};
      import { parseConfig } from ${JSON.stringify(module("config/parseConfig"))};
      import { parseBinaryTarget } from ${JSON.stringify(module("application/BinaryTargetResolver"))};
      import { silentLogger } from ${JSON.stringify(module("logger"))};
      const root = ${JSON.stringify(root)};
      const target = await parseBinaryTarget(${JSON.stringify(target)}, { cwd: root, hostArchitecture: process.arch });
      if (!target.ok) throw target.error;
      const results = [];
      for (const selected of ['my-hopper', './my-hopper', 'link/../my-hopper']) {
        process.chdir(root);
        const config = parseConfig({ HOPPER_LAUNCHER_PATH: selected, HOPPER_LOADER_ARGS_JSON: '["--fixture"]', REA_HOPPER_STARTUP_TIMEOUT_MS: '3000' });
        if (!config.ok) throw config.error;
        const marker = root + '/marker-' + results.length;
        const provider = new HopperProvider(config.value, silentLogger, { REA_LAUNCHER_MARKER: marker }, 'darwin');
        process.chdir(${JSON.stringify(away)});
        const availability = provider.inspectAvailability();
        const profile = await provider.resolveAnalysisProfile(target.value);
        if (!profile.ok) { results.push({ selected, availability, profile: false }); await provider.closeOwnedResources(); continue; }
        if (profile.value.profile.provider.version !== ${JSON.stringify("launcher-sha256:")} + ${JSON.stringify(createHash("sha256").update(script).digest("hex"))}) { await provider.closeOwnedResources(); throw new Error('Profile selected a different launcher after cwd changed'); }
        const client = provider.createClient(target.value, profile.value.profile);
        try {
          const result = await client.execute('list_documents', {});
          results.push({ selected, availability, profile: true, executed: result.ok, marker });
        } finally {
          const closed = await client.close();
          if (!closed.ok) throw closed.error;
          const released = await provider.closeOwnedResources();
          if (!released.ok) throw released.error;
        }
      }
      console.log(JSON.stringify(results));
    `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--input-type=module",
        "--eval",
        source,
      ],
      { cwd: root, timeout: 20_000 },
    );
    expect(JSON.parse(stdout)).toEqual(
      ["my-hopper", "./my-hopper", "link/../my-hopper"].map(
        (selected, index) => ({
          selected,
          availability: expect.objectContaining({
            status: "available",
            diagnostics: { launcher_path: selected, platform: "darwin" },
          }),
          profile: true,
          executed: true,
          marker: join(root, `marker-${String(index)}`),
        }),
      ),
    );
    expect(await readFile(join(root, "marker-0"), "utf8")).toBe(
      join(root, "my-hopper"),
    );
    expect(await readFile(join(root, "marker-1"), "utf8")).toBe(
      join(root, "my-hopper"),
    );
    expect(await readFile(join(root, "marker-2"), "utf8")).toBe(
      `${root}/link/../my-hopper`,
    );
  },
);
