import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createHash } from "node:crypto";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import { z } from "zod";

import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import {
  CPU,
  FILE_TYPE,
  LC,
  buildVersionCommand,
  dylibCommand,
  dyldEnvironmentCommand,
  fatImage,
  machoImage,
  rpathCommand,
} from "../../../src/artifacts/apple/MachoImage.fixture.js";
import { dylibResolutionResultSchema } from "../../../src/domain/apple/dylibResolution.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const withClient = async (
  verify: (client: Client) => Promise<void>,
): Promise<void> => {
  const session = createTestBinarySession(new ArtifactProvider(process.env));
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "dylib-mcp-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await verify(client);
  } finally {
    await client.close();
    await server.close();
  }
};

const structuredResult = (value: unknown): unknown =>
  z.object({ normalized_result: z.unknown() }).parse(value).normalized_result;

it("traces dylib resolution for an opened app bundle and rejects a changed target", async () => {
  const app = join(
    await createTestTempDirectory("rea-dylib-mcp-"),
    "Fixture.app",
  );
  await mkdir(join(app, "Contents/MacOS"), { recursive: true });
  await mkdir(join(app, "Contents/Frameworks"), { recursive: true });
  await writeFile(
    join(app, "Contents/Info.plist"),
    "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
  );
  const executable = join(app, "Contents/MacOS/App");
  await writeFile(
    executable,
    machoImage({
      commands: [
        buildVersionCommand(1),
        rpathCommand("@executable_path/../Frameworks"),
        dylibCommand(LC.LOAD_DYLIB, "@rpath/libcore.dylib"),
      ],
    }),
  );
  await writeFile(
    join(app, "Contents/Frameworks/libcore.dylib"),
    machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [buildVersionCommand(1)],
    }),
  );
  await withClient(async (client) => {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: app },
    });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const called = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: {},
    });
    expect(called.isError, JSON.stringify(called.structuredContent)).not.toBe(
      true,
    );
    const trace = dylibResolutionResultSchema.parse(
      structuredResult(called.structuredContent),
    );
    expect(trace.edges).toEqual([
      expect.objectContaining({
        install_name: "@rpath/libcore.dylib",
        resolution: {
          status: "resolved",
          image: "Contents/Frameworks/libcore.dylib",
        },
      }),
    ]);
    const escaping = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: { roots: ["Contents/../../outside"] },
    });
    expect(escaping.isError).toBe(true);

    await writeFile(executable, machoImage({}));
    const changed = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: {},
    });
    expect(changed.isError).toBe(true);
    expect(JSON.stringify(parseMcpToolError(changed))).toContain("integrity");
  });
});

it("traces architecture slices from a universal Mach-O target", async () => {
  const root = await createTestTempDirectory("rea-dylib-universal-");
  const executable = join(root, "Universal");
  const cpu = process.arch === "arm64" ? CPU.arm64 : CPU.x86_64;
  const architecture = process.arch === "arm64" ? "arm64" : "x86_64";
  await writeFile(
    executable,
    fatImage([
      {
        cpu,
        bytes: machoImage({
          cpu,
          commands: [buildVersionCommand(1)],
        }),
      },
    ]),
  );

  await withClient(async (client) => {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: executable },
    });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const called = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: { architecture },
    });
    expect(called.isError, JSON.stringify(called.structuredContent)).not.toBe(
      true,
    );
    const trace = dylibResolutionResultSchema.parse(
      structuredResult(called.structuredContent),
    );
    expect(trace.roots).toEqual([{ image: "Universal", architecture }]);
  });
});

it("rejects targets that are not Mach-O", async () => {
  const directory = await createTestTempDirectory("rea-dylib-mcp-plist-");
  const path = join(directory, "Info.plist");
  await writeFile(path, "<plist><dict/></plist>");
  await withClient(async (client) => {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError).not.toBe(true);
    const called = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: {},
    });
    expect(called.isError).toBe(true);
    expect(parseMcpToolError(called)).toMatchObject({
      error: { code: "unsupported_target", category: "unsupported_target" },
    });
  });
});

it("reports target kinds that artifact operations cannot inspect as unsupported", async () => {
  const directory = await createTestTempDirectory("rea-artifact-target-");
  const plist = join(directory, "Info.plist");
  await writeFile(plist, "<plist><dict/></plist>");
  const tool = join(directory, "tool");
  await writeFile(tool, machoImage({ commands: [buildVersionCommand(1)] }));
  await withClient(async (client) => {
    for (const [path, operation, requirement] of [
      [plist, "decode_interface_builder", "requires an active .app bundle"],
      // Elsewhere the session reports asset catalogs as unavailable on the
      // host before the provider checks the target kind.
      ...(process.platform === "darwin"
        ? ([
            [plist, "inspect_asset_catalog", "requires an active .app bundle"],
          ] as const)
        : []),
      [tool, "inspect_keyed_archive", "requires an active plist or .app"],
    ] as const) {
      const open = { name: "open_binary", arguments: { path } };
      expect((await client.callTool(open)).isError, path).not.toBe(true);
      const called = await client.callTool({ name: operation, arguments: {} });
      expect(parseMcpToolError(called), operation).toMatchObject({
        error: {
          code: "unsupported_target",
          message: expect.stringContaining(`${operation} at ${path}`),
          details: { reason: expect.stringContaining(requirement) },
        },
      });
    }
  });
});

it("traces a standalone Mach-O file whose name ends in .app", async () => {
  const directory = await createTestTempDirectory("rea-dylib-mcp-file-");
  await writeFile(
    join(directory, "Tool.app"),
    machoImage({
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.LOAD_DYLIB, "@loader_path/libcore.dylib"),
      ],
    }),
  );
  await writeFile(
    join(directory, "libcore.dylib"),
    machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [buildVersionCommand(1)],
    }),
  );
  await withClient(async (client) => {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: join(directory, "Tool.app") },
    });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const called = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: {},
    });
    expect(called.isError, JSON.stringify(called.structuredContent)).not.toBe(
      true,
    );
    const trace = dylibResolutionResultSchema.parse(
      structuredResult(called.structuredContent),
    );
    expect(trace.edges).toEqual([
      expect.objectContaining({
        resolution: { status: "resolved", image: "libcore.dylib" },
      }),
    ]);
  });
});

/** Trace `app` in `analyzed/`, next to a Mach-O dylib in `outside/`. */
const traceBesideOutside = async (
  commands: readonly Uint8Array[],
  prepare: (analyzed: string) => Promise<void> = async () => {},
): Promise<{
  readonly trace: z.infer<typeof dylibResolutionResultSchema>;
  readonly outsideSha256: string;
}> => {
  const parent = await createTestTempDirectory("rea-dylib-mcp-contained-");
  const analyzed = join(parent, "analyzed");
  await mkdir(analyzed);
  await mkdir(join(parent, "outside"));
  const outside = machoImage({
    fileType: FILE_TYPE.dylib,
    commands: [
      buildVersionCommand(1),
      dylibCommand(LC.ID_DYLIB, "/outside/secret.dylib"),
    ],
  });
  await writeFile(join(parent, "outside/secret.dylib"), outside);
  await writeFile(
    join(analyzed, "app"),
    machoImage({ commands: [buildVersionCommand(1), ...commands] }),
  );
  await prepare(analyzed);
  let trace: z.infer<typeof dylibResolutionResultSchema> | undefined;
  await withClient(async (client) => {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: join(analyzed, "app") },
    });
    expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
    const called = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: {},
    });
    expect(called.isError, JSON.stringify(called.structuredContent)).not.toBe(
      true,
    );
    trace = dylibResolutionResultSchema.parse(
      structuredResult(called.structuredContent),
    );
  });
  if (trace === undefined) throw new Error("trace_dylib_resolution not called");
  return {
    trace,
    outsideSha256: createHash("sha256").update(outside).digest("hex"),
  };
};

// Windows reads `\` as a separator, but a dyld component is a POSIX name.
it.runIf(process.platform === "win32")(
  "does not read outside the root through backslashes in Windows dyld names",
  async () => {
    const { trace, outsideSha256 } = await traceBesideOutside([
      dylibCommand(LC.LOAD_DYLIB, "@loader_path/..\\outside\\secret.dylib"),
      rpathCommand("@loader_path/..\\outside"),
      dylibCommand(LC.LOAD_DYLIB, "@rpath/secret.dylib"),
    ]);
    expect(trace.edges.map(({ candidates }) => candidates)).toEqual([
      [
        expect.objectContaining({
          path: "..\\outside\\secret.dylib",
          outcome: "absent",
          resolved_path: null,
        }),
      ],
      [
        expect.objectContaining({
          path: "..\\outside/secret.dylib",
          source: "rpath",
          outcome: "absent",
          resolved_path: null,
        }),
      ],
    ]);
    expect(trace.images.map(({ path }) => path)).toEqual(["app"]);
    expect(JSON.stringify(trace)).not.toContain(outsideSha256);
  },
);

it("follows relative symlinks only while they stay inside the root", async () => {
  const { trace, outsideSha256 } = await traceBesideOutside(
    [
      dylibCommand(LC.LOAD_DYLIB, "@loader_path/link/secret.dylib"),
      dylibCommand(LC.LOAD_DYLIB, "@loader_path/sub/lib/libinner.dylib"),
    ],
    // Windows stores these relative link texts as `..\outside` and `..\lib`.
    async (analyzed) => {
      await symlink("../outside", join(analyzed, "link"), "dir");
      await mkdir(join(analyzed, "lib"));
      await mkdir(join(analyzed, "sub"));
      await symlink("../lib", join(analyzed, "sub/lib"), "dir");
      await writeFile(
        join(analyzed, "lib/libinner.dylib"),
        machoImage({
          fileType: FILE_TYPE.dylib,
          commands: [buildVersionCommand(1)],
        }),
      );
    },
  );
  expect(trace.edges.map(({ candidates }) => candidates)).toEqual([
    [
      expect.objectContaining({
        path: "link/secret.dylib",
        outcome: "escapes-target",
        resolved_path: null,
      }),
    ],
    [
      expect.objectContaining({
        path: "sub/lib/libinner.dylib",
        outcome: "resolved",
        resolved_path: "lib/libinner.dylib",
      }),
    ],
  ]);
  expect(trace.images.map(({ path }) => path)).toEqual([
    "app",
    "lib/libinner.dylib",
  ]);
  expect(JSON.stringify(trace)).not.toContain(outsideSha256);
});

it.skipIf(process.platform === "win32")(
  "does not resolve a non-UTF-8 link target as a replacement-character path",
  async () => {
    const { trace } = await traceBesideOutside(
      [dylibCommand(LC.LOAD_DYLIB, "@loader_path/raw-link")],
      async (analyzed) => {
        await symlink(
          Buffer.from([0x6c, 0x69, 0x62, 0xff]),
          join(analyzed, "raw-link"),
        );
        await writeFile(
          join(analyzed, "lib\ufffd"),
          machoImage({
            fileType: FILE_TYPE.dylib,
            commands: [buildVersionCommand(1)],
          }),
        );
      },
    );
    expect(trace.edges[0]?.resolution).toEqual({
      status: "undetermined",
      image: null,
    });
    expect(trace.coverage.status).toBe("partial");
    expect(trace.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"raw-link":"6c6962ff"'),
      ]),
    );
  },
);

it.skipIf(process.platform === "win32")(
  "resolves a POSIX file name that contains backslashes",
  async () => {
    const { trace } = await traceBesideOutside(
      [dylibCommand(LC.LOAD_DYLIB, "@loader_path/..\\outside\\secret.dylib")],
      (analyzed) =>
        writeFile(
          join(analyzed, "..\\outside\\secret.dylib"),
          machoImage({
            fileType: FILE_TYPE.dylib,
            commands: [buildVersionCommand(1)],
          }),
        ),
    );
    expect(trace.edges[0]?.resolution).toEqual({
      status: "resolved",
      image: "..\\outside\\secret.dylib",
    });
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "keeps a permission denied while canonicalizing the opened bundle",
  async () => {
    const parent = await createTestTempDirectory("rea-dylib-mcp-revoked-");
    const app = join(parent, "Revoked.app");
    await mkdir(join(app, "Contents/MacOS"), { recursive: true });
    await writeFile(
      join(app, "Contents/Info.plist"),
      "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
    );
    await writeFile(join(app, "Contents/MacOS/App"), machoImage({}));
    await withClient(async (client) => {
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path: app },
      });
      expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
      await chmod(parent, 0o000);
      try {
        const called = await client.callTool({
          name: "trace_dylib_resolution",
          arguments: {},
        });
        expect(called.isError).toBe(true);
        expect(JSON.stringify(parseMcpToolError(called))).toMatch(
          /Permission denied \(EACCES\)/u,
        );
      } finally {
        await chmod(parent, 0o755);
      }
    });
  },
);

it.each([
  "DYLD_LIBRARY_PATH=/external",
  "DYLD_PRINT_RPATHS=1",
  "DYLD_FALLBACK_LIBRARY_PATH=/external",
  "DYLD_FRAMEWORK_PATH=/external",
  "DYLD_ROOT_PATH=/external",
  "DYLD_OVERLAY_PATH=/external",
])("preserves %s and its resolution semantics through MCP", async (setting) => {
  const root = await createTestTempDirectory("rea-dylib-environment-mcp-");
  const program = join(root, "program");
  await writeFile(
    program,
    machoImage({
      commands: [
        dyldEnvironmentCommand(setting),
        buildVersionCommand(1),
        dylibCommand(LC.LOAD_DYLIB, "@loader_path/child.dylib"),
      ],
    }),
  );
  await writeFile(
    join(root, "child.dylib"),
    machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [buildVersionCommand(1)],
    }),
  );
  await withClient(async (client) => {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path: program },
    });
    expect(opened.isError).not.toBe(true);
    const result = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: {},
    });
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(
      true,
    );
    const trace = dylibResolutionResultSchema.parse(
      structuredResult(result.structuredContent),
    );
    const overrides = setting.startsWith("DYLD_LIBRARY_PATH=");
    expect(trace.edges[0]?.resolution.status).toBe(
      overrides ? "conditional" : "resolved",
    );
    expect(trace.coverage.status).toBe(overrides ? "partial" : "complete");
    expect(
      trace.images.find(({ path }) => path === "program")?.slices[0]
        ?.dyld_environment,
    ).toEqual([setting]);
  });
});

it("ignores process settings on an explicitly selected library root through MCP", async () => {
  const root = await createTestTempDirectory("rea-dylib-root-mcp-");
  const path = join(root, "library.dylib");
  const settings = [
    "DYLD_LIBRARY_PATH=/external",
    "DYLD_INSERT_LIBRARIES=/external/injected.dylib",
  ];
  await writeFile(
    path,
    machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [
        buildVersionCommand(1),
        ...settings.map(dyldEnvironmentCommand),
        dylibCommand(LC.LOAD_DYLIB, "@loader_path/child.dylib"),
        dylibCommand(LC.LOAD_DYLIB, "@loader_path/missing.dylib"),
      ],
    }),
  );
  await writeFile(
    join(root, "child.dylib"),
    machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [buildVersionCommand(1)],
    }),
  );
  await withClient(async (client) => {
    const opened = await client.callTool({
      name: "open_binary",
      arguments: { path },
    });
    expect(opened.isError, JSON.stringify(opened.structuredContent)).not.toBe(
      true,
    );
    const result = await client.callTool({
      name: "trace_dylib_resolution",
      arguments: { roots: ["library.dylib"] },
    });
    expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(
      true,
    );
    const trace = dylibResolutionResultSchema.parse(
      structuredResult(result.structuredContent),
    );
    expect(trace.edges.map(({ resolution }) => resolution.status)).toEqual([
      "resolved",
      "unresolved",
    ]);
    expect(trace.coverage.status).toBe("complete");
    expect(trace.findings.map(({ kind }) => kind)).toContain(
      "required-load-unresolved",
    );
    expect(
      trace.images.find(({ path }) => path === "library.dylib")?.slices[0]
        ?.dyld_environment,
    ).toEqual(settings);
    expect(
      trace.findings.find(({ kind }) => kind === "dyld-environment-present")
        ?.explanation,
    ).toContain("entries in this non-executable root are observations");
  });
});

it.each([
  ["DYLD_FALLBACK_LIBRARY_PATH=", "undetermined"],
  ["DYLD_VERSIONED_LIBRARY_PATH=", "unresolved"],
  ["DYLD_IMAGE_SUFFIX=:", "unresolved"],
] as const)(
  "retains the missing-dependency semantics of %s through MCP",
  async (setting, status) => {
    const root = await createTestTempDirectory("rea-dyld-empty-mcp-");
    const path = join(root, "program");
    await writeFile(
      path,
      machoImage({
        commands: [
          buildVersionCommand(1),
          dyldEnvironmentCommand(setting),
          dylibCommand(LC.LOAD_DYLIB, "@loader_path/missing.dylib"),
        ],
      }),
    );
    await withClient(async (client) => {
      const opened = await client.callTool({
        name: "open_binary",
        arguments: { path },
      });
      expect(opened.isError, JSON.stringify(opened.structuredContent)).not.toBe(
        true,
      );
      const result = await client.callTool({
        name: "trace_dylib_resolution",
        arguments: {},
      });
      expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(
        true,
      );
      const trace = dylibResolutionResultSchema.parse(
        structuredResult(result.structuredContent),
      );
      expect(trace.edges[0]?.resolution.status).toBe(status);
      expect(trace.coverage.status).toBe(
        status === "undetermined" ? "partial" : "complete",
      );
      expect(
        trace.images.find(({ path }) => path === "program")?.slices[0]
          ?.dyld_environment,
      ).toEqual([setting]);
      expect(
        trace.findings.some(({ kind }) => kind === "required-load-unresolved"),
      ).toBe(status === "unresolved");
    });
  },
);

for (const [root, message] of [
  ["Contents/MacOS/Missing", "is not a regular file"],
  ["Contents/MacOS", "is not a regular file"],
  ["Contents/Info.plist", "is not a Mach-O image"],
  ["Contents/MacOS/outside", "resolves outside the analyzed root"],
] as const) {
  const needsFileSymlink = root === "Contents/MacOS/outside";
  // File symlinks on Windows need Developer Mode or an elevated token.
  it.skipIf(process.platform === "win32" && needsFileSymlink)(
    `reports caller-selected root ${root} as invalid input`,
    async () => {
      const app = join(
        await createTestTempDirectory("rea-dylib-roots-"),
        "Fixture.app",
      );
      await mkdir(join(app, "Contents/MacOS"), { recursive: true });
      await writeFile(
        join(app, "Contents/Info.plist"),
        "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
      );
      await writeFile(
        join(app, "Contents/MacOS/App"),
        machoImage({ commands: [buildVersionCommand(1)] }),
      );
      if (needsFileSymlink) await symlink("/bin/ls", join(app, root));
      await withClient(async (client) => {
        const opened = await client.callTool({
          name: "open_binary",
          arguments: { path: app },
        });
        expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
        const called = await client.callTool({
          name: "trace_dylib_resolution",
          arguments: { roots: ["Contents/MacOS/App", root] },
        });
        expect(called.isError, root).toBe(true);
        expect(parseMcpToolError(called), root).toMatchObject({
          error: {
            code: "invalid_request",
            details: {
              issues: [
                {
                  path: ["roots", 1],
                  reason: "invalid_value",
                  message: expect.stringContaining(`Root ${root} ${message}`),
                },
              ],
            },
          },
        });
      });
    },
  );
}
