import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { chmod, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";

import * as nativeBound from "../../../src/pcap/PcapNativeBound.js";
import { PcapProvider } from "../../../src/pcap/PcapProvider.js";
import {
  PrivateRuntimeRoot,
  type PrivateRuntimeRootOptions,
} from "../../../src/process/PrivateRuntimeRoot.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

// POSIX fixtures use real mkdtemp under caller-controlled temporary parents.
const it = test.skipIf(process.platform === "win32");
const nonRoot = process.getuid?.() !== 0;
const stubs = join(import.meta.dirname, "../../fixtures/pcap");

type Allocate = (
  options: PrivateRuntimeRootOptions,
  allocate: (options: PrivateRuntimeRootOptions) => Promise<PrivateRuntimeRoot>,
) => Promise<PrivateRuntimeRoot>;

/** Inspect a capture through MCP while only the pcap workspace allocation is redirected. */
const inspectWith = async (allocate: Allocate, path: string) => {
  const create = PrivateRuntimeRoot.create.bind(PrivateRuntimeRoot);
  vi.spyOn(PrivateRuntimeRoot, "create").mockImplementation((options = {}) =>
    options.prefix === "rea-pcap-"
      ? allocate(options, create)
      : create(options),
  );
  // macOS has no native capture bound; admit it so allocation is reached.
  vi.spyOn(nativeBound, "preparePcapNativeBound").mockResolvedValue({
    nativeBound: {},
    limitations: ["Native resource admission simulated by this test"],
  });
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
  const provider = new PcapProvider({
    environment: {
      REA_TSHARK_COMMAND: join(stubs, "tshark-stub.sh"),
      REA_CAPINFOS_COMMAND: join(stubs, "capinfos-stub.sh"),
    },
  });
  const server = createServer(
    {
      kind: "session",
      session: createTestBinarySession(() => {
        throw new Error("No native binary provider");
      }),
    },
    { pcapAnalysis: provider },
  );
  const client = new Client({ name: "pcap-workspace-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await provider.close();
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return parseMcpToolError(
    await client.callTool({
      name: "inspect_pcap_capture",
      arguments: { path },
    }),
  ).error;
};

const systemError = (code: string, path: string) =>
  Object.assign(new Error(`${code}: simulated, mkdtemp '${path}'`), {
    code,
    path,
  });

it.each<readonly [string, string]>([
  ["ENOTDIR", "a regular file"],
  // Root bypasses directory permissions, so EACCES needs a non-root account.
  ...(nonRoot ? [["EACCES", "a mode-0500 directory"] as const] : []),
])(
  "reports real %s allocation under %s as an unusable workspace, not a size limit",
  async (code) => {
    const root = await createTestTempDirectory("rea-pcap-workspace-");
    const parent = join(root, "parent");
    if (code === "ENOTDIR") await writeFile(parent, "not a directory");
    else {
      await mkdir(parent, { mode: 0o500 });
      onTestFinished(() => chmod(parent, 0o700));
    }
    let cause: unknown;
    const error = await inspectWith(
      (options, create) =>
        create({ ...options, parent }).catch((failure: unknown) => {
          cause = failure;
          throw failure;
        }),
      join(root, "missing.pcap"),
    );
    expect(cause).toMatchObject({ code });
    expect(error).toMatchObject({
      code: "execution_failure",
      category: "execution_failure",
      message: expect.stringContaining(
        `Cannot prepare the private analysis workspace (${code})`,
      ) as unknown,
      remediation: {
        action: expect.stringContaining("TMPDIR") as unknown,
      },
      details: {
        provider_id: "pcap",
        operation: "inspect_pcap_capture",
        diagnostics: {
          stage: "workspace",
          workspace_path: null,
          path:
            code === "ENOTDIR"
              ? `${parent}/.`
              : (expect.stringContaining(join(parent, "rea-pcap-")) as unknown),
          system_code: code,
        },
      },
    });
    expect(JSON.stringify(error)).not.toContain("file-size");
  },
);

it("reaches input admission when the workspace parent is usable", async () => {
  const root = await createTestTempDirectory("rea-pcap-workspace-");
  const error = await inspectWith(
    (options, create) => create({ ...options, parent: root }),
    join(root, "missing.pcap"),
  );
  expect(error.code).toBe("invalid_request");
  expect(
    (await readdir(root)).filter((name) => name.startsWith("rea-pcap-")),
  ).toEqual([]);
});

it.each([
  ["ENOSPC", "resource_constraint", "Free disk space or quota"],
  ["EDQUOT", "resource_constraint", "Free disk space or quota"],
  ["EMFILE", "execution_failure", "open-file limit"],
  ["ENFILE", "execution_failure", "open-file limit"],
  ["EROFS", "execution_failure", "TMPDIR"],
])(
  "classifies simulated %s allocation by its storage or descriptor cause",
  async (code, expected, recovery) => {
    const root = await createTestTempDirectory("rea-pcap-workspace-");
    const template = join(root, "rea-pcap-XXXXXX");
    const error = await inspectWith(
      () => Promise.reject(systemError(code, template)),
      join(root, "missing.pcap"),
    );
    expect(error).toMatchObject({
      code: expected,
      remediation: { action: expect.stringContaining(recovery) as unknown },
    });
    if (expected === "resource_constraint")
      expect(error.details).toMatchObject({
        resource: "file-size",
        reported_limits: {
          workspace_path: null,
          path: template,
          system_code: code,
        },
      });
    else
      expect(error.details).toMatchObject({
        diagnostics: { stage: "workspace", path: template, system_code: code },
      });
  },
);

test.skipIf(process.platform === "win32" || !nonRoot)(
  "removes a partially prepared workspace whose contents cannot be created",
  async () => {
    const root = await createTestTempDirectory("rea-pcap-workspace-");
    let workspace: string | undefined;
    const error = await inspectWith(
      async (options, create) => {
        const allocated = await create({ ...options, parent: root });
        workspace = allocated.path;
        // The owner-only workspace exists, but its configuration directory cannot.
        await chmod(allocated.path, 0o500);
        return allocated;
      },
      join(root, "missing.pcap"),
    );
    expect(error).toMatchObject({
      code: "execution_failure",
      details: {
        diagnostics: {
          stage: "workspace",
          workspace_path: workspace,
          path: join(workspace ?? "", "configuration"),
          system_code: "EACCES",
        },
      },
    });
    expect(
      (await readdir(root)).filter((name) => name.startsWith("rea-pcap-")),
    ).toEqual([]);
  },
);

it("still reports a capture over the snapshot budget as a file-size limit", async () => {
  const root = await createTestTempDirectory("rea-pcap-workspace-");
  const capture = join(root, "oversized.pcap");
  // Sparse: one byte over the 2 GiB owned-snapshot allowance, no data blocks.
  const handle = await open(capture, "w");
  await handle.truncate(2 * 1024 ** 3 + 1);
  await handle.close();
  const error = await inspectWith(
    (options, create) => create({ ...options, parent: root }),
    capture,
  );
  expect(error).toMatchObject({
    code: "resource_constraint",
    details: {
      resource: "file-size",
      reported_limits: { max_capture_bytes: 2 * 1024 ** 3 },
    },
  });
  expect(
    (await readdir(root)).filter((name) => name.startsWith("rea-pcap-")),
  ).toEqual([]);
});
