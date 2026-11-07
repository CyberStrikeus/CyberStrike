import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { TsharkCaptureProvider } from "../../../src/captures/TsharkCaptureProvider.js";
import { PacketCaptureService } from "../../../src/application/captures/PacketCaptureService.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// Real kernel-limit verification with a synthetic producer; real TShark has its own verifier.
it.skipIf(process.platform !== "linux")(
  "enforces both address-space limits before any producer allocation",
  async () => {
    const directory = await createTestTempDirectory("rea-tshark-limits-");
    const command = join(directory, "memory-probe");
    await writeFile(
      command,
      `#!/usr/bin/python3
import json, resource, sys
assert resource.getrlimit(resource.RLIMIT_AS) == (1073741824, 1073741824)
assert resource.getrlimit(resource.RLIMIT_FSIZE) == (67108864, 67108864)
assert resource.getrlimit(resource.RLIMIT_CORE) == (0, 0)
if '--version' in sys.argv:
    print('TShark (Wireshark) 4.6.9 (resource fixture)')
else:
    try:
        bytearray(1073741825)
    except MemoryError:
        print(json.dumps([{'_source': {'layers': {'frame.number': ['1']}}}]))
    else:
        raise RuntimeError('allocation unexpectedly succeeded')
`,
      { mode: 0o700 },
    );
    const path = join(directory, "recording.pcap");
    await writeFile(path, "selected fixture");
    const service = new PacketCaptureService(
      new TsharkCaptureProvider({
        ...process.env,
        REA_TSHARK_COMMAND: command,
      }),
    );
    onTestFinished(() => service.close());
    const result = await service.inspect({ path, fields: ["frame.number"] });
    if (!result.ok) throw result.error;
    expect(result.value.normalized_result).toMatchObject({
      packets: [{ "frame.number": ["1"] }],
      limits: { address_space_bytes: 1073741824 },
    });
  },
);

it.skipIf(process.platform !== "linux")(
  "preserves lower inherited file/CPU limits in the real launch",
  async () => {
    const directory = await createTestTempDirectory(
      "rea-tshark-inherited-limits-",
    );
    const command = join(directory, "limit-probe");
    const path = join(directory, "recording.pcap");
    await writeFile(path, "selected fixture");
    await writeFile(
      command,
      `#!/usr/bin/python3
import json, resource, sys
assert resource.getrlimit(resource.RLIMIT_FSIZE) == (1048576, 1048576)
assert resource.getrlimit(resource.RLIMIT_CPU) == (20, 20)
if '--version' in sys.argv:
    print('TShark (Wireshark) 4.6.9 (resource fixture)')
else:
    print(json.dumps([{'_source': {'layers': {'frame.number': ['1']}}}]))
`,
      { mode: 0o700 },
    );
    const runner = join(directory, "runner.mjs");
    const serviceModule = new URL(
      "../../../dist/application/captures/PacketCaptureService.js",
      import.meta.url,
    ).href;
    const providerModule = new URL(
      "../../../dist/captures/TsharkCaptureProvider.js",
      import.meta.url,
    ).href;
    await writeFile(
      runner,
      `import { PacketCaptureService } from ${JSON.stringify(serviceModule)};
import { TsharkCaptureProvider } from ${JSON.stringify(providerModule)};
const service = new PacketCaptureService(new TsharkCaptureProvider({ ...process.env, REA_TSHARK_COMMAND: ${JSON.stringify(command)} }));
try {
  const result = await service.inspect({ path: ${JSON.stringify(path)}, fields: ['frame.number'] });
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

it.skipIf(process.platform !== "linux")(
  "reports a real kernel file-limit termination with its effective ceiling",
  async () => {
    const directory = await createTestTempDirectory("rea-tshark-file-limit-");
    const command = join(directory, "file-probe");
    const path = join(directory, "recording.pcap");
    await writeFile(path, "selected fixture");
    await writeFile(
      command,
      `#!/usr/bin/python3
import signal, sys
if '--version' in sys.argv:
    print('TShark (Wireshark) 4.6.9 (resource fixture)')
else:
    signal.signal(signal.SIGXFSZ, signal.SIG_DFL)
    print('before file limit', file=sys.stderr, flush=True)
    with open('overflow', 'wb', buffering=0) as output:
        output.write(b'x' * 4096)
        output.write(b'x')
`,
      { mode: 0o700 },
    );
    const service = new PacketCaptureService(
      new TsharkCaptureProvider(
        { ...process.env, REA_TSHARK_COMMAND: command },
        undefined,
        undefined,
        process.platform,
        undefined,
        async (limits) => ({ ...limits, file_bytes: 4096 }),
      ),
    );
    onTestFinished(() => service.close());
    const result = await service.inspect({ path, fields: ["frame.number"] });
    if (result.ok) throw new Error("Expected file-limit failure");
    expect(result.error).toMatchObject({
      _tag: "AnalysisResourceConstraintError",
      resource: "file-size",
      reportedLimits: { file_bytes: 4096 },
      capturedOutput: { signal: "SIGXFSZ", stderr: "before file limit\n" },
    });
  },
);
