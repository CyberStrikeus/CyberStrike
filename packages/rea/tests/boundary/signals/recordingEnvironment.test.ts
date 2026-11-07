import { writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { SigrokRecordingProvider } from "../../../src/signals/SigrokRecordingProvider.js";
import { SignalRecordingService } from "../../../src/application/signals/SignalRecordingService.js";
import { readStableArtifact } from "../../../src/artifacts/readStableArtifact.js";
import { PrivateRuntimeRoot } from "../../../src/process/PrivateRuntimeRoot.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Real owned shell children and workspace cleanup, not native sigrok/prlimit coverage.
it.skipIf(process.platform === "win32")(
  "keeps command, limiter and child environment together for each request while accepting later configuration",
  async () => {
    const directory = await createTestTempDirectory("rea-sigrok-environment-");
    const command = join(directory, "sigrok");
    const limiter = join(directory, "limiter");
    const nextCommand = join(directory, "next-sigrok");
    const nextLimiter = join(directory, "next-limiter");
    const script = (generation: string) => `#!/bin/sh
if [ "$REA_SIGROK_TEST_GENERATION" != ${generation} ]; then echo 'mixed environment' >&2; exit 27; fi
if [ "$1" = --version ]; then
  printf 'sigrok-cli 0.7.2\\nlibsigrokdecode 0.5.3\\n'
else
  printf 'Supported protocol decoders:\\n  uart  ${generation}\\n'
fi
`;
    for (const [path, source] of [
      [command, script("first")],
      [nextCommand, script("second")],
      [
        limiter,
        '#!/bin/sh\n[ "$REA_SIGROK_TEST_GENERATION" = first ] || exit 29\nwhile [ "$1" != -- ]; do shift; done\nshift\nexec "$@"\n',
      ],
      [
        nextLimiter,
        '#!/bin/sh\n[ "$REA_SIGROK_TEST_GENERATION" = second ] || exit 31\nwhile [ "$1" != -- ]; do shift; done\nshift\nexec "$@"\n',
      ],
    ] as const)
      await writeFile(path, source, { mode: 0o700 });
    const environment = {
      ...process.env,
      REA_SIGROK_COMMAND: command,
      REA_SIGROK_PRLIMIT_COMMAND: limiter,
      REA_SIGROK_TEST_GENERATION: "first",
    };
    let reconfigure = true;
    const provider = new SigrokRecordingProvider(
      environment,
      undefined,
      () =>
        PrivateRuntimeRoot.create({ parent: directory, prefix: "workspace-" }),
      "linux",
      async (...args) => {
        const selected = await readStableArtifact(...args);
        if (args[0] === command && reconfigure) {
          reconfigure = false;
          environment.REA_SIGROK_COMMAND = nextCommand;
          environment.REA_SIGROK_PRLIMIT_COMMAND = nextLimiter;
          environment.REA_SIGROK_TEST_GENERATION = "second";
        }
        return selected;
      },
      async (limits) => limits,
    );
    onTestFinished(() => provider.close());
    const service = new SignalRecordingService(provider);
    for (const [selectedCommand, selectedLimiter, description] of [
      [command, limiter, "first"],
      [nextCommand, nextLimiter, "second"],
    ]) {
      const result = await service.inspectDecoders({});
      if (!result.ok) throw result.error;
      expect(result.value.normalized_result).toMatchObject({
        tool: { configured_path: selectedCommand, path: selectedCommand },
        resource_limiter: {
          configured_path: selectedLimiter,
          path: selectedLimiter,
        },
        decoders: [{ id: "uart", name: description }],
      });
      expect(JSON.stringify(result.value)).not.toContain(
        "REA_SIGROK_TEST_GENERATION",
      );
      expect(
        (await readdir(directory)).filter((name) =>
          name.startsWith("workspace-"),
        ),
      ).toEqual([]);
    }
  },
);
