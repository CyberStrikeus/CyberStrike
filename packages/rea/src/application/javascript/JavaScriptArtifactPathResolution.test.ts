import { describe, expect, it } from "vitest";

import {
  resolveArtifactPathByContext,
  type ResolveArtifactPathInput,
} from "./JavaScriptArtifactPathResolution.js";
import { JavaScriptJsonDocuments } from "./JavaScriptJsonDocuments.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { artifactLocalIdentity } from "./JavaScriptArtifactGraphContext.js";
import { applicationNodeIdentitySchema } from "../../domain/javascript/javascriptApplicationEvidenceSchemas.js";
import { analyzeJavaScriptStaticSource } from "../../domain/javascript/javascriptStaticAnalysis.js";

const completeInventoryCoverage = {
  scope: "container-entries",
  status: "complete",
} as const;

describe("incomplete inventory lookups", () => {
  it.each(["complete", "unknown"] as const)(
    "qualifies missing candidates before extension fallbacks under %s traversal",
    (status) => {
      const files = fileMap([
        file("app/main.cjs", "root"),
        file("app/target.js", "root"),
      ]);
      const unanalyzedFiles = {
        coverage: { scope: "container-entries" as const, status },
        get: () => undefined,
        hasDirectory: () => false,
      };
      expect(
        resolve({
          declaredPath: "./target",
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files,
          unanalyzedFiles,
        }),
      ).toMatchObject(
        status === "complete"
          ? { resolution_status: "resolved", resolved_path: "app/target.js" }
          : {
              resolution_status: "unavailable",
              resolved_path: null,
              candidate_path: "app/target",
            },
      );
      expect(
        resolve({
          declaredPath: "./target.js",
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files,
          unanalyzedFiles,
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: "app/target.js",
      });
      expect(
        resolve({
          declaredPath: "./missing.js",
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files,
          unanalyzedFiles,
        }),
      ).toMatchObject({
        resolution_status: status === "complete" ? "not-found" : "unavailable",
        resolved_path: null,
      });
    },
  );
});

describe("Windows CommonJS request classification", () => {
  it.each([
    "..\\shared\\window.cjs",
    ".\\window.cjs",
    "fixture\\window.cjs",
    "C:shared\\window.cjs",
  ])(
    "retains unknown Windows CommonJS request semantics for %s",
    (declaredPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files: fileMap([
            file("app/main.cjs", "root"),
            file("app/window.cjs", "root"),
            file("shared/window.cjs", "root"),
          ]),
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: "unavailable",
        resolved_path: null,
      });
    },
  );

  it.each([
    "node:\\fs",
    "node:fs\\extra",
    "https:\\example.invalid\\window.cjs",
  ])(
    "does not treat the rejected scheme request %s as an unknown Windows path",
    (declaredPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files: fileMap([file("app/main.cjs", "root")]),
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: "rejected",
        resolved_path: null,
      });
    },
  );

  it("keeps rejected and URL-owned backslash requests distinct from CommonJS host syntax", () => {
    const files = fileMap([
      file("app/main.cjs", "root"),
      file("app/window.cjs", "root"),
    ]);
    for (const [declaredPath, moduleKind, status, resolvedPath] of [
      [".\\window\0.cjs", "require", "rejected", null],
      [".\\window.cjs", "import", "rejected", null],
      ["./window.cjs", "require", "resolved", "app/window.cjs"],
      ["node:fs", "require", "external", null],
    ] as const)
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({
        resolution_status: status,
        resolved_path: resolvedPath,
      });
  });
});

describe("relative ESM URL separators", () => {
  it.each([
    ["./dir\\dep.mjs", "resolved", "app/dir/dep.mjs"],
    ["../shared\\dep.mjs", "resolved", "shared/dep.mjs"],
    ["./unused\\..\\dir\\dep.mjs", "resolved", "app/dir/dep.mjs"],
    ["./..\\..\\outside.mjs", "rejected", null],
    ["./dir%5cdep.mjs", "rejected", null],
    ["./dir%2fdep.mjs", "rejected", null],
    ["./dir\\dep%00.mjs", "rejected", null],
    [".\\dir\\dep.mjs", "rejected", null],
  ] as const)(
    "resolves %s with module URL rules",
    (declaredPath, status, target) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.mjs",
          context: "module-specifier",
          moduleKind: "import",
          files: fileMap([
            file("app/main.mjs", "root"),
            file("app/dir/dep.mjs", "root"),
            file("shared/dep.mjs", "root"),
            file("outside.mjs", "root"),
          ]),
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: status,
        resolved_path: target,
      });
    },
  );
});

describe("literal POSIX inventory base segments", () => {
  it("validates the final URL after a parent reference removes the encoded base segment", () => {
    expect(
      resolve({
        declaredPath: "../b.js",
        sourcePath: "literal\\dir/a.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files: fileMap([file("b.js", "container")]),
      }),
    ).toMatchObject({ resolution_status: "resolved", resolved_path: "b.js" });
  });
  it.each(
    ["literal\\dir", "resources/app.asar/literal\\dir"].flatMap((directory) =>
      (["import", "require", "compiler-dependent"] as const).map(
        (moduleKind) => ({ directory, moduleKind }),
      ),
    ),
  )(
    "preserves loader-specific admission from $directory with mode $moduleKind",
    ({ directory, moduleKind }) => {
      const sourcePath = `${directory}/a.js`;
      const target = `${directory}/b.js`;
      const files = fileMap([
        file(sourcePath, "container"),
        file(target, "container"),
        file(`${directory.replaceAll("\\", "/")}/b.js`, "container"),
      ]);
      expect(
        resolve({
          declaredPath: "./b.js",
          sourcePath,
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({
        resolution_status:
          moduleKind === "require"
            ? "resolved"
            : moduleKind === "import"
              ? "rejected"
              : "unavailable",
        resolved_path: moduleKind === "require" ? target : null,
        ...(moduleKind === "compiler-dependent"
          ? {
              conditional_resolutions: [
                expect.objectContaining({
                  mode: "import",
                  resolution_status: "rejected",
                  resolved_path: null,
                }),
                expect.objectContaining({
                  mode: "require",
                  resolution_status: "resolved",
                  resolved_path: target,
                }),
              ],
            }
          : {}),
      });
    },
  );

  it.each([
    "./bad%5Cb.js",
    "./bad%2Fb.js",
    "./bad%00b.js",
    "./bad%xxb.js",
    ".\\b.js",
  ])(
    "still rejects newly declared unsafe module URL syntax %s inside a literal inventory directory",
    (declaredPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "literal\\dir/a.js",
          context: "module-specifier",
          moduleKind: "import",
          files: fileMap([file("literal\\dir/b.js", "container")]),
        }),
      ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
    },
  );

  it.each([
    "./discard%5C/../b.js",
    "./discard%2F/../b.js",
    "./discard%00/../b.js",
    "./discard%xx/../b.js",
  ])(
    "still rejects inherited encoded separators after normalizing discarded request segments: %s",
    (declaredPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "literal\\dir/a.js",
          context: "module-specifier",
          moduleKind: "import",
          files: fileMap([file("literal\\dir/b.js", "container")]),
        }),
      ).toMatchObject({
        resolution_status: "rejected",
        resolved_path: null,
      });
    },
  );
});

describe("runtime host path classification", () => {
  it.each([
    "/discard%2F/../shared/window.cjs",
    "/discard%5C/../shared/window.cjs",
    "/discard%00/../shared/window.cjs",
    "/discard%xx/../shared/window.cjs",
  ])(
    "normalizes discarded absolute URL segments before pathname validation: %s",
    (declaredPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.mjs",
          context: "module-specifier",
          moduleKind: "import",
          files: new Map(),
        }),
      ).toMatchObject({
        resolution_status: "unavailable",
        resolved_path: null,
      });
    },
  );
  it("normalizes discarded relative URL segments before pathname validation", () => {
    expect(
      resolve({
        declaredPath: "./discard%2F/../window.cjs",
        sourcePath: "app/main.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files: fileMap([file("app/window.cjs", "root")]),
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/window.cjs",
    });
  });
  it("retains unknown URL identity for an unpaired source directory segment", () => {
    expect(
      resolve({
        declaredPath: "./window.cjs",
        sourcePath: "app/\ud800/main.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files: new Map(),
      }),
    ).toMatchObject({ resolution_status: "unavailable", resolved_path: null });
  });
  it.each([
    "/shared%2Fwindow.mjs",
    "/shared%5cwindow.mjs",
    "/shared%00window.mjs",
    "/shared%xxwindow.mjs",
  ])(
    "rejects invalid absolute ESM URL path syntax before host lookup: %s",
    (declaredPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.mjs",
          context: "module-specifier",
          moduleKind: "import",
          files: new Map(),
        }),
      ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files: new Map(),
        }),
      ).toMatchObject({
        resolution_status: "unavailable",
        resolved_path: null,
      });
    },
  );
  it("keeps encoded query bytes outside ESM pathname admission", () => {
    expect(
      resolve({
        declaredPath: "/shared/window.mjs?token=%2F#fragment",
        sourcePath: "app/main.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files: new Map(),
      }),
    ).toMatchObject({ resolution_status: "unavailable", resolved_path: null });
  });
  it.each(["exact-file", "application-file", "node-entrypoint"] as const)(
    "keeps POSIX and Windows absolute %s paths unavailable before canonical admission",
    (runtimePathKind) => {
      for (const declaredPath of [
        "/opt/app/main.cjs",
        "C:/app/main.cjs",
        "C:\\app\\main.cjs",
        "\\\\server\\share\\main.cjs",
        "//server/share/main.cjs",
        "\\app\\main.cjs",
      ])
        expect(
          resolve({
            declaredPath,
            sourcePath: "app/package.json",
            context: "filesystem-expression",
            runtimePathKind,
            files: fileMap([
              file("opt/app/main.cjs", "root"),
              file("app/main.cjs", "root"),
            ]),
          }),
        ).toMatchObject({
          resolution_status: "unavailable",
          resolved_path: null,
          declared_path: declaredPath,
        });
      expect(
        resolve({
          declaredPath: "C:/app/\0main.cjs",
          sourcePath: "app/main.cjs",
          context: "filesystem-expression",
          runtimePathKind,
          files: new Map(),
        }),
      ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
    },
  );
});

describe("artifact URI scheme classification", () => {
  it.each(["entry:prod.cjs", "entry:prod%2Fname.cjs"])(
    "retains package main filename bytes for %s without URI classification",
    (declaredPath) => {
      const files = fileMap([
        file("app/package.json", "root"),
        file(`app/${declaredPath}`, "root"),
      ]);
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/package.json",
          context: "package-entrypoint",
          runtimePathKind: "node-entrypoint",
          files,
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: "resolved",
        resolved_path: `app/${declaredPath}`,
      });
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/package.json",
          context: "module-specifier",
          moduleKind: "require",
          files,
        }),
      ).toMatchObject({ resolution_status: "external", resolved_path: null });
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/package.json",
          context: "package-entrypoint",
          runtimePathKind: "node-entrypoint",
          files: fileMap([file("app/package.json", "root")]),
        }),
      ).toMatchObject({
        resolution_status: "not-found",
        resolved_path: null,
        candidate_path: `app/${declaredPath}`,
      });
    },
  );

  it.each(["require", "import"] as const)(
    "resolves a colon-bearing dependency package main with the %s loader",
    (moduleKind) => {
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind,
          files: fileMap([
            file("app/main.cjs", "root"),
            file(
              "app/node_modules/fixture/package.json",
              "root",
              '{"main":"entry:prod.cjs"}',
            ),
            file("app/node_modules/fixture/entry:prod.cjs", "root"),
            file("app/node_modules/fixture/index.js", "root"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: "app/node_modules/fixture/entry:prod.cjs",
      });
    },
  );

  it.each(["html-reference", "module-specifier", "url-reference"] as const)(
    "keeps digit-bearing schemes external in %s even when a local file matches",
    (context) => {
      const files = fileMap([
        file("index.html", "root"),
        file("web3:app.js", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "web3:app.js",
          sourcePath: "index.html",
          context,
          files,
        }),
      ).toMatchObject({ resolution_status: "external", resolved_path: null });
    },
  );

  it("keeps references under a digit-bearing external base href external", () => {
    const files = fileMap([
      file("index.html", "root"),
      file("web3:assets/app.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "app.js",
        sourcePath: "index.html",
        context: "html-reference",
        htmlBaseHref: "web3:assets/",
        files,
      }),
    ).toMatchObject({ resolution_status: "external", resolved_path: null });
  });
});

describe("artifact-local graph identity", () => {
  it("preserves complete long namespace and key values", () => {
    const digest = "a".repeat(64);
    const namespacePrefix = "n".repeat(512);
    const keyPrefix = "k".repeat(4_096);
    const first = artifactLocalIdentity(
      digest,
      `${namespacePrefix}a`,
      `${keyPrefix}a`,
    );
    const second = artifactLocalIdentity(
      digest,
      `${namespacePrefix}b`,
      `${keyPrefix}b`,
    );

    expect(applicationNodeIdentitySchema.parse(first)).toEqual(first);
    expect(applicationNodeIdentitySchema.parse(second)).toEqual(second);
    expect(first).not.toEqual(second);
  });
});

describe("loader-owned path lookup", () => {
  it("applies URL whitespace handling only to ESM lookup and retains declarations", () => {
    const tab = "\t";
    const files = fileMap([
      file("app/entry.mjs", "root"),
      file("app/feature.js", "root"),
      file(`app/tab${tab}name.js`, "root"),
    ]);
    for (const whitespace of ["\t", "\n", "\r"]) {
      const raw = `./fea${whitespace}ture.js`;
      expect(
        resolve({
          declaredPath: raw,
          sourcePath: "app/entry.mjs",
          context: "module-specifier",
          moduleKind: "import",
          files,
        }),
      ).toMatchObject({ declared_path: raw, resolved_path: "app/feature.js" });
    }
    expect(
      resolve({
        declaredPath: `./tab${tab}name.js`,
        sourcePath: "app/entry.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({ resolved_path: null });
    expect(
      resolve({
        declaredPath: `./tab${tab}name.js`,
        sourcePath: "app/entry.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({ resolved_path: "app/tab\tname.js" });
    expect(
      resolve({
        declaredPath: "./tab%09name.js",
        sourcePath: "app/entry.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({ resolved_path: "app/tab\tname.js" });
  });
});

describe("loader-specific module suffix lookup", () => {
  it("keeps relative ESM imports exact", () => {
    const files = fileMap([
      file("app/entry.mjs", "root"),
      file("app/feature.js", "root"),
      file("app/directory/index.js", "root"),
      file("app/feature.js.js", "root"),
    ]);
    for (const declaredPath of ["./feature", "./directory"]) {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/entry.mjs",
          context: "module-specifier",
          moduleKind: "import",
          files,
        }),
      ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
    }
    expect(
      resolve({
        declaredPath: "./feature.js",
        sourcePath: "app/entry.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({ resolved_path: "app/feature.js" });
  });

  it("does not use .cjs as an extensionless CommonJS probe", () => {
    const files = fileMap([
      file("app/entry.cjs", "root"),
      file("app/feature.cjs", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "./feature",
        sourcePath: "app/entry.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
    expect(
      resolve({
        declaredPath: "./feature.cjs",
        sourcePath: "app/entry.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({ resolved_path: "app/feature.cjs" });
  });

  it("keeps present opaque inventory files distinct from missing module targets", () => {
    const opaque = new Map([
      [
        "app/core.jsc",
        {
          path: "app/core.jsc",
          container_sha256: file("app/entry.cjs", "root").container_sha256,
          sha256: "a".repeat(64),
          bytes: 7,
          inventory_artifact_id: "opaque-core",
        },
      ],
    ]);
    const files = fileMap([file("app/entry.cjs", "root")]);
    const unanalyzedFiles = {
      get: (path: string) => opaque.get(path),
      coverage: completeInventoryCoverage,
      hasDirectory: () => false,
    };
    expect(
      resolve({
        declaredPath: "./core.jsc",
        sourcePath: "app/entry.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files,
        unanalyzedFiles,
      }),
    ).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
      candidate_path: "app/core.jsc",
      limitations: [
        expect.stringContaining(`sha256 ${"a".repeat(64)}, 7 bytes`),
      ],
    });
    expect(
      resolve({
        declaredPath: "./missing.jsc",
        sourcePath: "app/entry.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files,
        unanalyzedFiles,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
    expect(
      resolve({
        declaredPath: "./core.jsc",
        sourcePath: "app/entry.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files,
        unanalyzedFiles: {
          ...unanalyzedFiles,
          get: (path: string) =>
            path === "app/core.jsc"
              ? {
                  ...opaque.get(path)!,
                  container_sha256: "b".repeat(64),
                }
              : undefined,
        },
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
  });
});

describe("unavailable inventoried native add-ons", () => {
  it("retains an inventoried native add-on whose bytes are unavailable", () => {
    const unavailable = {
      path: "app/addon.node",
      container_sha256: file("app/entry.cjs", "root").container_sha256,
      sha256: null,
      bytes: 8192,
      inventory_artifact_id: null,
      inventory_occurrence_id: "missing-addon-occurrence",
      kind: "native-addon" as const,
      hash_status: "unavailable" as const,
      limitations: ["unpacked companion is missing"],
    };
    const result = resolve({
      declaredPath: "./addon.node",
      sourcePath: "app/entry.cjs",
      context: "module-specifier",
      moduleKind: "require",
      files: fileMap([file("app/entry.cjs", "root")]),
      unanalyzedFiles: {
        get: (path) => (path === unavailable.path ? unavailable : undefined),
        coverage: completeInventoryCoverage,
        hasDirectory: () => false,
      },
    });
    expect(result).toMatchObject({
      declared_path: "./addon.node",
      resolution_status: "unavailable",
      candidate_path: "app/addon.node",
      limitations: [
        "unpacked companion is missing",
        expect.stringContaining("inventoried native-addon file"),
      ],
    });
  });
});

describe("unavailable package metadata", () => {
  it("blocks directory fallback until same-container manifests are readable", () => {
    const manifest = {
      path: "app/relative/package.json",
      container_sha256: file("app/main.cjs", "root").container_sha256,
      sha256: null,
      bytes: 28,
      inventory_artifact_id: null,
      inventory_occurrence_id: "missing-relative-manifest",
      kind: "package-json" as const,
      hash_status: "unavailable" as const,
      limitations: ["unpacked manifest companion is missing"],
    };
    const files = fileMap([
      file("app/main.cjs", "root"),
      file("app/main.mjs", "root"),
      file("app/relative/index.js", "root"),
    ]);
    const requestedPaths: string[] = [];
    const lookup = {
      get: (path: string) => {
        requestedPaths.push(path);
        return path === manifest.path ? manifest : undefined;
      },
      coverage: completeInventoryCoverage,
      hasDirectory: () => false,
    };
    const relativeRequire = resolve({
      declaredPath: "./relative",
      sourcePath: "app/main.cjs",
      context: "module-specifier",
      moduleKind: "require",
      files,
      unanalyzedFiles: lookup,
    });
    expect(requestedPaths).toContain(manifest.path);
    expect(relativeRequire).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
      limitations: ["unpacked manifest companion is missing"],
    });
    expect(
      resolve({
        declaredPath: "./relative",
        sourcePath: "app/main.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files,
        unanalyzedFiles: lookup,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });

    const restoredFiles = fileMap([
      ...files.values(),
      file("app/relative/package.json", "root", '{"main":"public.js"}'),
      file("app/relative/public.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "./relative",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files: restoredFiles,
        unanalyzedFiles: lookup,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/relative/public.js",
    });
  });

  it("keeps bare package exports unknown while its manifest is unavailable", () => {
    const containerSha256 = file("app/main.mjs", "root").container_sha256;
    const manifest = {
      path: "app/node_modules/fixture/package.json",
      container_sha256: containerSha256,
      sha256: null,
      bytes: 47,
      inventory_artifact_id: null,
      kind: "package-json" as const,
      hash_status: "unavailable" as const,
      limitations: ["unpacked exports manifest is missing"],
    };
    const files = fileMap([
      file("app/main.cjs", "root"),
      file("app/main.mjs", "root"),
      file("app/node_modules/fixture/index.js", "root"),
      file("app/node_modules/fixture/import.js", "root"),
      file("app/node_modules/fixture/require.js", "root"),
    ]);
    const lookup = {
      get: (path: string) => (path === manifest.path ? manifest : undefined),
      coverage: completeInventoryCoverage,
      hasDirectory: () => false,
    };
    for (const [sourcePath, moduleKind] of [
      ["app/main.cjs", "require"],
      ["app/main.mjs", "import"],
    ] as const)
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath,
          context: "module-specifier",
          moduleKind,
          files,
          unanalyzedFiles: lookup,
        }),
      ).toMatchObject({
        resolution_status: "unavailable",
        resolved_path: null,
        limitations: ["unpacked exports manifest is missing"],
      });

    const restoredFiles = fileMap([
      ...files.values(),
      file(
        manifest.path,
        "root",
        '{"exports":{"import":"./import.js","require":"./require.js"}}',
      ),
    ]);
    for (const [sourcePath, moduleKind, target] of [
      ["app/main.cjs", "require", "app/node_modules/fixture/require.js"],
      ["app/main.mjs", "import", "app/node_modules/fixture/import.js"],
    ] as const)
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath,
          context: "module-specifier",
          moduleKind,
          files: restoredFiles,
          unanalyzedFiles: lookup,
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: target,
      });
  });
});

describe("bare package root file lookup", () => {
  it("uses loader-specific bare package roots when only a sibling .js file exists", () => {
    const absentDirectory = fileMap([
      file("app/entry.mjs", "root"),
      file("app/node_modules/fixture.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/entry.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files: absentDirectory,
      }),
    ).toMatchObject({ resolution_status: "external", resolved_path: null });
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/entry.mjs",
        context: "module-specifier",
        moduleKind: "require",
        files: absentDirectory,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture.js",
    });

    const packageDirectory = fileMap([
      file("app/entry.mjs", "root"),
      file("app/node_modules/fixture.js", "root"),
      file("app/node_modules/fixture/package.json", "root", "{}"),
    ]);
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/entry.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files: packageDirectory,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/entry.mjs",
        context: "module-specifier",
        moduleKind: "require",
        files: packageDirectory,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture.js",
    });
  });
});

describe("legacy package main lookup", () => {
  it("treats an empty package main as absent and resolves the root index", () => {
    const files = fileMap([
      file("app/src/entry.cjs", "root"),
      file("app/node_modules/fixture/package.json", "root", '{"main":""}'),
      file("app/node_modules/fixture/index.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/src/entry.cjs",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/index.js",
    });
  });

  it.each(["import", "require"] as const)(
    "limits %s package-main probes to Node's file extensions",
    (moduleKind) => {
      const files = fileMap([
        file("app/src/entry.js", "root"),
        file(
          "app/node_modules/fixture/package.json",
          "root",
          '{"main":"main"}',
        ),
        file("app/node_modules/fixture/main.cjs", "root"),
        file("app/node_modules/fixture/index.mjs", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/src/entry.js",
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
    },
  );

  it("retains inventoried directories during legacy ESM main finalization", () => {
    const files = fileMap([
      file("app/src/entry.mjs", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        '{"main":"./lib/"}',
      ),
      file("app/node_modules/fixture/lib.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/src/entry.mjs",
        context: "module-specifier",
        moduleKind: "import",
        files,
        directoryPaths: new Set(["app/node_modules/fixture/lib/.js"]),
      }),
    ).toMatchObject({
      resolution_status: "rejected",
      resolved_path: null,
      candidate_path: "app/node_modules/fixture/lib/.js",
    });
  });

  it.each(["import", "require"] as const)(
    "does not recursively resolve a nested package from a %s package main",
    (moduleKind) => {
      const files = fileMap([
        file("app/src/entry.js", "root"),
        file("app/node_modules/fixture/package.json", "root", '{"main":"sub"}'),
        file(
          "app/node_modules/fixture/sub/package.json",
          "root",
          '{"main":"other"}',
        ),
        file("app/node_modules/fixture/sub/other.js", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/src/entry.js",
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
    },
  );
});

describe("legacy package main metadata validation and fallback", () => {
  it.each(
    ["[]", "[{}]", "123", '"root"', "null", "false"].flatMap((text) =>
      (["import", "require", "compiler-dependent"] as const).map(
        (moduleKind) => ({ text, moduleKind }),
      ),
    ),
  )(
    "blocks index fallback for non-object package root $text in $moduleKind mode",
    ({ text, moduleKind }) => {
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/entry.js",
          context: "module-specifier",
          moduleKind,
          files: fileMap([
            file("app/entry.js", "root"),
            file("app/node_modules/fixture/package.json", "root", text),
            file("app/node_modules/fixture/index.js", "root"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: "unavailable",
        resolved_path: null,
        limitations: expect.arrayContaining([
          expect.stringContaining("not valid package JSON"),
        ]),
      });
    },
  );

  it("still rejects non-string package main metadata", () => {
    expect(
      resolve({
        declaredPath: "./package",
        sourcePath: "app/entry.js",
        context: "filesystem-expression",
        files: fileMap([
          file("app/entry.js", "root"),
          file("app/package/package.json", "root", '{"main":false}'),
          file("app/package/index.js", "root"),
        ]),
      }),
    ).toMatchObject({ resolution_status: "unavailable", resolved_path: null });
  });

  it.each(["import", "require"] as const)(
    "uses Node's index fallback for a non-string %s package main",
    (moduleKind) => {
      const files = fileMap([
        file("app/src/entry.js", "root"),
        file("app/node_modules/fixture/package.json", "root", '{"main":42}'),
        file("app/node_modules/fixture/index.js", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/src/entry.js",
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: "app/node_modules/fixture/index.js",
      });
    },
  );

  it.each(["import", "require"] as const)(
    "does not treat a root-pointing %s package main as a dotfile module",
    (moduleKind) => {
      const files = fileMap([
        file("src/entry.js", "root"),
        file("node_modules/fixture/package.json", "root", '{"main":"../.."}'),
        file("index.js", "root"),
        file(".js", "root"),
        file(".json", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "src/entry.js",
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: "index.js",
      });
    },
  );
});

describe("CommonJS bare package ancestor lookup", () => {
  it.each([
    ["absent metadata", undefined, true],
    ["empty metadata", "{}", true],
    ["empty main", '{"main":""}', true],
    ["truthy missing main", '{"main":"missing"}', false],
  ] as const)(
    "handles %s before an ancestor package for both loaders",
    (_name, packageJson, commonJsUsesAncestor) => {
      const files = fileMap([
        file("app/src/entry.js", "root"),
        file("app/src/node_modules/fixture/placeholder.js", "root"),
        ...(packageJson === undefined
          ? []
          : [
              file(
                "app/src/node_modules/fixture/package.json",
                "root",
                packageJson,
              ),
            ]),
        file("app/node_modules/fixture/index.js", "root"),
      ]);
      for (const moduleKind of ["import", "require"] as const) {
        const resolution = resolve({
          declaredPath: "fixture",
          sourcePath: "app/src/entry.js",
          context: "module-specifier",
          moduleKind,
          files,
        });
        if (moduleKind === "require" && commonJsUsesAncestor) {
          expect(resolution).toMatchObject({
            resolution_status: "resolved",
            resolved_path: "app/node_modules/fixture/index.js",
          });
        } else {
          expect(resolution).toMatchObject({
            resolution_status: "not-found",
            resolved_path: null,
          });
        }
      }
    },
  );
});

describe("CommonJS bare package subpath ancestor lookup", () => {
  it.each([
    ["absent subpath", undefined, true],
    ["empty subpath metadata", "{}", true],
    ["truthy missing subpath main", '{"main":"missing"}', false],
  ] as const)(
    "handles %s before an ancestor package for both loaders",
    (_name, packageJson, commonJsUsesAncestor) => {
      const files = fileMap([
        file("app/src/entry.js", "root"),
        file("app/src/node_modules/fixture/placeholder.js", "root"),
        ...(packageJson === undefined
          ? []
          : [
              file(
                "app/src/node_modules/fixture/parser/package.json",
                "root",
                packageJson,
              ),
              file(
                "app/src/node_modules/fixture/parser/placeholder.js",
                "root",
              ),
            ]),
        file("app/node_modules/fixture/parser.js", "root"),
      ]);
      const commonJsResolution = resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/entry.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      });
      expect(commonJsResolution).toMatchObject({
        resolved_path: commonJsUsesAncestor
          ? "app/node_modules/fixture/parser.js"
          : null,
      });
      const esmResolution = resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/entry.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      });
      expect(esmResolution.resolved_path).toBeNull();
    },
  );
});

describe("CommonJS bare package exhausted lookup", () => {
  it.each([
    ["empty main", "fixture", '{"main":""}', "app/src/node_modules/fixture"],
    [
      "missing subpath",
      "fixture/parser",
      "{}",
      "app/src/node_modules/fixture/parser",
    ],
  ] as const)(
    "preserves not-found for an exhausted %s lookup",
    (_name, declaredPath, packageJson, packageDirectory) => {
      const files = fileMap([
        file("app/src/entry.js", "root"),
        file("app/src/node_modules/fixture/package.json", "root", packageJson),
        file(`${packageDirectory}/placeholder.js`, "root"),
      ]);
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/src/entry.js",
          context: "module-specifier",
          moduleKind: "require",
          files,
        }),
      ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
    },
  );
});

describe("logical path identity", () => {
  it("resolves an NFD relative import to the NFC inventory path and rejects a root escape", () => {
    const nfc = "caf\u00e9".normalize("NFC");
    const nfd = nfc.normalize("NFD");
    const files = fileMap([
      file("dir/index.js", "root"),
      file(`dir/${nfc}.js`, "root"),
    ]);
    expect(
      resolve({
        declaredPath: `./${nfd}.js`,
        sourcePath: "dir/index.js",
        context: "module-specifier",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: `dir/${nfc}.js`,
    });
    expect(
      resolve({
        declaredPath: "../escape.js",
        sourcePath: "index.js",
        context: "module-specifier",
        files,
      }),
    ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
  });
});

describe("contextual JavaScript artifact path resolution", () => {
  it.each([
    ["main.js", "app/main.js"],
    ["./main.js", "app/main.js"],
    ["src/main", "app/src/main.cjs"],
    ["entry", "app/entry/start.mjs"],
    ["fallback", "app/fallback/index.ts"],
  ])("resolves package entrypoint %s", (declaredPath, expected) => {
    const files = fileMap([
      file("app/package.json", "root"),
      file("app/main.js", "root"),
      file("app/src/main.cjs", "root"),
      file("app/entry/package.json", "root", '{"main":"start"}'),
      file("app/entry/start.mjs", "root"),
      file("app/fallback/index.ts", "root"),
    ]);

    expect(
      resolve({
        declaredPath,
        sourcePath: "app/package.json",
        context: "package-entrypoint",
        files,
      }),
    ).toMatchObject({
      resolution_context: "package-entrypoint",
      resolution_status: "resolved",
      resolved_path: expected,
      limitations: [],
    });
  });

  it("resolves dirname-derived bare paths but keeps bare module specifiers external", () => {
    const files = fileMap([
      file("app/main.js", "root"),
      file("app/preload.js", "root"),
    ]);
    const base = {
      declaredPath: "preload.js",
      sourcePath: "app/main.js",
      files,
    } as const;

    expect(
      resolve({ ...base, context: "filesystem-expression" }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/preload.js",
    });
    expect(resolve({ ...base, context: "module-specifier" })).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
  });

  it("applies document and base-href semantics to HTML references", () => {
    const files = fileMap([
      file("renderer/index.html", "root"),
      file("assets/app.js", "root"),
      file("renderer/local.js", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "app.js?v=1",
        sourcePath: "renderer/index.html",
        context: "html-reference",
        htmlBaseHref: "/assets/",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "assets/app.js",
    });
    expect(
      resolve({
        declaredPath: "./local.js",
        sourcePath: "renderer/index.html",
        context: "html-reference",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "renderer/local.js",
    });
  });

  it.each(["node:fs", "electron", "../../escape.js", "%2e%2e/escape.js"])(
    "fails closed for unsafe or external module declaration %s",
    (declaredPath) => {
      const result = resolve({
        declaredPath,
        sourcePath: "app/main.js",
        context: "module-specifier",
        files: fileMap([file("app/main.js", "root")]),
      });
      expect(result.resolved_path).toBeNull();
      expect(["external", "rejected"]).toContain(result.resolution_status);
      expect(result.limitations.length).toBeGreaterThan(0);
    },
  );

  it("does not cross nested ASAR container identities", () => {
    const files = fileMap([
      file("app.asar/main.js", "asar-a"),
      file("app.asar/preload.js", "asar-b"),
    ]);

    expect(
      resolve({
        declaredPath: "preload.js",
        sourcePath: "app.asar/main.js",
        context: "filesystem-expression",
        files,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
  });

  it("resolves inventoried paths longer than the former character ceiling", () => {
    const declaredPath = `./${"a".repeat(5_000)}.js`;
    const expectedPath = `app/${declaredPath.slice(2)}`;
    const files = fileMap([
      file("app/consumer.js", "root"),
      file(expectedPath, "root"),
    ]);

    expect(
      resolve({
        declaredPath,
        sourcePath: "app/consumer.js",
        context: "module-specifier",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: expectedPath,
      limitations: [],
    });
  });
});

describe("ESM module URL path decoding", () => {
  it.each([
    ["./a%2eb.mjs", "app/esm/a.b.mjs"],
    ["./sub/%2e%2e/x.mjs", "app/esm/x.mjs"],
  ])(
    "decodes confined URL path %s before artifact lookup",
    (declaredPath, target) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/esm/entry.mjs",
          context: "module-specifier",
          moduleKind: "import",
          files: fileMap([
            file("app/esm/entry.mjs", "root"),
            file("app/esm/a.b.mjs", "root"),
            file("app/esm/x.mjs", "root"),
          ]),
        }),
      ).toMatchObject({
        resolved_path: target,
        resolution_status: "resolved",
      });
    },
  );

  it("rejects encoded separators and paths escaping the artifact root", () => {
    const files = fileMap([
      file("app/esm/entry.mjs", "root"),
      file("app/esm/x.mjs", "root"),
    ]);
    for (const declaredPath of ["./sub%2fx.mjs", "../../../escape.mjs"]) {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/esm/entry.mjs",
          context: "module-specifier",
          moduleKind: "import",
          files,
        }),
      ).toMatchObject({
        resolved_path: null,
        resolution_status: "rejected",
      });
    }
  });
});

describe("JavaScript file URL resolution", () => {
  it("keeps absolute file URL modules unavailable without a host mapping", () => {
    const files = fileMap([file("assets/app.js", "root")]);
    for (const declaredPath of [
      "file:///assets/app.js#entry",
      "FILE:///assets/app.js?token=%2F#entry",
    ]) {
      expect(
        resolve({
          declaredPath,
          sourcePath: "main.js",
          context: "module-specifier",
          moduleKind: "import",
          files,
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: "unavailable",
        resolved_path: null,
      });
    }

    for (const declaredPath of [
      "file:///assets%2Fapp.js",
      "file:///assets%2\nFapp.js",
    ]) {
      expect(
        resolve({
          declaredPath,
          sourcePath: "main.js",
          context: "module-specifier",
          moduleKind: "import",
          files,
        }),
      ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
    }

    expect(
      resolve({
        declaredPath: "file:/assets/app.js",
        sourcePath: "main.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({ resolution_status: "unavailable", resolved_path: null });
  });
});

describe("contextual JavaScript package path resolution", () => {
  it("follows package entrypoints beyond the former recursion ceiling", () => {
    const files = fileMap([
      file("app/consumer.js", "root"),
      file(
        "app/node_modules/pkg-1/package.json",
        "root",
        '{"main":"../pkg-2"}',
      ),
      file(
        "app/node_modules/pkg-2/package.json",
        "root",
        '{"main":"../pkg-3"}',
      ),
      file(
        "app/node_modules/pkg-3/package.json",
        "root",
        '{"main":"../pkg-4"}',
      ),
      file(
        "app/node_modules/pkg-4/package.json",
        "root",
        '{"main":"../pkg-5"}',
      ),
      file(
        "app/node_modules/pkg-5/package.json",
        "root",
        '{"main":"../pkg-6"}',
      ),
      file(
        "app/node_modules/pkg-6/package.json",
        "root",
        '{"main":"entry.js"}',
      ),
      file("app/node_modules/pkg-6/entry.js", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "pkg-1",
        sourcePath: "app/consumer.js",
        context: "module-specifier",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/pkg-6/entry.js",
      limitations: [],
    });
  });

  it("keeps an inventoried but unreadable directory package unavailable", () => {
    const files = fileMap([
      file("app/package.json", "root"),
      file("app/entry/package.json", "root", null),
    ]);

    expect(
      resolve({
        declaredPath: "entry",
        sourcePath: "app/package.json",
        context: "package-entrypoint",
        files,
      }),
    ).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
      limitations: [expect.stringContaining("text is unavailable")],
    });
  });

  it("resolves nearest inventoried bare packages with import/require conditions", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        JSON.stringify({
          exports: {
            ".": {
              import: "./esm.mjs",
              require: "./cjs.cjs",
              default: "./fallback.js",
            },
          },
        }),
      ),
      file("app/node_modules/fixture/esm.mjs", "root"),
      file("app/node_modules/fixture/cjs.cjs", "root"),
      file("app/node_modules/fixture/fallback.js", "root"),
      file("app/node_modules/fixture/hidden.js", "root"),
      file("app/node_modules/fs/index.js", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/esm.mjs",
    });
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/cjs.cjs",
    });
    expect(
      resolve({
        declaredPath: "fs",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({ resolution_status: "external", resolved_path: null });
    expect(
      resolve({
        declaredPath: "fixture/hidden.js",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
      limitations: [
        expect.stringContaining("declares no exports target for subpath"),
      ],
    });
  });
});

describe("package exports subpath resolution", () => {
  it("resolves exact subpath keys through import and require conditions", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        JSON.stringify({
          exports: {
            ".": "./index.cjs",
            "./parser": {
              import: "./parser.mjs",
              require: "./parser.cjs",
              default: "./fallback.js",
            },
          },
        }),
      ),
      file("app/node_modules/fixture/index.cjs", "root"),
      file("app/node_modules/fixture/parser.mjs", "root"),
      file("app/node_modules/fixture/parser.cjs", "root"),
      file("app/node_modules/fixture/fallback.js", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/parser.mjs",
    });
    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/parser.cjs",
    });
  });

  it("resolves array subpath targets at their first string entry", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        JSON.stringify({
          exports: {
            "./parser": [{ import: "./parser.mjs" }, "./parser.cjs"],
          },
        }),
      ),
      file("app/node_modules/fixture/parser.cjs", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/parser.cjs",
    });
  });

  it("resolves subpaths of scoped packages", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/@scope/fixture/package.json",
        "root",
        JSON.stringify({
          exports: { "./parser": "./parser.cjs" },
        }),
      ),
      file("app/node_modules/@scope/fixture/parser.cjs", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "@scope/fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/@scope/fixture/parser.cjs",
    });
  });
});

describe("scoped package directory and specifier resolution", () => {
  it("resolves CommonJS bare scoped package directory to index or package main", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file("app/node_modules/@scope/index.js", "root"),
      file(
        "app/node_modules/@scope-main/package.json",
        "root",
        JSON.stringify({ main: "entry.js" }),
      ),
      file("app/node_modules/@scope-main/entry.js", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "@scope",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/@scope/index.js",
    });

    expect(
      resolve({
        declaredPath: "@scope/",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/@scope/index.js",
    });

    expect(
      resolve({
        declaredPath: "@scope-main",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/@scope-main/entry.js",
    });

    expect(
      resolve({
        declaredPath: "@scope-main/",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/@scope-main/entry.js",
    });
  });

  it("distinguishes CommonJS scoped exports from ESM loader-owned export and specifier errors", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/@scope/package.json",
        "root",
        JSON.stringify({
          exports: {
            ".": "./selected.js",
          },
        }),
      ),
      file("app/node_modules/@scope/selected.js", "root"),
      file("app/node_modules/@scope/index.js", "root"),
    ]);

    // CommonJS require("@scope") resolves root exports
    expect(
      resolve({
        declaredPath: "@scope",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/@scope/selected.js",
    });

    // CommonJS require("@scope/") does not match "." subpath exports
    expect(
      resolve({
        declaredPath: "@scope/",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });

    // ESM import "@scope" without trailing slash is an invalid module specifier
    expect(
      resolve({
        declaredPath: "@scope",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });

    // ESM import "@scope/" with trailing slash resolves root exports
    expect(
      resolve({
        declaredPath: "@scope/",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/@scope/selected.js",
    });

    // Truly invalid scoped specifiers stay external
    expect(
      resolve({
        declaredPath: "@",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });

    expect(
      resolve({
        declaredPath: "@/",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
  });
});

const packageExportPatternCases = [
  {
    name: "matching",
    exports: { "./*": "./*.cjs" },
    request: "fixture/window",
    status: "unavailable",
  },
  {
    name: "nonmatching",
    exports: { "./other/*": "./*.cjs" },
    request: "fixture/window",
    status: "external",
  },
  {
    name: "suffix mismatch",
    exports: { "./*.js": "./*.cjs" },
    request: "fixture/window.cjs",
    status: "external",
  },
  {
    name: "empty match",
    exports: { "./*end": "./*.cjs" },
    request: "fixture/end",
    status: "external",
  },
  {
    name: "multiple stars",
    exports: { "./*/*": "./*.cjs" },
    request: "fixture/deep/window",
    status: "external",
  },
  {
    name: "exact before pattern",
    exports: { "./*": "./*.cjs", "./window": "./window.cjs" },
    request: "fixture/window",
    status: "resolved",
  },
  {
    name: "exact null before pattern",
    exports: { "./*": "./*.cjs", "./window": null },
    request: "fixture/window",
    status: "external",
  },
  {
    name: "matching null",
    exports: { "./*": null },
    request: "fixture/window",
    status: "external",
  },
  {
    name: "overlapping null prefix",
    exports: { "./*": "./*.cjs", "./private/*": null },
    request: "fixture/private/window",
    status: "external",
  },
  {
    name: "overlapping null suffix",
    exports: { "./*": "./*.cjs", "./*.hidden": null },
    request: "fixture/window.hidden",
    status: "external",
  },
  {
    name: "overlapping value prefix",
    exports: { "./*": null, "./public/*": "./*.cjs" },
    request: "fixture/public/window",
    status: "unavailable",
  },
  {
    name: "inactive pattern condition",
    exports: { "./*": { browser: "./*.cjs" } },
    request: "fixture/window",
    status: "external",
  },
  {
    name: "conditional null",
    exports: { "./*": { node: null, default: "./*.cjs" } },
    request: "fixture/window",
    status: "external",
  },
];

describe("package exports subpath encapsulation", () => {
  it.each(packageExportPatternCases)(
    "keeps $name exports patterns distinct from deterministic encapsulation",
    ({ exports, request, status }) => {
      for (const moduleKind of ["import", "require"] as const) {
        expect(
          resolve({
            declaredPath: request,
            sourcePath: "app/main.cjs",
            context: "module-specifier",
            moduleKind,
            files: fileMap([
              file("app/main.cjs", "root"),
              file(
                "app/node_modules/fixture/package.json",
                "root",
                JSON.stringify({ exports }),
              ),
              file("app/node_modules/fixture/window.cjs", "root"),
            ]),
          }),
        ).toMatchObject({
          resolution_status: status,
          resolved_path:
            status === "resolved"
              ? "app/node_modules/fixture/window.cjs"
              : null,
        });
      }
    },
  );
  it("keeps subpaths encapsulated when only a root target is exported", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        JSON.stringify({ exports: "./index.cjs" }),
      ),
      file("app/node_modules/fixture/index.cjs", "root"),
      file("app/node_modules/fixture/parser.cjs", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
      limitations: [expect.stringContaining("a root target only")],
    });
  });

  it("blocks subpaths with an explicit null target", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        JSON.stringify({
          exports: { ".": "./index.cjs", "./parser": null },
        }),
      ),
      file("app/node_modules/fixture/index.cjs", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
      limitations: [expect.stringContaining("explicit null exports target")],
    });
  });

  it("reports a missing selected subpath target without index fallback", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        JSON.stringify({
          exports: { "./parser": "./parser.cjs" },
        }),
      ),
      file("app/node_modules/fixture/parser/index.js", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "not-found",
      resolved_path: null,
      limitations: [expect.stringContaining("exports targets are exact files")],
    });
  });
});

describe("package subpath directory ownership", () => {
  it.each(["root", "other"])(
    "selects metadata-less package directories only in the %s container",
    (container) => {
      const files = fileMap([
        file("app/src/consumer.js", "root"),
        file("app/src/node_modules/fixture/parser.js", container),
        file("app/node_modules/fixture/package.json", "root", "{}"),
        file("app/node_modules/fixture/parser.js", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "fixture/parser",
          sourcePath: "app/src/consumer.js",
          context: "module-specifier",
          moduleKind: "require",
          files,
        }),
      ).toMatchObject({
        declared_path: "fixture/parser",
        resolution_context: "module-specifier",
        resolution_status: "resolved",
        resolved_path:
          container === "root"
            ? "app/src/node_modules/fixture/parser.js"
            : "app/node_modules/fixture/parser.js",
      });
    },
  );

  it("does not mistake a package-name file or sibling prefix for a nearer directory", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file("app/src/node_modules/fixture.js", "root"),
      file("app/src/node_modules/fixture-extra/parser.js", "root"),
      file("app/node_modules/fixture/parser.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolved_path: "app/node_modules/fixture/parser.js",
      resolution_status: "resolved",
    });
  });

  it.each([
    ["malformed", "{", "not valid package JSON"],
    ["unavailable", null, "text is unavailable"],
  ])("preserves %s nested directory failures", (_name, text, reason) => {
    const files = fileMap([
      file("app/consumer.js", "root"),
      file("app/node_modules/fixture/package.json", "root", "{}"),
      file("app/node_modules/fixture/parser/package.json", "root", text),
    ]);
    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      declared_path: "fixture/parser",
      resolution_context: "module-specifier",
      resolved_path: null,
      resolution_status: "unavailable",
      limitations: [expect.stringContaining(reason)],
    });
  });

  it("does not recurse through a cyclic nested main during CommonJS lookup", () => {
    const files = fileMap([
      file("app/consumer.js", "root"),
      file("app/node_modules/fixture/package.json", "root", "{}"),
      file(
        "app/node_modules/fixture/parser/package.json",
        "root",
        '{"main":"."}',
      ),
    ]);
    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "not-found",
      resolved_path: null,
    });
  });
});

describe("package subpath legacy lookup and metadata failures", () => {
  it("resolves CommonJS legacy subpath files and indexes without exports", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        '{"main":"./index.cjs"}',
      ),
      file("app/node_modules/fixture/direct.js", "root"),
      file("app/node_modules/fixture/explicit.cjs", "root"),
      file("app/node_modules/fixture/folder/index.js", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/direct",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/direct.js",
    });
    expect(
      resolve({
        declaredPath: "fixture/explicit.cjs",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/explicit.cjs",
    });
    expect(
      resolve({
        declaredPath: "fixture/folder",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/node_modules/fixture/folder/index.js",
    });
  });

  it("rejects subpath metadata that mixes subpath and condition keys", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        JSON.stringify({
          exports: { "./parser": "./parser.cjs", node: "./index.cjs" },
        }),
      ),
      file("app/node_modules/fixture/parser.cjs", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "rejected",
      resolved_path: null,
      limitations: [expect.stringContaining("mixes subpath keys")],
    });
  });

  it("reports malformed subpath package metadata as unavailable", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file("app/node_modules/fixture/package.json", "root", "{"),
      file("app/node_modules/fixture/parser.cjs", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
      limitations: [expect.stringContaining("not valid package JSON")],
    });
  });

  it("reports unavailable metadata text for subpath resolution", () => {
    const files = fileMap([
      file("app/src/consumer.js", "root"),
      file("app/node_modules/fixture/package.json", "root", null),
      file("app/node_modules/fixture/parser.cjs", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "fixture/parser",
        sourcePath: "app/src/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
      limitations: [expect.stringContaining("text is unavailable")],
    });
  });
});

describe("generic package entry heuristics", () => {
  it.each([
    ['{"main":"actual.cjs","module":"bundler.mjs"}', "actual.cjs"],
    ['{"module":"bundler.mjs"}', "bundler.mjs"],
  ])(
    "preserves generic entry heuristics without a module kind for %s",
    (metadata, entry) => {
      const files = fileMap([
        file("app/consumer.js", "root"),
        file("app/node_modules/fixture/package.json", "root", metadata),
        file("app/node_modules/fixture/actual.cjs", "root"),
        file("app/node_modules/fixture/bundler.mjs", "root"),
        file("app/node_modules/fixture/index.js", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/consumer.js",
          context: "module-specifier",
          files,
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: `app/node_modules/fixture/${entry}`,
      });
    },
  );
});

describe("package exports exact targets", () => {
  it.each([
    ["./file", "app/node_modules/fixture/file.js"],
    ["./folder", "app/node_modules/fixture/folder/index.js"],
  ])(
    "resolves exports target %s only to that exact file",
    (target, nearMiss) => {
      const files = fileMap([
        file("app/consumer.js", "root"),
        file(
          "app/node_modules/fixture/package.json",
          "root",
          JSON.stringify({ exports: target }),
        ),
        file(nearMiss, "root"),
      ]);
      for (const moduleKind of ["import", "require"] as const) {
        const resolution = resolve({
          declaredPath: "fixture",
          sourcePath: "app/consumer.js",
          context: "module-specifier",
          moduleKind,
          files,
        });
        expect(resolution).toMatchObject({
          resolution_status: "not-found",
          resolved_path: null,
        });
        expect(resolution.limitations.join(" ")).toContain(
          "exports targets are exact files",
        );
      }
    },
  );

  it("keeps extension and index fallbacks for a legacy main entry", () => {
    for (const [main, target] of [
      ["./file", "app/node_modules/fixture/file.js"],
      ["./folder", "app/node_modules/fixture/folder/index.js"],
    ] as const) {
      const files = fileMap([
        file("app/consumer.js", "root"),
        file(
          "app/node_modules/fixture/package.json",
          "root",
          JSON.stringify({ main }),
        ),
        file(target, "root"),
      ]);
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/consumer.js",
          context: "module-specifier",
          moduleKind: "require",
          files,
        }),
      ).toMatchObject({ resolution_status: "resolved", resolved_path: target });
    }
  });
});

describe("package import alias resolution", () => {
  it.each(["import", "require"] as const)(
    "resolves an exact #%s alias from the enclosing package imports map",
    (moduleKind) => {
      const files = aliasFiles({
        "package.json": JSON.stringify({
          imports: { "#config": "./config.cjs" },
        }),
        "main.js": "",
        "config.cjs": "",
      });
      expect(
        resolve({
          declaredPath: "#config",
          sourcePath: "main.js",
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: "config.cjs",
        declared_path: "#config",
      });
    },
  );

  it("resolves an alias from a nested file through the enclosing package root", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": "./config.cjs" },
      }),
      "src/main.js": "",
      "config.cjs": "",
    });
    expect(
      resolve({
        declaredPath: "#config",
        sourcePath: "src/main.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "config.cjs",
    });
  });

  it("keeps package import aliases available for runtime entrypoints", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#worker": "./worker.js" },
      }),
      "main.cjs": "",
      "worker.js": "",
    });
    expect(
      resolve({
        declaredPath: "#worker",
        sourcePath: "main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "exact-file",
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "worker.js",
      declared_path: "#worker",
    });
  });

  it("uses a nested package imports map rather than the application root", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": "./root.cjs" },
      }),
      "root.cjs": "",
      "node_modules/fixture/package.json": JSON.stringify({
        imports: { "#config": "./local.cjs" },
      }),
      "node_modules/fixture/index.js": "",
      "node_modules/fixture/local.cjs": "",
    });
    expect(
      resolve({
        declaredPath: "#config",
        sourcePath: "node_modules/fixture/index.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "node_modules/fixture/local.cjs",
    });
  });

  it("does not inherit an ancestor imports map across a nested package.json", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": "./root.cjs" },
      }),
      "root.cjs": "",
      "node_modules/fixture/package.json": "{}",
      "node_modules/fixture/index.js": "",
    });
    const outcome = resolve({
      declaredPath: "#config",
      sourcePath: "node_modules/fixture/index.js",
      context: "module-specifier",
      moduleKind: "require",
      files,
    });
    expect(outcome).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
    expect(outcome.limitations.join(" ")).toContain(
      "node_modules/fixture/package.json",
    );
    expect(outcome.limitations.join(" ")).not.toContain("root.cjs");
  });

  it("does not apply a nested package map to the application root importer", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": "./root.cjs" },
      }),
      "main.js": "",
      "root.cjs": "",
      "node_modules/fixture/package.json": JSON.stringify({
        imports: { "#config": "./local.cjs" },
      }),
      "node_modules/fixture/local.cjs": "",
    });
    expect(
      resolve({
        declaredPath: "#config",
        sourcePath: "main.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "root.cjs",
    });
  });
});

describe("package import alias target selection", () => {
  it("selects import and require conditions from an imports target", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: {
          "#config": {
            import: "./config.mjs",
            require: "./config.cjs",
            default: "./fallback.js",
          },
        },
      }),
      "main.js": "",
      "config.mjs": "",
      "config.cjs": "",
      "fallback.js": "",
    });
    expect(
      resolve({
        declaredPath: "#config",
        sourcePath: "main.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }).resolved_path,
    ).toBe("config.mjs");
    expect(
      resolve({
        declaredPath: "#config",
        sourcePath: "main.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }).resolved_path,
    ).toBe("config.cjs");
  });

  it("resolves array import targets at their first string entry", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": [{ import: "./missing.mjs" }, "./config.cjs"] },
      }),
      "main.js": "",
      "config.cjs": "",
    });
    expect(
      resolve({
        declaredPath: "#config",
        sourcePath: "main.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "config.cjs",
    });
  });

  it("does not add an extension or index to a selected import target", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": "./config" },
      }),
      "main.js": "",
      "config.cjs": "",
      "config/index.js": "",
    });
    const outcome = resolve({
      declaredPath: "#config",
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "require",
      files,
    });
    expect(outcome).toMatchObject({
      resolution_status: "not-found",
      resolved_path: null,
    });
    expect(outcome.limitations.join(" ")).toContain(
      "import targets are exact files",
    );
  });
});

describe("package import alias refusals", () => {
  it("reports a missing exact alias without looking in another package", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": "./config.cjs" },
      }),
      "main.js": "",
      "config.cjs": "",
    });
    const outcome = resolve({
      declaredPath: "#other",
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "require",
      files,
    });
    expect(outcome).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
    expect(outcome.limitations.join(" ")).toContain("#other");
    expect(outcome.limitations.join(" ")).toContain("#config");
  });

  it("reports an explicit null import target as blocked", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": null },
      }),
      "main.js": "",
      "config.cjs": "",
    });
    const outcome = resolve({
      declaredPath: "#config",
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "require",
      files,
    });
    expect(outcome).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
    expect(outcome.limitations.join(" ")).toContain("explicit null");
  });

  it("leaves wildcard import aliases unresolved", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#internal/*": "./src/*.js" },
      }),
      "main.js": "",
      "src/util.js": "",
    });
    const outcome = resolve({
      declaredPath: "#internal/util",
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "import",
      files,
    });
    expect(outcome).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
    });
    expect(outcome.limitations.join(" ")).toMatch(/wildcard/i);
  });

  it("leaves recursive and external-package import targets unresolved", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#loop": "#config", "#dep": "fixture" },
      }),
      "main.js": "",
      "node_modules/fixture/index.js": "",
    });
    const recursive = resolve({
      declaredPath: "#loop",
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "require",
      files,
    });
    const external = resolve({
      declaredPath: "#dep",
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "require",
      files,
    });
    expect(recursive).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
    });
    expect(recursive.limitations.join(" ")).toMatch(/recursive/i);
    expect(external).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
    });
    expect(external.limitations.join(" ")).toMatch(/external-package/i);
  });

  it("rejects reserved hash specifiers", () => {
    const files = aliasFiles({
      "package.json": JSON.stringify({
        imports: { "#config": "./config.cjs" },
      }),
      "main.js": "",
      "config.cjs": "",
    });
    expect(
      resolve({
        declaredPath: "#",
        sourcePath: "main.js",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
  });

  it("does not use a foreign-container enclosing package.json", () => {
    const files = fileMap([
      file(
        "package.json",
        "other",
        JSON.stringify({ imports: { "#config": "./config.cjs" } }),
      ),
      file("main.js", "root"),
      file("config.cjs", "root"),
    ]);
    const outcome = resolve({
      declaredPath: "#config",
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "require",
      files,
    });
    expect(outcome).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
    });
    expect(outcome.limitations.join(" ")).toContain("container boundary");
  });
});

describe("directory package entrypoint precedence", () => {
  it.each([
    ["require", '{"main":"actual.cjs"}', "actual.cjs"],
    ["require", '{"exports":{"require":"./actual.cjs"}}', "actual.cjs"],
    ["import", '{"exports":{"import":"./actual.mjs"}}', "actual.mjs"],
  ] as const)(
    "prefers declared %s entrypoints over index files",
    (moduleKind, metadata, entry) => {
      const files = fileMap([
        file("app/consumer.js", "root"),
        file("app/node_modules/fixture/package.json", "root", metadata),
        file(`app/node_modules/fixture/${entry}`, "root"),
        file("app/node_modules/fixture/index.js", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/consumer.js",
          context: "module-specifier",
          moduleKind,
          files,
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: `app/node_modules/fixture/${entry}`,
      });
    },
  );

  it.each(["{}", '{"main":"."}'])(
    "preserves index fallback for package metadata %s",
    (metadata) => {
      const files = fileMap([
        file("app/consumer.js", "root"),
        file("app/entry/package.json", "root", metadata),
        file("app/entry/index.js", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "./entry",
          sourcePath: "app/consumer.js",
          context: "module-specifier",
          moduleKind: "require",
          files,
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: "app/entry/index.js",
      });
    },
  );

  it.each([null, "{"])(
    "keeps unreadable or invalid metadata explicit even when an index exists",
    (metadata) => {
      const files = fileMap([
        file("app/consumer.js", "root"),
        file("app/entry/package.json", "root", metadata),
        file("app/entry/index.js", "root"),
      ]);
      expect(
        resolve({
          declaredPath: "./entry",
          sourcePath: "app/consumer.js",
          context: "module-specifier",
          moduleKind: "require",
          files,
        }),
      ).toMatchObject({
        resolution_status: "unavailable",
        resolved_path: null,
      });
    },
  );

  it("does not replace a missing exports target with an index", () => {
    const files = fileMap([
      file("app/consumer.js", "root"),
      file(
        "app/node_modules/fixture/package.json",
        "root",
        '{"exports":"./missing.js"}',
      ),
      file("app/node_modules/fixture/index.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "app/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "not-found",
      resolved_path: null,
    });
  });

  it("keeps direct files ahead of a relative directory package", () => {
    const files = fileMap([
      file("app/consumer.js", "root"),
      file("app/entry.js", "root"),
      file("app/entry/package.json", "root", '{"main":"actual.js"}'),
      file("app/entry/actual.js", "root"),
      file("app/entry/index.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "./entry",
        sourcePath: "app/consumer.js",
        context: "module-specifier",
        moduleKind: "require",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/entry.js",
    });
  });

  it("retains cycle diagnostics for generic package-entrypoint inference", () => {
    const files = fileMap([
      file("app/package.json", "root"),
      file("app/a/package.json", "root", '{"main":"../b"}'),
      file("app/b/package.json", "root", '{"main":"../a"}'),
    ]);
    expect(
      resolve({
        declaredPath: "./a",
        sourcePath: "app/package.json",
        context: "package-entrypoint",
        files,
      }),
    ).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
      limitations: [expect.stringContaining("cycle")],
    });
  });
});

describe("contextual JavaScript module identity", () => {
  it("retains CommonJS and ESM file-base identity during inert extraction", () => {
    const analysis = analyzeJavaScriptStaticSource(
      `
        import { BrowserWindow } from "electron";
        import path, { dirname } from "node:path";
        import { fileURLToPath } from "node:url";
        new BrowserWindow({ webPreferences: {
          preload: path.resolve("ignored", __dirname, "preload.cjs")
        }});
        new BrowserWindow({ webPreferences: {
          preload: fileURLToPath(new URL("./preload.mjs", import.meta.url))
        }});
        new BrowserWindow({ webPreferences: {
          preload: path.join(path.dirname(__filename), "legacy-preload.js")
        }});
        new BrowserWindow({ webPreferences: {
          preload: path.posix.resolve("/ignored", dirname(fileURLToPath(import.meta.url)), "esm-preload.js")
        }});
        new BrowserWindow({ webPreferences: {
          preload: path.posix.resolve(__dirname, "/shared", "absolute-preload.js/")
        }});
        new BrowserWindow({ webPreferences: {
          preload: path.posix.resolve(\`/templates\`, "template-preload.js")
        }});
        new BrowserWindow({ webPreferences: {
          preload: new URL("./remote-base.js", location.href)
        }});
        new BrowserWindow().loadURL("file:///renderer/index.html");
      `,
    );

    expect(analysis.role_paths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "preload.cjs",
          resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          path: "./preload.mjs",
          resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          path: "legacy-preload.js",
          resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          path: "esm-preload.js",
          resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          path: "/shared/absolute-preload.js",
          resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          path: "/templates/template-preload.js",
          resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          path: "file:///renderer/index.html",
          resolution_context: "module-specifier",
        }),
      ]),
    );
    expect(analysis.electron.browser_windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          preload_path: "preload.cjs",
          preload_resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          preload_path: "./preload.mjs",
          preload_resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          preload_path: "esm-preload.js",
          preload_resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          preload_path: "/shared/absolute-preload.js",
          preload_resolution_context: "filesystem-expression",
        }),
        expect.objectContaining({
          preload_path: "/templates/template-preload.js",
          preload_resolution_context: "filesystem-expression",
        }),
      ]),
    );
    expect(analysis.role_paths).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "./remote-base.js" }),
      ]),
    );
  });
});

describe("TypeScript NodeNext emitted-extension resolution", () => {
  const container = "container";

  it.each([
    ["./dep.js", "src/dep.ts"],
    ["./ui/Button.js", "src/ui/Button.tsx"],
    ["./cfg.mjs", "src/cfg.mts"],
    ["./legacy.cjs", "src/legacy.cts"],
  ] as const)(
    "resolves %s to its TypeScript source counterpart",
    (specifier, target) => {
      const files = fileMap([
        file("src/main.ts", container),
        file(target, container, "export const value = 1;"),
      ]);
      expect(
        resolve({
          declaredPath: specifier,
          sourcePath: "src/main.ts",
          context: "module-specifier",
          moduleKind: "import",
          files,
        }),
      ).toMatchObject({ resolution_status: "resolved", resolved_path: target });
    },
  );
});

describe("TypeScript declaration fallback ownership", () => {
  const container = "container";

  it.each([
    ["./dep.js", "src/dep.d.ts"],
    ["./cfg.mjs", "src/cfg.d.mts"],
    ["./legacy.cjs", "src/legacy.d.cts"],
  ] as const)(
    "retains %s as compile-time evidence without inventing a runtime target",
    (specifier, target) => {
      const files = fileMap([
        file("src/main.ts", container),
        file(target, container, "export const value = 1;"),
      ]);
      for (const moduleKind of ["import", "require"] as const) {
        expect(
          resolve({
            declaredPath: specifier,
            sourcePath: "src/main.ts",
            context: "module-specifier",
            moduleKind,
            files,
          }),
        ).toMatchObject({
          resolution_status: "unavailable",
          resolved_path: null,
          candidate_path: target,
        });
      }
      expect(
        resolve({
          declaredPath: "./" + target.slice(4),
          sourcePath: "src/main.ts",
          context: "module-specifier",
          moduleKind: "import",
          files,
        }),
      ).toMatchObject({ resolution_status: "resolved", resolved_path: target });
    },
  );

  it("prefers a present runtime file and keeps the fallback off for JS callers", () => {
    const files = fileMap([
      file("src/main.ts", container),
      file("src/dep.js", container),
      file("src/dep.ts", container),
      file("src/js-main.js", container),
    ]);
    expect(
      resolve({
        declaredPath: "./dep.js",
        sourcePath: "src/main.ts",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "src/dep.js",
    });
    expect(
      resolve({
        declaredPath: "./dep.js",
        sourcePath: "src/js-main.js",
        context: "module-specifier",
        moduleKind: "import",
        files: fileMap([
          file("src/js-main.js", container),
          file("src/dep.ts", container),
        ]),
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
  });

  it("does not apply the mapping to URL resources or package export targets", () => {
    const urlFiles = fileMap([
      file("src/main.ts", container),
      file("src/asset.ts", container),
    ]);
    expect(
      resolve({
        declaredPath: "asset.js",
        sourcePath: "src/main.ts",
        context: "url-reference",
        files: urlFiles,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });

    const packageFiles = fileMap([
      file("src/main.ts", container),
      file(
        "src/node_modules/fixture/package.json",
        container,
        '{"exports":"./dep.js"}',
      ),
      file("src/node_modules/fixture/dep.ts", container),
    ]);
    expect(
      resolve({
        declaredPath: "fixture",
        sourcePath: "src/main.ts",
        context: "module-specifier",
        moduleKind: "import",
        files: packageFiles,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
  });

  it("does not substitute source counterparts for directory or index resolution", () => {
    const files = fileMap([
      file("src/main.ts", container),
      file("src/lib/index.ts", container),
    ]);
    expect(
      resolve({
        declaredPath: "./lib.js",
        sourcePath: "src/main.ts",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
  });

  it("resolves an emitted dotfile name within its own directory", () => {
    const files = fileMap([
      file("src/main.ts", container),
      file("src/.ts", container),
    ]);
    expect(
      resolve({
        declaredPath: "./.js",
        sourcePath: "src/main.ts",
        context: "module-specifier",
        moduleKind: "import",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "src/.ts",
    });
  });
});

describe("url-reference directory and empty-segment semantics", () => {
  it.each([
    "./worker.js/.",
    "./worker.js/child/..",
    "./worker.js/",
    "/dist/worker.js/.",
    "./worker.js/.?cache=1#entry",
  ])("keeps directory-form URLs distinct from files: %s", (declaredPath) => {
    for (const context of ["url-reference", "html-reference"] as const)
      expect(
        resolve({
          declaredPath,
          sourcePath: "dist/app.mjs",
          context,
          files: fileMap([file("dist/worker.js", "root")]),
        }),
        context,
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: "not-found",
        resolved_path: null,
      });
  });

  it.each([
    ["./nested//worker.js", null],
    ["./nested//../worker.js", "dist/nested/worker.js"],
  ])(
    "keeps empty URL path segments significant: %s",
    (declaredPath, resolvedPath) => {
      // A dot segment removes the preceding empty segment, never `nested`.
      expect(new URL(declaredPath, "file:///root/dist/app.mjs").pathname).toBe(
        resolvedPath === null
          ? "/root/dist/nested//worker.js"
          : `/root/${resolvedPath}`,
      );
      for (const context of ["url-reference", "html-reference"] as const)
        expect(
          resolve({
            declaredPath,
            sourcePath: "dist/app.mjs",
            context,
            files: fileMap([
              file("dist/worker.js", "root"),
              file("dist/nested/worker.js", "root"),
            ]),
          }),
          context,
        ).toMatchObject({ resolved_path: resolvedPath });
      expect(
        resolve({
          declaredPath,
          sourcePath: "dist/app.mjs",
          context: "module-specifier",
          moduleKind: "import",
          files: fileMap([
            file("dist/worker.js", "root"),
            file("dist/nested/worker.js", "root"),
          ]),
        }),
      ).toMatchObject({ resolved_path: resolvedPath });
      // CommonJS keeps filesystem path semantics.
      expect(
        resolve({
          declaredPath,
          sourcePath: "dist/app.mjs",
          context: "module-specifier",
          moduleKind: "require",
          files: fileMap([
            file("dist/worker.js", "root"),
            file("dist/nested/worker.js", "root"),
          ]),
        }),
      ).toMatchObject({
        resolved_path:
          declaredPath === "./nested//worker.js"
            ? "dist/nested/worker.js"
            : "dist/worker.js",
      });
    },
  );

  it.each([
    ["./nested/.././worker.js?cache=1#entry", "dist/worker.js"],
    ["./.worker.js", "dist/.worker.js"],
  ])("resolves exact file URLs with dots: %s", (declaredPath, resolvedPath) => {
    expect(
      resolve({
        declaredPath,
        sourcePath: "dist/app.mjs",
        context: "url-reference",
        files: fileMap([file(resolvedPath, "root")]),
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: resolvedPath,
    });
  });
});

describe("suffix-only non-runtime URL references", () => {
  it.each(["", "?cache=1", "#worker"])(
    "rejects URL reference %s without a path or known base document",
    (declaredPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "dist/app.mjs",
          context: "url-reference",
          files: fileMap([file("dist/app.mjs", "root")]),
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: "rejected",
        resolved_path: null,
      });
    },
  );
});

describe("url-reference JavaScript artifact path resolution", () => {
  it.each([
    ["C|?cache=1#entry", "dist/C|"],
    ["/c:/worker.js", "c:/worker.js"],
    ["/./c|/worker.js", "c|/worker.js"],
    ["../c|/worker.js", "c|/worker.js"],
    ["/nested/../c|/worker.js", "c|/worker.js"],
    ["c|/../worker.js", "dist/worker.js"],
  ])("leaves drive-letter URL paths unresolved: %s", (declaredPath, decoy) => {
    const resolution = resolve({
      declaredPath,
      sourcePath: "dist/app.mjs",
      context: "url-reference",
      files: fileMap([file(decoy, "root")]),
    });
    expect(resolution).toMatchObject({
      declared_path: declaredPath,
      resolution_status: "unavailable",
      resolved_path: null,
    });
    expect(resolution.limitations.length).toBeGreaterThan(0);
  });

  it.each([
    ["./c|/worker.js", "dist/c|/worker.js"],
    ["c|name/worker.js", "dist/c|name/worker.js"],
    ["/%63|/worker.js", "c|/worker.js"],
    ["/c%3A/worker.js", "c:/worker.js"],
  ])(
    "retains non-drive URL path identities: %s",
    (declaredPath, resolvedPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "dist/app.mjs",
          context: "url-reference",
          files: fileMap([file(resolvedPath, "root")]),
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: "resolved",
        resolved_path: resolvedPath,
      });
    },
  );

  it.each(["?value=", "#value="])(
    "admits the pathname independently of its %s suffix",
    (suffix) => {
      for (const value of ["%2F", "%2E", "%5C", "%00", "%FF", "\\", "\0"]) {
        const declaredPath = `./worker.js${suffix}${value}`;
        expect(
          resolve({
            declaredPath,
            sourcePath: "dist/app.js",
            context: "url-reference",
            files: fileMap([file("dist/worker.js", "root")]),
          }),
          declaredPath,
        ).toMatchObject({
          declared_path: declaredPath,
          resolution_status: "resolved",
          resolved_path: "dist/worker.js",
        });
      }
    },
  );

  it.each([
    "app\0.js.map?valid=1",
    "nested\\worker.js#valid",
    "app%00.js.map",
    "app%FF.js.map",
    "app%C0%AF.js.map",
    "app%2ejs.map",
    "nested%2fworker.js",
    "nested%5cworker.js",
    "h\nttp://[",
    "../../outside.js.map",
    "../../outside/.",
  ])("rejects an inadmissible URL path: %s", (declaredPath) => {
    const resolution = resolve({
      declaredPath,
      sourcePath: "dist/app.js",
      context: "url-reference",
      files: fileMap([
        file("dist/app.js.map", "root"),
        file("dist/nested/worker.js", "root"),
      ]),
    });
    expect(resolution).toMatchObject({
      declared_path: declaredPath,
      resolution_context: "url-reference",
      resolution_status: "rejected",
      resolved_path: null,
    });
    expect(resolution.limitations.length).toBeGreaterThan(0);
  });

  it("resolves sibling paths and rejects external URL forms", () => {
    const files = fileMap([
      file("dist/app.js", "root"),
      file("dist/app.js.map", "root"),
      file("dist/worker.js", "root"),
    ]);

    expect(
      resolve({
        declaredPath: "app.js.map",
        sourcePath: "dist/app.js",
        context: "url-reference",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "dist/app.js.map",
    });
    expect(
      resolve({
        declaredPath: "app.js.map?v=1#section",
        sourcePath: "dist/app.js",
        context: "url-reference",
        files,
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "dist/app.js.map",
    });
    expect(
      resolve({
        declaredPath: "//cdn.example.com/app.js.map",
        sourcePath: "dist/app.js",
        context: "url-reference",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
    expect(
      resolve({
        declaredPath: "https://cdn.example.com/app.js.map",
        sourcePath: "dist/app.js",
        context: "url-reference",
        files,
      }),
    ).toMatchObject({
      resolution_status: "external",
      resolved_path: null,
    });
  });
});

describe("module-backed package main host paths", () => {
  it.each([
    ["sub\\entry.cjs", "unavailable", null],
    ["sub/entry.cjs", "resolved", "app/node_modules/fixture/sub/entry.cjs"],
  ] as const)(
    "preserves dependency main host semantics for %s",
    (main, status, expected) => {
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files: fileMap([
            file("app/main.cjs", "root"),
            file(
              "app/node_modules/fixture/package.json",
              "root",
              JSON.stringify({ main }),
            ),
            file("app/node_modules/fixture/sub/entry.cjs", "root"),
            file("app/node_modules/fixture/index.js", "root"),
          ]),
        }),
      ).toMatchObject({ resolution_status: status, resolved_path: expected });
    },
  );

  it.each(
    [
      "/shared/window.cjs",
      "C:/shared/window.cjs",
      "\\\\host\\share\\window.cjs",
    ].flatMap((main) => [true, false].map((direct) => ({ main, direct }))),
  )(
    "retains host main $main before logical lookup (direct=$direct)",
    ({ main, direct }) => {
      expect(
        resolve({
          declaredPath: direct ? main : "fixture",
          sourcePath: direct
            ? "app/node_modules/fixture/package.json"
            : "app/main.cjs",
          context: direct ? "package-entrypoint" : "module-specifier",
          moduleKind: "require",
          files: fileMap([
            file("app/main.cjs", "root"),
            file(
              "app/node_modules/fixture/package.json",
              "root",
              JSON.stringify({ main }),
            ),
            file("shared/window.cjs", "root"),
            file("app/node_modules/fixture/index.js", "root"),
          ]),
        }),
      ).toMatchObject({
        declared_path: direct ? main : "fixture",
        resolution_status: "unavailable",
        resolved_path: null,
      });
    },
  );

  it.each(["entry.cjs", "./entry.cjs"])(
    "preserves relative package main lookup for %s",
    (main) => {
      expect(
        resolve({
          declaredPath: "fixture",
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files: fileMap([
            file("app/main.cjs", "root"),
            file(
              "app/node_modules/fixture/package.json",
              "root",
              JSON.stringify({ main }),
            ),
            file("app/node_modules/fixture/entry.cjs", "root"),
            file("app/node_modules/fixture/index.js", "root"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: "app/node_modules/fixture/entry.cjs",
      });
    },
  );

  it.each([true, false])(
    "keeps NUL package mains rejected (direct=%s)",
    (direct) => {
      const main = "/shared/\0window.cjs";
      expect(
        resolve({
          declaredPath: direct ? main : "fixture",
          sourcePath: direct ? "app/package.json" : "app/main.cjs",
          context: direct ? "package-entrypoint" : "module-specifier",
          moduleKind: "require",
          files: fileMap([
            file("app/main.cjs", "root"),
            file(
              "app/node_modules/fixture/package.json",
              "root",
              JSON.stringify({ main }),
            ),
            file("app/node_modules/fixture/index.js", "root"),
          ]),
        }),
      ).toMatchObject({ resolution_status: "rejected", resolved_path: null });
    },
  );
});

const jsonDocuments = new JavaScriptJsonDocuments();
const resolve = (input: Omit<ResolveArtifactPathInput, "jsonDocuments">) =>
  resolveArtifactPathByContext({ ...input, jsonDocuments });

const fileMap = (files: readonly JavaScriptArtifactFile[]) =>
  new Map(files.map((value) => [value.path, value]));

const file = (
  path: string,
  container: string,
  text: string | null = "",
): JavaScriptArtifactFile => ({
  path,
  container_sha256: container.padEnd(64, "0").slice(0, 64),
  sha256: path.padEnd(64, "0").slice(0, 64),
  bytes: text?.length ?? 0,
  inventory_artifact_id: `artifact-${path}`,
  kind: path.endsWith("package.json") ? "package-json" : "javascript",
  unpacked: false,
  text:
    text === null
      ? { included: false, reason: "invalid-utf8" }
      : { included: true, value: text },
});

const aliasFiles = (
  entries: Readonly<Record<string, string | null>>,
): ReturnType<typeof fileMap> =>
  fileMap(
    Object.entries(entries).map(([path, text]) =>
      file(path, "root", text ?? ""),
    ),
  );

describe("exact HTML resource resolution", () => {
  it.each([
    ["extension", ["app.js"]],
    ["directory index", ["app/index.js"]],
    ["directory package", ["app/package.json", "app/entry.js"]],
  ] as const)("does not infer a file from %s fallback", (_name, paths) => {
    const files = fileMap([
      file("index.html", "root"),
      ...paths.map((path) =>
        file(
          path,
          "root",
          path.endsWith("package.json") ? '{"main":"entry.js"}' : "",
        ),
      ),
    ]);
    expect(
      resolve({
        declaredPath: "./app",
        sourcePath: "index.html",
        context: "html-reference",
        files,
      }),
    ).toMatchObject({ resolution_status: "not-found", resolved_path: null });
  });

  it("prefers an exact extensionless resource and retains URL suffix handling", () => {
    const files = fileMap([
      file("renderer/index.html", "root"),
      file("assets/app", "root"),
      file("assets/app.js", "root"),
      file("assets/app/index.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "./app?cache=1#v2",
        sourcePath: "renderer/index.html",
        context: "html-reference",
        htmlBaseHref: "/assets/",
        files,
      }),
    ).toMatchObject({
      declared_path: "./app?cache=1#v2",
      resolution_status: "resolved",
      resolved_path: "assets/app",
    });
  });
});

it.each(["require", "import"] as const)(
  "retains unknown Windows trailing-backslash package main semantics before %s probing",
  (moduleKind) => {
    const files = fileMap([
      file("entry.js", "root"),
      file(
        "node_modules/p/package.json",
        "root",
        JSON.stringify({ main: "lib\\" }),
      ),
      file("node_modules/p/lib", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "p",
        sourcePath: "entry.js",
        context: "module-specifier",
        moduleKind,
        files,
      }),
    ).toMatchObject({ resolution_status: "unavailable", resolved_path: null });
  },
);

describe("literal-percent runtime path resolution", () => {
  it.each([
    ["exact-file", "filesystem-expression"],
    ["exact-file", "module-specifier"],
    ["node-entrypoint", "filesystem-expression"],
  ] as const)(
    "preserves literal percent bytes for %s in %s",
    (runtimePathKind, context) => {
      const declaredPath = "./preload%2F%5C%2E.cjs";
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.cjs",
          context,
          runtimePathKind,
          files: fileMap([
            file("app/main.cjs", "root"),
            file("app/preload%2F%5C%2E.cjs", "root"),
            file("app/preload/entry.cjs", "root"),
          ]),
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_context: context,
        resolution_status: "resolved",
        resolved_path: "app/preload%2F%5C%2E.cjs",
        limitations: [],
      });
    },
  );

  it("keeps a file URL's decoded percent bytes literal at runtime lookup", () => {
    const analysis = analyzeJavaScriptStaticSource(`
      import { BrowserWindow } from "electron";
      import { fileURLToPath } from "node:url";
      new BrowserWindow({ webPreferences: {
        preload: fileURLToPath(new URL("./preload%252Fname.cjs", import.meta.url))
      }});
    `);
    const preload = analysis.role_paths.find(({ role }) => role === "preload");
    if (preload === undefined)
      throw new Error("Expected a static preload path");
    expect(analysis.parse_status).toBe("complete");
    expect(preload).toMatchObject({
      path: "./preload%2Fname.cjs",
      resolution_context: "filesystem-expression",
    });
    expect(
      resolve({
        declaredPath: preload.path,
        sourcePath: "app/main.mjs",
        context: preload.resolution_context,
        runtimePathKind: "exact-file",
        files: fileMap([
          file("app/main.mjs", "root"),
          file("app/preload%2Fname.cjs", "root"),
          file("app/preload/name.cjs", "root"),
          file("app/preload%252Fname.cjs", "root"),
        ]),
      }),
    ).toMatchObject({
      declared_path: "./preload%2Fname.cjs",
      resolution_status: "resolved",
      resolved_path: "app/preload%2Fname.cjs",
      limitations: [],
    });
  });

  it.each(["exact-file", "node-entrypoint"] as const)(
    "confines literal-percent filesystem paths for %s",
    (runtimePathKind) => {
      expect(
        resolve({
          declaredPath: "../../outside%2Fname.cjs",
          sourcePath: "app/main.cjs",
          context: "filesystem-expression",
          runtimePathKind,
          files: fileMap([
            file("app/main.cjs", "root"),
            file("outside%2Fname.cjs", "root"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: "rejected",
        resolved_path: null,
        limitations: [
          expect.stringContaining("escapes the canonical artifact root"),
        ],
      });
    },
  );

  it.each(["%2F", "%5C"])(
    "keeps %s rejected in a URL-owned runtime resource",
    (separator) => {
      expect(
        resolve({
          declaredPath: `file:///app/preload${separator}name.cjs`,
          sourcePath: "app/main.cjs",
          context: "module-specifier",
          runtimePathKind: "url-resource",
          files: fileMap([
            file("app/main.cjs", "root"),
            file(`app/preload${separator}name.cjs`, "root"),
            file("app/preload/name.cjs", "root"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: "rejected",
        resolved_path: null,
      });
    },
  );
});

describe("application-root Electron loadFile resolution", () => {
  it.each([
    "sub\\index.html",
    ".\\index.html",
    "C:index.html",
    "C:sub\\index.html",
  ])(
    "retains unknown Windows loadFile host semantics for %s",
    (declaredPath) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.cjs",
          context: "filesystem-expression",
          runtimePathKind: "application-file",
          applicationRootPath: "app",
          files: fileMap([
            file("app/main.cjs", "root"),
            file("app/sub/index.html", "root"),
            file("app/index.html", "root"),
          ]),
        }),
      ).toMatchObject({
        declared_path: declaredPath,
        resolution_status: "unavailable",
        resolved_path: null,
      });
    },
  );

  it.each([
    ["sub/index.html", "resolved", "app/sub/index.html"],
    ["sub\\index\0.html", "rejected", null],
  ] as const)(
    "keeps loadFile admission controls for %s",
    (declaredPath, status, path) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/main.cjs",
          context: "filesystem-expression",
          runtimePathKind: "application-file",
          applicationRootPath: "app",
          files: fileMap([
            file("app/main.cjs", "root"),
            file("app/sub/index.html", "root"),
          ]),
        }),
      ).toMatchObject({ resolution_status: status, resolved_path: path });
    },
  );

  it("confines a sibling path after applying a nested application root", () => {
    expect(
      resolve({
        declaredPath: "../shared/index.html",
        sourcePath: "app/main.cjs",
        context: "filesystem-expression",
        runtimePathKind: "application-file",
        applicationRootPath: "app",
        files: fileMap([
          file("app/main.cjs", "root"),
          file("shared/index.html", "root"),
        ]),
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "shared/index.html",
    });
  });
  it.each(["", "resources/app.asar"])(
    "resolves loadFile within application root %j instead of the calling script",
    (applicationRootPath) => {
      const prefix =
        applicationRootPath === "" ? "" : `${applicationRootPath}/`;
      const files = fileMap([
        file(`${prefix}sub/main.cjs`, "app"),
        file(`${prefix}dist%2Findex.html`, "app"),
        file(`${prefix}sub/dist%2Findex.html`, "app"),
        file(`${prefix}sub/absent.html`, "app"),
        file(`${prefix}fallback/index.html`, "app"),
        file(`${prefix}foreign.html`, "other-container"),
        file("outside.html", "other-container"),
      ]);
      const loadFile = (declaredPath: string) =>
        resolve({
          declaredPath,
          sourcePath: `${prefix}sub/main.cjs`,
          context: "filesystem-expression",
          runtimePathKind: "application-file",
          applicationRootPath,
          files,
        });
      expect(loadFile("dist%2Findex.html")).toMatchObject({
        runtime_path_base: "application-root",
        resolved_path: `${prefix}dist%2Findex.html`,
        resolution_status: "resolved",
      });
      expect(loadFile("/dist%2Findex.html")).toMatchObject({
        resolved_path: null,
        resolution_status: "unavailable",
      });
      for (const path of ["absent.html", "fallback", "foreign.html"])
        expect(loadFile(path)).toMatchObject({
          resolved_path: null,
          resolution_status: "not-found",
        });
      expect(loadFile("../../../../outside.html")).toMatchObject({
        resolved_path: null,
        resolution_status: "rejected",
      });
    },
  );
});

describe("exact Electron runtime entrypoint resolution", () => {
  it("requires a protocol for Electron URL resources", () => {
    const files = fileMap([
      file("app/main.cjs", "root"),
      file("app/renderer", "root"),
      file("app/renderer.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "./renderer",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "url-resource",
      }),
    ).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
      limitations: [expect.stringContaining("requires a URL protocol")],
    });
    expect(
      resolve({
        declaredPath: "file:///app/renderer",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "url-resource",
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/renderer",
    });
  });

  it("checks local paths exactly while preserving bare package lookup", () => {
    const files = fileMap([
      file("app/main.cjs", "root"),
      file("app/worker.js", "root"),
      file("app/worker", "root"),
      file("app/worker#v1.js", "root"),
      file(
        "node_modules/exported/package.json",
        "root",
        '{"exports":{"./parser":"./parser.cjs"}}',
      ),
      file("node_modules/exported/parser.cjs", "root"),
      file("app/fallback/index.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "./worker.js",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "exact-file",
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/worker.js",
    });
    expect(
      resolve({
        declaredPath: "exported/parser",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "exact-file",
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "node_modules/exported/parser.cjs",
    });
    expect(
      resolve({
        declaredPath: "./worker#v1.js",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "exact-file",
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/worker#v1.js",
    });
    expect(
      resolve({
        declaredPath: "./fallback",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "exact-file",
      }),
    ).toMatchObject({
      resolution_status: "not-found",
      resolved_path: null,
    });
  });

  it("accepts an exact extensionless file but not a directory index", () => {
    const files = fileMap([
      file("app/main.cjs", "root"),
      file("app/preload", "root"),
      file("app/preload.js", "root"),
      file("app/fallback/index.js", "root"),
    ]);
    expect(
      resolve({
        declaredPath: "./preload",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "exact-file",
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "app/preload",
    });
    expect(
      resolve({
        declaredPath: "./fallback",
        sourcePath: "app/main.cjs",
        context: "module-specifier",
        files,
        runtimePathKind: "exact-file",
      }),
    ).toMatchObject({
      resolution_status: "not-found",
      resolved_path: null,
    });
  });
});

it.each(["#home", "?theme=dark", ""])(
  "does not invent a document base for runtime URL %s",
  (declaredPath) => {
    expect(
      resolve({
        declaredPath,
        sourcePath: "main.cjs",
        context: "url-reference",
        runtimePathKind: "url-resource",
        files: fileMap([file("main.cjs", "root")]),
      }),
    ).toMatchObject({
      declared_path: declaredPath,
      resolution_status: "unavailable",
      resolved_path: null,
    });
  },
);

it("resolves Node runtime entrypoints without substituting emitted TypeScript sources", () => {
  const files = fileMap([
    file("main.ts", "root"),
    file("worker.ts", "root"),
    file("worker.js", "other-container"),
    file("runtime.js", "root"),
    file("directory/index.js", "root"),
  ]);
  for (const [declaredPath, status, path, candidatePath] of [
    ["./worker.js", "unavailable", null, "worker.js"],
    ["./runtime", "resolved", "runtime.js", undefined],
    ["./directory", "resolved", "directory/index.js", undefined],
  ] as const)
    expect(
      resolve({
        declaredPath,
        sourcePath: "main.ts",
        context: "module-specifier",
        files,
        runtimePathKind: "node-entrypoint",
      }),
    ).toMatchObject({
      resolution_status: status,
      resolved_path: path,
      ...(candidatePath === undefined ? {} : { candidate_path: candidatePath }),
    });
});

describe("Node launch package main ownership", () => {
  it.each(["index.js", "index.json", "index.cjs"])(
    "uses the same package index producer for a default launch with %s",
    (fallback) => {
      expect(
        resolve({
          declaredPath: "",
          sourcePath: "app/package.json",
          context: "package-entrypoint",
          runtimePathKind: "node-entrypoint",
          files: fileMap([
            file("app/package.json", "root"),
            file(`app/${fallback}`, "root"),
            file("app.js", "root"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: fallback === "index.cjs" ? "not-found" : "resolved",
        resolved_path: fallback === "index.cjs" ? null : `app/${fallback}`,
      });
    },
  );

  it("keeps unavailable main bytes ahead of a present package index", () => {
    const source = file("app/package.json", "root");
    expect(
      resolve({
        declaredPath: "declared.cjs",
        sourcePath: source.path,
        context: "package-entrypoint",
        runtimePathKind: "node-entrypoint",
        files: fileMap([source, file("app/index.js", "root")]),
        unanalyzedFiles: {
          get: (path) =>
            path === "app/declared.cjs"
              ? {
                  path,
                  container_sha256: source.container_sha256,
                  sha256: null,
                  bytes: null,
                  inventory_artifact_id: null,
                  kind: "javascript",
                  hash_status: "unavailable",
                  limitations: ["main readback unavailable"],
                }
              : undefined,
          coverage: completeInventoryCoverage,
          hasDirectory: () => false,
        },
      }),
    ).toMatchObject({
      resolution_status: "unavailable",
      resolved_path: null,
      candidate_path: "app/declared.cjs",
    });
  });

  it.each([
    ["missing.cjs", "index.js", "app/index.js"],
    ["sub/missing", "index.json", "app/index.json"],
    ["directory", "index.js", "app/index.js"],
    ["declared.cjs", "index.js", "app/declared.cjs"],
    ["missing.cjs", "index.cjs", null],
  ] as const)(
    "uses Node package main lookup for %s with %s",
    (declaredPath, fallback, expected) => {
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/package.json",
          context: "package-entrypoint",
          runtimePathKind: "node-entrypoint",
          files: fileMap([
            file("app/package.json", "root"),
            file(`app/${fallback}`, "root"),
            file("app/declared.cjs", "root"),
            file("app/directory/package.json", "root", '{"main":"nested.cjs"}'),
            file("app/directory/nested.cjs", "root"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: expected === null ? "not-found" : "resolved",
        resolved_path: expected,
      });
    },
  );

  it.each([
    [
      "app/package.json",
      "../resources/CODE.ASAR/window.cjs",
      "resources/CODE.ASAR/window.cjs",
      "package-entrypoint",
    ],
    [
      "resources/APP.ASAR/package.json",
      "../window.cjs",
      "resources/window.cjs",
      "package-entrypoint",
    ],
    [
      "main.cjs",
      "./resources/CODE.ASAR/window.cjs",
      "resources/CODE.ASAR/window.cjs",
      "filesystem-expression",
    ],
  ] as const)(
    "retains archive launch lookup for %s loading %s",
    (sourcePath, declaredPath, target, context) => {
      expect(
        resolve({
          sourcePath,
          declaredPath,
          context,
          runtimePathKind: "node-entrypoint",
          files: fileMap([file(sourcePath, "source"), file(target, "target")]),
        }),
      ).toMatchObject({ resolution_status: "resolved", resolved_path: target });
    },
  );

  it("does not use package fallback for a utility entrypoint or an unproven main container", () => {
    for (const [context, declaredPath, status] of [
      ["filesystem-expression", "./missing.cjs", "not-found"],
      ["package-entrypoint", "declared.cjs", "unavailable"],
      ["package-entrypoint", "../../escape.cjs", "rejected"],
    ] as const)
      expect(
        resolve({
          declaredPath,
          sourcePath: "app/package.json",
          context,
          runtimePathKind: "node-entrypoint",
          files: fileMap([
            file("app/package.json", "source"),
            file("app/index.js", "source"),
            file("app/declared.cjs", "foreign"),
          ]),
        }),
      ).toMatchObject({ resolution_status: status, resolved_path: null });
  });
});

it.each(["sub\\main.cjs", ".\\main.cjs", "C:main.cjs"])(
  "retains unknown host semantics for the Windows-relative entrypoint %s",
  (declaredPath) => {
    expect(
      resolve({
        declaredPath,
        sourcePath: "app/package.json",
        context: "filesystem-expression",
        runtimePathKind: "node-entrypoint",
        files: fileMap([
          file("app/package.json", "root"),
          file("app/main.cjs", "root"),
          file("app/sub/main.cjs", "root"),
        ]),
      }),
    ).toMatchObject({
      declared_path: declaredPath,
      resolution_status: "unavailable",
      resolved_path: null,
    });
  },
);

describe("package metadata at archive module boundaries", () => {
  it.each(["APP.ASAR", "app.AsAr"])(
    "preserves archive component bytes while admitting %s runtime crossings",
    (archive) => {
      const directory = `resources/${archive}`;
      const files = fileMap([
        file("main.cjs", "outer"),
        file(`${directory}/main.cjs`, "archive"),
        file(
          `${directory}/pkg/package.json`,
          "archive",
          '{"main":"actual.cjs"}',
        ),
        file(`${directory}/pkg/actual.cjs`, "archive"),
        file(`${directory}/pkg/index.js`, "archive"),
        file("resources/pkg/package.json", "outer", '{"main":"actual.cjs"}'),
        file("resources/pkg/actual.cjs", "outer"),
        file("resources/pkg/index.js", "outer"),
      ]);
      for (const [sourcePath, declaredPath, target] of [
        ["main.cjs", `./${directory}/pkg`, `${directory}/pkg/actual.cjs`],
        [`${directory}/main.cjs`, "../pkg", "resources/pkg/actual.cjs"],
      ] as const)
        expect(
          resolve({
            sourcePath,
            declaredPath,
            context: "module-specifier",
            moduleKind: "require",
            files,
          }),
        ).toMatchObject({
          resolution_status: "resolved",
          resolved_path: target,
        });
    },
  );

  it("does not admit same-archive or similarly named foreign containers", () => {
    for (const directory of ["resources/APP.ASAR", "resources/APP.ASAR-extra"])
      expect(
        resolve({
          sourcePath: `${directory}/main.cjs`,
          declaredPath: "./window.cjs",
          context: "module-specifier",
          moduleKind: "require",
          files: fileMap([
            file(`${directory}/main.cjs`, "source"),
            file(`${directory}/window.cjs`, "foreign"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: "unavailable",
        resolved_path: null,
      });
  });
  it.each([
    ["resources/app.asar/main.cjs", "../pkg", "resources/pkg"],
    ["app/main.cjs", "../resources/code.asar/pkg", "resources/code.asar/pkg"],
    [
      "resources/app.asar/main.cjs",
      "fixture",
      "resources/node_modules/fixture",
    ],
  ])(
    "uses the selected package main for %s loading %s",
    (sourcePath, declaredPath, directory) => {
      expect(
        resolve({
          sourcePath,
          declaredPath,
          context: "module-specifier",
          moduleKind: "require",
          files: fileMap([
            file(sourcePath, "source"),
            file(
              `${directory}/package.json`,
              "target",
              '{"main":"actual.cjs"}',
            ),
            file(`${directory}/actual.cjs`, "target"),
            file(`${directory}/index.js`, "target"),
          ]),
        }),
      ).toMatchObject({
        resolution_status: "resolved",
        resolved_path: `${directory}/actual.cjs`,
      });
    },
  );

  it("keeps metadata-less ancestor package directories after an archive escape", () => {
    expect(
      resolve({
        sourcePath: "resources/app.asar/main.cjs",
        declaredPath: "fixture/parser",
        context: "module-specifier",
        moduleKind: "require",
        files: fileMap([
          file("resources/app.asar/main.cjs", "source"),
          file("resources/node_modules/fixture/parser.js", "target"),
        ]),
      }),
    ).toMatchObject({
      resolution_status: "resolved",
      resolved_path: "resources/node_modules/fixture/parser.js",
    });
  });

  it.each(["resources/app.asar/main.cjs", "resources/main.cjs"])(
    "keeps unread metadata blocking a decoy index for %s",
    (sourcePath) => {
      const path = "resources/pkg/package.json";
      const target = file(path, "target", null);
      const files = fileMap([
        file(sourcePath, "source"),
        file("resources/pkg/index.js", "source"),
      ]);
      for (const opaque of [false, true]) {
        expect(
          resolve({
            sourcePath,
            declaredPath: sourcePath.includes(".asar/") ? "../pkg" : "./pkg",
            context: "module-specifier",
            moduleKind: "require",
            files: opaque ? files : fileMap([...files.values(), target]),
            unanalyzedFiles: {
              get: (requested) =>
                opaque && requested === path ? target : undefined,
              coverage: completeInventoryCoverage,
              hasDirectory: () => false,
            },
          }),
        ).toMatchObject({
          resolution_status: "unavailable",
          resolved_path: null,
        });
      }
    },
  );
});

it("distinguishes an unobserved bare package from builtins and blocked aliases", () => {
  const files = aliasFiles({
    "package.json": JSON.stringify({
      imports: { "#blocked": null, "#builtin": "node:path" },
    }),
    "main.js": "",
  });
  const resolveName = (declaredPath: string) =>
    resolve({
      declaredPath,
      sourcePath: "main.js",
      context: "module-specifier",
      moduleKind: "require",
      files,
    });
  expect(resolveName("outside-package")).toMatchObject({
    resolution_status: "external",
    unexamined_module_imports: true,
  });
  for (const name of ["node:path", "electron", "#blocked", "#builtin"])
    expect(resolveName(name), name).not.toHaveProperty(
      "unexamined_module_imports",
    );
});
