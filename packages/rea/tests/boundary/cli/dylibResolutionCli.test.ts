import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect } from "vitest";

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
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import {
  cliTest,
  runFileCli,
  type TestCli,
} from "../../support/cli/cliFixture.js";

const ENVIRONMENT = { REA_LOG_LEVEL: "silent", REA_ANALYSIS_PROVIDER: "auto" };

const writeFiles = async (
  root: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
};

/** A caller-selected root that cannot be traced is an input issue on that root. */
const expectRootInputError = async (
  cli: TestCli,
  {
    app,
    root,
    reason,
    message,
  }: {
    readonly app: string;
    readonly root: string;
    readonly reason: string;
    readonly message: string;
  },
): Promise<void> => {
  const rejected = await runFileCli(cli, {
    arguments: ["trace-dylib-resolution", app, "--root", root, "--json"],
    environment: ENVIRONMENT,
  });
  expect(rejected.exitCode).toBe(1);
  expect(rejected.json).toMatchObject({
    error: "Analysis failed",
    code: "invalid_request",
    details: {
      issues: [
        {
          path: ["roots", 0],
          reason,
          message: expect.stringContaining(message),
        },
      ],
    },
  });
};

const fixtureApp = async (): Promise<string> => {
  const app = join(
    await createTestTempDirectory("rea-dylib-cli-"),
    "Fixture.app",
  );
  await writeFiles(app, {
    "Contents/Info.plist":
      "<plist><dict><key>CFBundleExecutable</key><string>App</string></dict></plist>",
    "Contents/MacOS/App": machoImage({
      commands: [
        buildVersionCommand(1),
        rpathCommand("@executable_path/../Frameworks"),
        dylibCommand(LC.LOAD_DYLIB, "@rpath/libcore.dylib"),
        dylibCommand(LC.LOAD_WEAK_DYLIB, "@rpath/libgone.dylib"),
      ],
    }),
    "Contents/Frameworks/libcore.dylib": machoImage({
      fileType: FILE_TYPE.dylib,
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.ID_DYLIB, "@rpath/libcore.dylib"),
      ],
    }),
    "Contents/Helpers/tool": machoImage({
      commands: [
        buildVersionCommand(1),
        dylibCommand(LC.LOAD_DYLIB, "@loader_path/libnone.dylib"),
      ],
    }),
  });
  return app;
};

const withBrokenHelper = async (app: string): Promise<void> => {
  const broken = machoImage({ commands: [rpathCommand("x")] });
  // cmdsize 0 makes the command table unreadable.
  new DataView(broken.buffer).setUint32(32 + 4, 0, true);
  await writeFiles(app, { "Contents/Helpers/broken": broken });
};

cliTest.skipIf(process.platform !== "linux")(
  "keeps unrepresentable bundle entries from establishing complete executable-root coverage",
  async ({ cli }) => {
    const app = await fixtureApp();
    await writeFile(
      Buffer.concat([
        Buffer.from(`${app}/Contents/Helpers/`),
        Buffer.from([0xff]),
      ]),
      machoImage({}),
    );
    const observed = await runFileCli(cli, {
      arguments: ["trace-dylib-resolution", app, "--json"],
      environment: ENVIRONMENT,
    });
    expect(observed.exitCode, observed.stderr).toBe(0);
    const result = dylibResolutionResultSchema.parse(
      parseEvidence(observed.json).normalized_result,
    );
    expect(result.coverage.status).toBe("partial");
    expect(result.limitations).toContainEqual(
      expect.stringContaining("not valid UTF-8"),
    );
  },
);

cliTest(
  "reports skipped executable-root symlink subtrees as partial discovery",
  async ({ cli }) => {
    const app = await fixtureApp();
    await symlink("unexamined", join(app, "Contents", "LinkedResources"));
    const observed = await runFileCli(cli, {
      arguments: ["trace-dylib-resolution", app, "--json"],
      environment: ENVIRONMENT,
    });
    expect(observed.exitCode, observed.stderr).toBe(0);
    const result = dylibResolutionResultSchema.parse(
      parseEvidence(observed.json).normalized_result,
    );
    expect(result.coverage.status).toBe("partial");
    expect(result.limitations).toContainEqual(
      expect.stringContaining(
        "their root roles and possible descendants are unknown",
      ),
    );
  },
);

cliTest(
  "does not turn U+FEFF-prefixed strings into dyld path tokens",
  async ({ cli }) => {
    const app = await fixtureApp();
    await writeFiles(app, {
      "Contents/MacOS/App": machoImage({
        commands: [
          buildVersionCommand(1),
          rpathCommand("@executable_path/../Frameworks"),
          dylibCommand(LC.LOAD_DYLIB, "@rpath/libcore.dylib"),
          dylibCommand(LC.LOAD_DYLIB, "\uFEFF@rpath/libcore.dylib"),
        ],
      }),
      "Contents/Helpers/tool": machoImage({
        commands: [
          buildVersionCommand(1),
          rpathCommand("\uFEFF@loader_path/../Frameworks"),
          dylibCommand(LC.LOAD_DYLIB, "@rpath/libcore.dylib"),
        ],
      }),
    });
    const output = await runFileCli(cli, {
      arguments: ["trace-dylib-resolution", app, "--json"],
      environment: ENVIRONMENT,
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const trace = dylibResolutionResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    const ordinary = trace.edges.find(
      ({ loader, install_name }) =>
        loader === "Contents/MacOS/App" &&
        install_name === "@rpath/libcore.dylib",
    );
    expect(ordinary?.resolution).toMatchObject({
      status: "resolved",
      image: "Contents/Frameworks/libcore.dylib",
    });
    const marked = trace.edges.find(
      ({ install_name }) => install_name === "\uFEFF@rpath/libcore.dylib",
    );
    expect(marked).toBeDefined();
    expect(marked?.resolution.image).toBeNull();
    const helper = trace.edges.find(
      ({ loader }) => loader === "Contents/Helpers/tool",
    );
    expect(helper).toBeDefined();
    expect(helper?.resolution.image).toBeNull();
  },
);

cliTest(
  "resolves dependency names and rpaths containing Unicode line separators",
  async ({ cli }) => {
    const app = await fixtureApp();
    const library = "lib\u2028core.dylib";
    const directory = "Libraries\u2029Nested";
    await writeFiles(app, {
      "Contents/MacOS/App": machoImage({
        commands: [
          buildVersionCommand(1),
          dylibCommand(LC.LOAD_DYLIB, `@loader_path/${library}`),
          rpathCommand(`@executable_path/${directory}`),
          dylibCommand(LC.LOAD_DYLIB, "@rpath/libsearch.dylib"),
        ],
      }),
      [`Contents/MacOS/${library}`]: machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [buildVersionCommand(1)],
      }),
      [`Contents/MacOS/${directory}/libsearch.dylib`]: machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [buildVersionCommand(1)],
      }),
    });
    const output = await cli.run({
      arguments: [
        "trace-dylib-resolution",
        app,
        "--root",
        "Contents/MacOS/App",
        "--json",
      ],
      environment: ENVIRONMENT,
    });
    expect(output.exitCode, output.stderr).toBe(0);
    const trace = dylibResolutionResultSchema.parse(
      parseEvidence(output.json).normalized_result,
    );
    expect(
      trace.edges.map(({ install_name, resolution }) => ({
        install_name,
        resolution,
      })),
    ).toEqual([
      {
        install_name: `@loader_path/${library}`,
        resolution: {
          status: "resolved",
          image: `Contents/MacOS/${library}`,
        },
      },
      {
        install_name: "@rpath/libsearch.dylib",
        resolution: {
          status: "resolved",
          image: `Contents/MacOS/${directory}/libsearch.dylib`,
        },
      },
    ]);
  },
);

describe("trace-dylib-resolution CLI", () => {
  cliTest("traces every executable root of an app bundle", async ({ cli }) => {
    const app = await fixtureApp();
    const result = await runFileCli(cli, {
      arguments: ["trace-dylib-resolution", app, "--json"],
      environment: ENVIRONMENT,
    });
    expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
    const trace = dylibResolutionResultSchema.parse(
      (result.json as { normalized_result: unknown }).normalized_result,
    );
    expect(trace.root_path).toBe(app);
    expect(trace.roots.map(({ image }) => image)).toEqual([
      "Contents/Helpers/tool",
      "Contents/MacOS/App",
    ]);
    // The normalized result is the provider's only representation; Evidence
    // must not carry it a second time as raw_result.
    expect(result.json).toMatchObject({ raw_result: null });
    expect(
      trace.edges.map(({ loader, install_name: name, resolution }) => [
        loader,
        name,
        resolution.status,
        resolution.image,
      ]),
    ).toEqual([
      [
        "Contents/Helpers/tool",
        "@loader_path/libnone.dylib",
        "unresolved",
        null,
      ],
      [
        "Contents/MacOS/App",
        "@rpath/libcore.dylib",
        "resolved",
        "Contents/Frameworks/libcore.dylib",
      ],
      ["Contents/MacOS/App", "@rpath/libgone.dylib", "unresolved", null],
    ]);
    expect(trace.findings.map(({ kind }) => kind)).toEqual([
      "required-load-unresolved",
      "weak-load-unresolved",
    ]);
    expect(
      trace.images.every(({ sha256 }) => /^[0-9a-f]{64}$/u.test(sha256)),
    ).toBe(true);
  });

  cliTest(
    "narrows roots and architecture, and rejects escaping roots",
    async ({ cli }) => {
      const app = await fixtureApp();
      const narrowed = await runFileCli(cli, {
        arguments: [
          "trace-dylib-resolution",
          app,
          "--root",
          "Contents/MacOS/App",
          "--architecture",
          "arm64",
          "--json",
        ],
        environment: ENVIRONMENT,
      });
      expect(narrowed.exitCode).toBe(0);
      expect(
        (narrowed.json as { normalized_result: { roots: unknown } })
          .normalized_result.roots,
      ).toEqual([{ image: "Contents/MacOS/App", architecture: "arm64" }]);
      // A root below a symlinked directory that points outside the bundle.
      const outside = await createTestTempDirectory("rea-dylib-outside-");
      await writeFiles(outside, { Tool: machoImage({}) });
      await symlink(outside, join(app, "Contents/Linked"), "dir");
      for (const [root, reason, message] of [
        ["../outside", "invalid_format", "Use a normalized path"],
        ["Contents/Info.plist", "invalid_value", "is not a Mach-O image"],
        [
          "Contents/Linked/Tool",
          "invalid_value",
          // Windows link text is outside the POSIX dyld path representation.
          process.platform === "win32"
            ? "is not a regular file in the analyzed root"
            : "resolves outside the analyzed root",
        ],
      ] as const) {
        await expectRootInputError(cli, { app, root, reason, message });
      }
    },
  );

  cliTest(
    "resolves a standalone Mach-O against its own directory",
    async ({ cli }) => {
      const directory = await createTestTempDirectory("rea-dylib-standalone-");
      await writeFiles(directory, {
        tool: machoImage({
          commands: [
            buildVersionCommand(1),
            dylibCommand(LC.LOAD_DYLIB, "@loader_path/lib/libhelper.dylib"),
            dylibCommand(LC.LOAD_DYLIB, "@loader_path/../escape.dylib"),
          ],
        }),
        "lib/libhelper.dylib": machoImage({
          fileType: FILE_TYPE.dylib,
          commands: [buildVersionCommand(1)],
        }),
        "unrelated.txt": "not traversed",
      });
      const result = await runFileCli(cli, {
        arguments: [
          "trace-dylib-resolution",
          join(directory, "tool"),
          "--json",
        ],
        environment: ENVIRONMENT,
      });
      expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
      const trace = dylibResolutionResultSchema.parse(
        (result.json as { normalized_result: unknown }).normalized_result,
      );
      expect(trace.roots).toEqual([{ image: "tool", architecture: "arm64" }]);
      expect(trace.edges.map(({ resolution }) => resolution)).toEqual([
        { status: "resolved", image: "lib/libhelper.dylib" },
        { status: "undetermined", image: null },
      ]);
    },
  );

  cliTest(
    "reports unparsed Mach-O files found while enumerating roots",
    async ({ cli }) => {
      const app = await fixtureApp();
      await withBrokenHelper(app);
      const result = await runFileCli(cli, {
        arguments: ["trace-dylib-resolution", app, "--json"],
        environment: ENVIRONMENT,
      });
      expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
      const trace = dylibResolutionResultSchema.parse(
        (result.json as { normalized_result: unknown }).normalized_result,
      );
      expect(trace.coverage).toMatchObject({
        status: "partial",
        unparsed_images: ["Contents/Helpers/broken"],
      });
    },
  );
});

cliTest(
  "rejects build-version tool records outside their load command",
  async ({ cli }) => {
    const app = await fixtureApp();
    const withTool = new Uint8Array(32);
    withTool.set(buildVersionCommand(0xffffffff));
    const toolView = new DataView(withTool.buffer);
    toolView.setUint32(4, 32, true);
    toolView.setUint32(20, 1, true);
    toolView.setUint32(24, 3, true);
    toolView.setUint32(28, 0x10000, true);

    const missingTool = buildVersionCommand(1);
    new DataView(missingTool.buffer).setUint32(20, 1, true);
    const excessiveTools = buildVersionCommand(1);
    new DataView(excessiveTools.buffer).setUint32(20, 0xffffffff, true);
    const missingSecondTool = withTool.slice();
    new DataView(missingSecondTool.buffer).setUint32(20, 2, true);
    const shortHeader = buildVersionCommand(1).slice(0, 16);
    new DataView(shortHeader.buffer).setUint32(4, 16, true);
    const cases = [
      ["no-tools", [buildVersionCommand(1)], "parsed"],
      ["one-tool", [withTool], "parsed"],
      // The following command and the image's trailing bytes cannot satisfy ntools.
      ["missing-tool", [missingTool, rpathCommand("x")], "malformed"],
      ["excessive-tools", [excessiveTools], "malformed"],
      ["missing-second-tool", [missingSecondTool], "malformed"],
      ["short-header", [shortHeader], "malformed"],
    ] as const;
    for (const [name, commands] of cases) {
      await writeFiles(app, {
        [`Contents/Helpers/${name}`]: machoImage({ commands }),
      });
    }

    const result = await runFileCli(cli, {
      arguments: ["trace-dylib-resolution", app, "--json"],
      environment: ENVIRONMENT,
    });
    expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
    const trace = dylibResolutionResultSchema.parse(
      (result.json as { normalized_result: unknown }).normalized_result,
    );
    for (const [name, , status] of cases) {
      const path = `Contents/Helpers/${name}`;
      const image = trace.images.find((item) => item.path === path);
      expect(image, name).toMatchObject({ parse_status: status });
      if (status === "malformed") {
        expect(image).toMatchObject({
          reason: expect.stringContaining("LC_BUILD_VERSION"),
          slices: [],
        });
        expect(trace.roots.some((root) => root.image === path)).toBe(false);
        expect(trace.coverage.unparsed_images).toContain(path);
      } else {
        expect(image).toMatchObject({
          reason: null,
          slices: [{ platforms: [name === "one-tool" ? 0xffffffff : 1] }],
        });
      }
    }
    expect(trace.coverage.status).toBe("partial");
  },
);

cliTest(
  "retains directory requirements when resolving dylib install names",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-dylib-path-cli-");
    const names = [
      "@loader_path/lib/libhelper.dylib/",
      "@loader_path/lib/libhelper.dylib/.",
      "@rpath/libhelper.dylib/",
      "@rpath/libhelper.dylib/.",
      "@rpath/",
      "@loader_path/lib/./libhelper.dylib",
      "@loader_path/lib//libhelper.dylib",
    ];
    await writeFiles(directory, {
      tool: machoImage({
        commands: [
          buildVersionCommand(1),
          rpathCommand("@loader_path/lib/libhelper.dylib"),
          rpathCommand("@loader_path/lib"),
          ...names.map((name) => dylibCommand(LC.LOAD_DYLIB, name)),
        ],
      }),
      "lib/libhelper.dylib": machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [buildVersionCommand(1)],
      }),
    });
    const result = await runFileCli(cli, {
      arguments: ["trace-dylib-resolution", join(directory, "tool"), "--json"],
      environment: ENVIRONMENT,
    });
    expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
    const trace = dylibResolutionResultSchema.parse(
      parseEvidence(result.json).normalized_result,
    );
    expect(
      trace.edges.map(({ install_name, candidates, resolution }) => ({
        install_name,
        outcome: candidates[0]?.outcome,
        resolution,
      })),
    ).toEqual(
      names.map((name, index) => ({
        install_name: name,
        outcome: index < 5 ? "absent" : "resolved",
        resolution:
          index < 5
            ? { status: "unresolved", image: null }
            : { status: "resolved", image: "lib/libhelper.dylib" },
      })),
    );
    expect(
      trace.findings.map(({ kind, edge_index }) => [kind, edge_index]),
    ).toEqual(
      [0, 1, 2, 3, 4].map((index) => ["required-load-unresolved", index]),
    );
  },
);

// This permission fixture requires POSIX mode bits and a non-root caller.
describe.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "trace-dylib-resolution permissions",
  () => {
    cliTest(
      "reports an unreadable dependency as a permission failure",
      async ({ cli }) => {
        const directory = await createTestTempDirectory("rea-dylib-denied-");
        await writeFiles(directory, {
          tool: machoImage({
            commands: [
              dylibCommand(LC.LOAD_DYLIB, "@loader_path/libsecret.dylib"),
            ],
          }),
          "libsecret.dylib": machoImage({ fileType: FILE_TYPE.dylib }),
        });
        await chmod(join(directory, "libsecret.dylib"), 0o000);
        try {
          const result = await runFileCli(cli, {
            arguments: [
              "trace-dylib-resolution",
              join(directory, "tool"),
              "--json",
            ],
            environment: ENVIRONMENT,
          });
          expect(result.exitCode).toBe(1);
          expect(result.json).toMatchObject({
            details: {
              reason: "unavailable",
              detail: expect.stringContaining(
                "Permission denied (EACCES) reading libsecret.dylib",
              ),
            },
          });
        } finally {
          await chmod(join(directory, "libsecret.dylib"), 0o644);
        }
      },
    );
  },
);

cliTest(
  "reports embedded path overrides as conditional without changing diagnostic-only resolution",
  async ({ cli }) => {
    for (const [setting, expected] of [
      ["DYLD_LIBRARY_PATH=/external", "conditional"],
      ["DYLD_PRINT_LIBRARIES=1", "resolved"],
      ["DYLD_FALLBACK_LIBRARY_PATH=/external", "resolved"],
      ["DYLD_FRAMEWORK_PATH=/external", "resolved"],
      ["DYLD_ROOT_PATH=/external", "resolved"],
      ["DYLD_OVERLAY_PATH=/external", "resolved"],
    ] as const) {
      const app = await fixtureApp();
      await writeFiles(app, {
        "Contents/MacOS/App": machoImage({
          commands: [
            dyldEnvironmentCommand(setting),
            buildVersionCommand(1),
            rpathCommand("@executable_path/../Absent"),
            rpathCommand("@executable_path/../Frameworks"),
            dylibCommand(LC.LOAD_DYLIB, "@rpath/libcore.dylib"),
          ],
        }),
      });
      const result = await runFileCli(cli, {
        arguments: [
          "trace-dylib-resolution",
          app,
          "--root",
          "Contents/MacOS/App",
          "--json",
        ],
        environment: ENVIRONMENT,
      });
      expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
      const trace = dylibResolutionResultSchema.parse(
        parseEvidence(result.json).normalized_result,
      );
      expect(trace.edges[0]?.resolution.status).toBe(expected);
      expect(trace.coverage.status).toBe(
        expected === "conditional" ? "partial" : "complete",
      );
      expect(
        trace.images.find(({ path }) => path === "Contents/MacOS/App")
          ?.slices[0]?.dyld_environment,
      ).toEqual([setting]);
      if (expected === "conditional")
        expect(trace.findings[0]?.explanation).toContain(
          "does not establish which image dyld will load",
        );
    }
  },
);

cliTest(
  "preserves exact architecture labels and each same-named slice's dyld environment",
  async ({ cli }) => {
    // Capability variants can share arm64e's display name, while .x1 stays exact.
    // A plain x86_64 slice keeps the bundle openable on x64 hosts.
    for (const [settings, expected] of [
      [[null, null, "DYLD_PRINT_RPATHS=1"], ["DYLD_PRINT_RPATHS=1"]],
      [
        [
          "DYLD_PRINT_LIBRARIES=1",
          "DYLD_PRINT_RPATHS=1",
          "DYLD_PRINT_BINDINGS=1",
        ],
        [
          "DYLD_PRINT_LIBRARIES=1",
          "DYLD_PRINT_RPATHS=1",
          "DYLD_PRINT_BINDINGS=1",
        ],
      ],
    ] as const) {
      const app = await fixtureApp();
      await writeFiles(app, {
        "Contents/MacOS/App": fatImage([
          ...[
            CPU.arm64e,
            CPU.arm64eX1,
            { type: CPU.arm64.type, subtype: 0x81000002 },
          ].map((cpu, index) => {
            const setting = settings[index];
            return {
              cpu,
              bytes: machoImage({
                cpu,
                commands:
                  setting === null || setting === undefined
                    ? []
                    : [dyldEnvironmentCommand(setting)],
              }),
            };
          }),
          { cpu: CPU.x86_64, bytes: machoImage({ cpu: CPU.x86_64 }) },
        ]),
      });
      const result = await runFileCli(cli, {
        arguments: [
          "trace-dylib-resolution",
          app,
          "--root",
          "Contents/MacOS/App",
          "--architecture",
          "arm64e",
          "--json",
        ],
        environment: ENVIRONMENT,
      });
      expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
      const trace = dylibResolutionResultSchema.parse(
        parseEvidence(result.json).normalized_result,
      );
      expect(trace.roots.map(({ architecture }) => architecture)).toEqual([
        "arm64e",
        "arm64e.x1",
        "arm64e",
      ]);
      const environments = trace.findings
        .filter(({ kind }) => kind === "dyld-environment-present")
        .map(({ explanation }) =>
          expected.filter((setting) => explanation.includes(setting)),
        );
      expect(environments).toEqual(expected.map((setting) => [setting]));
    }
  },
);

cliTest(
  "retains definitive load findings for an explicitly selected app library root",
  async ({ cli }) => {
    const app = await fixtureApp();
    const settings = [
      "DYLD_LIBRARY_PATH=/external",
      "DYLD_INSERT_LIBRARIES=/external/injected.dylib",
    ];
    await writeFiles(app, {
      "Contents/Frameworks/libcore.dylib": machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [
          buildVersionCommand(1),
          ...settings.map(dyldEnvironmentCommand),
          dylibCommand(LC.LOAD_DYLIB, "@loader_path/child.dylib"),
          dylibCommand(LC.LOAD_DYLIB, "@loader_path/missing.dylib"),
        ],
      }),
      "Contents/Frameworks/child.dylib": machoImage({
        fileType: FILE_TYPE.dylib,
        commands: [buildVersionCommand(1)],
      }),
    });
    const result = await runFileCli(cli, {
      arguments: [
        "trace-dylib-resolution",
        app,
        "--root",
        "Contents/Frameworks/libcore.dylib",
        "--json",
      ],
      environment: ENVIRONMENT,
    });
    expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
    const trace = dylibResolutionResultSchema.parse(
      parseEvidence(result.json).normalized_result,
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
      trace.images.find(
        ({ path }) => path === "Contents/Frameworks/libcore.dylib",
      )?.slices[0]?.dyld_environment,
    ).toEqual(settings);
    expect(
      trace.findings.find(({ kind }) => kind === "dyld-environment-present")
        ?.explanation,
    ).toContain("entries in this non-executable root are observations");
  },
);

cliTest(
  "distinguishes empty search directories from empty versioned or suffix lists",
  async ({ cli }) => {
    for (const [setting, status] of [
      ["DYLD_FALLBACK_LIBRARY_PATH=", "undetermined"],
      ["DYLD_VERSIONED_LIBRARY_PATH=", "unresolved"],
      ["DYLD_IMAGE_SUFFIX=:", "unresolved"],
    ] as const) {
      const root = await createTestTempDirectory("rea-dyld-empty-cli-");
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
      const result = await runFileCli(cli, {
        arguments: ["trace-dylib-resolution", path, "--json"],
        environment: ENVIRONMENT,
      });
      expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
      const trace = dylibResolutionResultSchema.parse(
        parseEvidence(result.json).normalized_result,
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
    }
  },
);

/** An app bundle whose roots sit among more files than one batch of magic reads. */
const crowdedApp = async (): Promise<string> => {
  const app = await fixtureApp();
  await withBrokenHelper(app);
  const resources: Record<string, string | Uint8Array> = {};
  for (let index = 0; index < 40; index += 1)
    resources[`Contents/Resources/r${index % 4}/file${index}.dat`] = "x".repeat(
      index % 5,
    );
  for (const index of [0, 1, 2])
    resources[`Contents/Resources/r${index}/tool${index}`] = machoImage({
      commands: [buildVersionCommand(1)],
    });
  resources["Contents/Resources/r3/libextra.dylib"] = machoImage({
    fileType: FILE_TYPE.dylib,
  });
  await writeFiles(app, resources);
  return app;
};

describe("trace-dylib-resolution root enumeration", () => {
  cliTest(
    "classifies every Mach-O among more files than one batch of magic reads",
    async ({ cli }) => {
      const app = await crowdedApp();
      const result = await runFileCli(cli, {
        arguments: ["trace-dylib-resolution", app, "--json"],
        environment: ENVIRONMENT,
      });
      expect(result.exitCode, JSON.stringify(result.json)).toBe(0);
      const trace = dylibResolutionResultSchema.parse(
        (result.json as { normalized_result: unknown }).normalized_result,
      );
      expect(trace.roots.map(({ image }) => image)).toEqual([
        "Contents/Helpers/tool",
        "Contents/MacOS/App",
        "Contents/Resources/r0/tool0",
        "Contents/Resources/r1/tool1",
        "Contents/Resources/r2/tool2",
      ]);
      expect(trace.coverage).toMatchObject({
        status: "partial",
        unparsed_images: ["Contents/Helpers/broken"],
      });
    },
  );

  // This permission fixture requires POSIX mode bits and a non-root caller.
  cliTest.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports an unreadable bundle file found while enumerating roots",
    async ({ cli }) => {
      const app = await crowdedApp();
      const secret = join(app, "Contents/Resources/r2/secret.dat");
      await writeFile(secret, "x");
      await chmod(secret, 0o000);
      try {
        const result = await runFileCli(cli, {
          arguments: ["trace-dylib-resolution", app, "--json"],
          environment: ENVIRONMENT,
        });
        expect(result.exitCode).toBe(1);
        expect(result.json).toMatchObject({
          details: {
            reason: "unavailable",
            detail: expect.stringContaining(
              "Permission denied (EACCES) reading Contents/Resources/r2/secret.dat",
            ),
          },
        });
      } finally {
        await chmod(secret, 0o644);
      }
    },
  );
});
