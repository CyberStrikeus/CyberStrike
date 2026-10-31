import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { SigrokRecordingProvider } from "../../../src/signals/SigrokRecordingProvider.js";
import { SignalRecordingService } from "../../../src/application/signals/SignalRecordingService.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Real kernel-limit verification with a synthetic producer; real sigrok has its own verifier.
it.skipIf(process.platform !== "linux")(
  "enforces both address-space limits before any producer allocation",
  async () => {
    const directory = await createTestTempDirectory("rea-sigrok-limits-");
    const command = join(directory, "memory-probe");
    await writeFile(
      command,
      `#!/usr/bin/python3
import resource, sys
assert resource.getrlimit(resource.RLIMIT_AS) == (1073741824, 1073741824)
assert resource.getrlimit(resource.RLIMIT_FSIZE) == (67108864, 67108864)
assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)
if '--version' in sys.argv:
    print('sigrok-cli 0.7.2\\nlibsigrokdecode (resource fixture)')
else:
    try:
        bytearray(1073741825)
    except MemoryError:
        print('allocation refused by kernel limit')
    else:
        raise RuntimeError('allocation unexpectedly succeeded')
`,
      { mode: 0o700 },
    );
    const path = join(directory, "recording.vcd");
    await writeFile(path, "selected fixture");
    const service = new SignalRecordingService(
      new SigrokRecordingProvider({
        ...process.env,
        REA_SIGROK_COMMAND: command,
      }),
    );
    onTestFinished(() => service.close());
    const result = await service.decode({ path, decoders: "uart" });
    if (!result.ok) throw result.error;
    expect(result.value.normalized_result).toMatchObject({
      annotations_text: "allocation refused by kernel limit\n",
      limits: { address_space_bytes: 1073741824 },
    });
  },
);

it.skipIf(process.platform !== "linux")(
  "preserves lower inherited file/CPU limits in the real launch",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-sigrok-inherited-limits-",
    );
    const command = join(directory, "limit-probe");
    const path = join(directory, "recording.vcd");
    await writeFile(path, "selected fixture");
    await writeFile(
      command,
      `#!/usr/bin/python3
import resource, sys
assert resource.getrlimit(resource.RLIMIT_FSIZE) == (1048576, 1048576)
assert resource.getrlimit(resource.RLIMIT_CPU) == (20, 20)
if '--version' in sys.argv:
    print('sigrok-cli 0.7.2\\nlibsigrokdecode (resource fixture)')
else:
    print('10-20 uart-1: 42')
`,
      { mode: 0o700 },
    );
    const runner = join(directory, "runner.mjs");
    const serviceModule = new URL(
      "../../../dist/application/signals/SignalRecordingService.js",
      import.meta.url,
    ).href;
    const providerModule = new URL(
      "../../../dist/signals/SigrokRecordingProvider.js",
      import.meta.url,
    ).href;
    await writeFile(
      runner,
      `import { SignalRecordingService } from ${JSON.stringify(serviceModule)};
import { SigrokRecordingProvider } from ${JSON.stringify(providerModule)};
const service = new SignalRecordingService(new SigrokRecordingProvider({ ...process.env, REA_SIGROK_COMMAND: ${JSON.stringify(command)} }));
try {
  const result = await service.decode({ path: ${JSON.stringify(path)}, decoders: 'uart' });
  if (!result.ok) throw result.error;
  console.log(JSON.stringify(result.value.normalized_result.limits));
} finally { await service.close(); }
`,
    );
    const { stdout } = await promisify(execFile)(
      "/usr/bin/prlimit",
      [
        "--fsize=1048576:2097152",
        "--cpu=20:25",
        "--",
        process.execPath,
        runner,
      ],
      { timeout: 30000, maxBuffer: 65536 },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      file_bytes: 1048576,
      cpu_seconds: 20,
    });
  },
);
