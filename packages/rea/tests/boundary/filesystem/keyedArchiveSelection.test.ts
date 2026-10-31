import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  truncate,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { build } from "plist";
import { expect, it } from "vitest";

import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { inspectBundleKeyedArchive } from "../../../src/artifacts/apple/KeyedArchiveReader.js";
import { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import {
  AnalysisAccessDeniedError,
  AnalysisInputError,
  AnalysisUnsupportedTargetError,
} from "../../../src/domain/analysisErrorCore.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const archive = build({
  $archiver: "NSKeyedArchiver",
  $version: 100000,
  $objects: ["$null", "value"],
  $top: { root: { CF$UID: 1 }, other: { CF$UID: 1 } },
});

const bundle = async () => {
  const root = await createTestTempDirectory("rea-keyed-selection-");
  await mkdir(join(root, "Contents", "Resources"), { recursive: true });
  await writeFile(
    join(root, "Contents", "Resources", "Model.plist"),
    Buffer.from(archive),
  );
  return root;
};

const inspect = (bundlePath: string, parameters: Record<string, unknown>) =>
  inspectBundleKeyedArchive({
    bundlePath,
    targetSha256: "a".repeat(64),
    parameters,
    platform: "darwin",
  });

it.each([
  [".", "invalid_format", "relative to the active app bundle"],
  ["Contents/../Model.plist", "invalid_format", "canonical relative"],
  ["Contents//Model.plist", "invalid_format", "canonical relative"],
  ["Contents/Resources", "invalid_value", "selects a directory"],
  ["Contents/Resources/Missing.plist", "invalid_value", "No regular file"],
] as const)(
  "reports caller-selected archive path %j as invalid input",
  async (path, reason, message) => {
    const root = await bundle();
    const rejected = await inspect(root, { path }).catch(
      (cause: unknown) => cause,
    );
    expect(rejected).toBeInstanceOf(AnalysisInputError);
    expect(rejected).toMatchObject({
      issues: [
        {
          path: ["path"],
          reason,
          message: expect.stringContaining(message),
        },
      ],
    });
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "rejects a selected unreadable directory before descending into it",
  async () => {
    const root = await bundle();
    const selected = join(root, "Contents", "Resources");
    await chmod(selected, 0);
    try {
      await expect(readdir(selected)).rejects.toMatchObject({ code: "EACCES" });
      await expect(
        inspect(root, { path: "Contents/Resources" }),
      ).rejects.toMatchObject({
        issues: [
          {
            path: ["path"],
            reason: "invalid_value",
            message: expect.stringContaining("selects a directory"),
          },
        ],
      });
    } finally {
      await chmod(selected, 0o700);
    }
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "inspects an active standalone archive without opening unrelated directories",
  async () => {
    const root = await createTestTempDirectory("rea-keyed-standalone-scope-");
    const path = join(root, "Model.plist");
    const bytes = Buffer.from(archive);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path, bytes);
    const blocked = join(root, "unrelated");
    await mkdir(blocked);
    await chmod(blocked, 0);
    try {
      await expect(readdir(blocked)).rejects.toMatchObject({ code: "EACCES" });
      const result = await new ArtifactProvider(process.env, "darwin")
        .createClient({ path, sha256, kind: "artifact", format: "plist" })
        .execute("inspect_keyed_archive", {});
      if (!result.ok) throw result.error;
      expect(result.value.result).toMatchObject({
        archive_path: "Model.plist",
        archive_sha256: sha256,
      });
    } finally {
      await chmod(blocked, 0o700);
    }
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports the selected oversized archive limit despite an unreadable sibling",
  async () => {
    const root = await createTestTempDirectory("rea-keyed-size-scope-");
    const path = join(root, "Large.plist");
    await writeFile(path, archive);
    await truncate(path, 64 * 1024 * 1024 + 1);
    const blocked = join(root, "unrelated");
    await mkdir(blocked);
    await chmod(blocked, 0);
    try {
      await expect(readdir(blocked)).rejects.toMatchObject({ code: "EACCES" });
      await expect(
        inspect(root, { path: "Large.plist" }),
      ).rejects.toMatchObject({
        reason: "limit",
        message: "Keyed archive exceeds 64 MiB",
      });
    } finally {
      await chmod(blocked, 0o700);
    }
  },
);

it("reports an absent named root with the archive's available roots", async () => {
  const root = await bundle();
  await expect(
    inspect(root, { path: "Contents/Resources/Model.plist", root: "missing" }),
  ).rejects.toMatchObject({
    issues: [
      {
        path: ["root"],
        reason: "invalid_value",
        message: expect.stringContaining("missing"),
        expected: ["root", "other"],
      },
    ],
  });
});

it.each(["UID", "CF$UID"])(
  "keeps a sole scalar %s root free of false references through the file reader",
  async (rootName) => {
    const root = await bundle();
    await writeFile(
      join(root, "Contents", "Resources", "Scalar.plist"),
      Buffer.from(
        build({
          $archiver: "NSKeyedArchiver",
          $version: 100000,
          $objects: ["$null"],
          $top: { [rootName]: 1 },
        }),
      ),
    );

    const result = await inspect(root, {
      path: "Contents/Resources/Scalar.plist",
    });

    expect(result.roots).toEqual({ [rootName]: 1 });
    expect(result.references).toEqual([]);
    expect(result.total_references).toBe(0);
  },
);

it.each([
  [
    "plain plist",
    Buffer.from(build({ plain: true })),
    "it has no $archiver key",
    "inspect_plist",
  ],
  [
    "plist with another archiver",
    Buffer.from(build({ $archiver: "NSArchiver", $objects: [] })),
    'its $archiver is "NSArchiver"',
    "inspect_plist",
  ],
  [
    "compiled NIBArchive",
    Buffer.concat([Buffer.from("NIBArchive"), Buffer.alloc(40)]),
    "compiled NIBArchive",
    "decode_interface_builder",
  ],
])(
  "reports a selected %s as an unsupported target with the workflow that reads it",
  async (_label, bytes, reason, workflow) => {
    const root = await bundle();
    await writeFile(join(root, "Contents", "Resources", "Other.nib"), bytes);
    const rejected = await inspect(root, {
      path: "Contents/Resources/Other.nib",
    }).catch((cause: unknown) => cause);
    expect(rejected).toBeInstanceOf(AnalysisUnsupportedTargetError);
    expect(projectAnalysisError(asAnalysisError(rejected))).toMatchObject({
      code: "unsupported_target",
      message: expect.stringContaining(reason),
      remediation: { action: expect.stringContaining(workflow) },
      details: {
        operation: "inspect_keyed_archive",
        path: join(root, "Contents", "Resources", "Other.nib"),
      },
    });
  },
);

it.each([
  ["darwin", "Inspect an ordinary property list with inspect_plist"],
  [
    "linux",
    "inspect_plist, which reads ordinary property lists, requires a macOS host",
  ],
] as const)(
  "names the property-list workflow available on a %s host",
  async (platform, action) => {
    const root = await createTestTempDirectory("rea-keyed-kind-");
    const path = join(root, "Defaults.plist");
    const bytes = Buffer.from(build({ plain: true }));
    await writeFile(path, bytes);
    const result = await new ArtifactProvider(process.env, platform)
      .createClient({
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        kind: "artifact",
        format: "plist",
      })
      .execute("inspect_keyed_archive", {});
    if (result.ok) throw new Error("Expected an unsupported target");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "unsupported_target",
      remediation: { action: expect.stringContaining(action) },
      details: { path },
    });
  },
);

it("keeps a damaged NSKeyedArchiver archive a format failure", async () => {
  const root = await bundle();
  await writeFile(
    join(root, "Contents", "Resources", "Damaged.plist"),
    Buffer.from(build({ $archiver: "NSKeyedArchiver", $top: {} })),
  );
  const rejected = await inspect(root, {
    path: "Contents/Resources/Damaged.plist",
  }).catch((cause: unknown) => cause);
  expect(rejected).toBeInstanceOf(ArtifactReaderFailure);
  expect(rejected).toMatchObject({
    reason: "format",
    message: expect.stringContaining("$objects array"),
  });
});

it("selects a decomposed bundle path by its normalized spelling and reports the raw identity", async () => {
  const root = await bundle();
  const rawPath = `Contents/Resources/Caf\u0065\u0301.plist`;
  const bytes = Buffer.from(archive);
  await writeFile(join(root, rawPath), bytes);

  const result = await inspect(root, {
    path: rawPath.normalize("NFC"),
  });

  expect(result.archive_path).toBe(rawPath);
  expect(result.archive_sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
});

it("selects normalized intermediate directories while preserving their raw spelling", async () => {
  const root = await createTestTempDirectory("rea-keyed-unicode-ancestors-");
  const directory = "Cafe\u0301/Neste\u0301";
  const rawPath = `${directory}/Model.plist`;
  await mkdir(join(root, directory), { recursive: true });
  await writeFile(join(root, rawPath), archive);
  const result = await inspect(root, { path: rawPath.normalize("NFC") });
  expect(result.archive_path).toBe(rawPath);
});

it.skipIf(process.platform === "darwin" || process.platform === "win32")(
  "rejects equivalent archive paths beneath distinct Unicode-equivalent directories",
  async () => {
    const root = await createTestTempDirectory("rea-keyed-unicode-branches-");
    for (const directory of ["Caf\u00e9", "Cafe\u0301"]) {
      await mkdir(join(root, directory));
      await writeFile(join(root, directory, "Model.plist"), archive);
    }
    await expect(
      inspect(root, { path: "Caf\u00e9/Model.plist" }),
    ).rejects.toMatchObject({
      issues: [
        {
          path: ["path"],
          reason: "invalid_value",
          message: expect.stringContaining("Unicode-equivalent"),
        },
      ],
    });
  },
);

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
  "reports a read-denied selected archive as host access denial",
  async () => {
    const root = await bundle();
    const selected = join(root, "Contents", "Resources", "Model.plist");
    await chmod(selected, 0);
    try {
      await expect(readFile(selected)).rejects.toMatchObject({
        code: "EACCES",
      });
      const rejected = await inspect(root, {
        path: "Contents/Resources/Model.plist",
      }).catch((cause: unknown) => cause);
      expect(rejected).toBeInstanceOf(AnalysisAccessDeniedError);
      expect(rejected).toMatchObject({
        operation: "inspect_keyed_archive",
        path: selected,
        systemCode: "EACCES",
      });
      const projected = projectAnalysisError(
        rejected as AnalysisAccessDeniedError,
      );
      expect(projected).toMatchObject({
        code: "access_denied",
        category: "unavailable",
        retryable: false,
        details: {
          path: selected,
          system_code: "EACCES",
          boundary: "filesystem-read",
        },
      });
      expect(projected.remediation.action).toContain("read access");
    } finally {
      await chmod(selected, 0o700);
    }
  },
);

it("keeps an archive readable while preserving a known non-finite real", async () => {
  const root = await bundle();
  const bytes = Buffer.from(
    build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null", Number.NaN],
      $top: { root: { CF$UID: 1 } },
    }),
  );
  await writeFile(
    join(root, "Contents", "Resources", "NonFinite.plist"),
    bytes,
  );

  const result = await inspect(root, {
    path: "Contents/Resources/NonFinite.plist",
  });

  expect(result.objects).toContainEqual(
    expect.objectContaining({
      id: 1,
      kind: "scalar",
      status: "observed",
      value: { $plist_type: "real", value: "nan" },
    }),
  );
  expect(result.limitations).toContain(
    '1 non-finite real value(s) are reported as { "$plist_type": "real", "value": "<spelling>" } using canonical numeric labels nan, +infinity or -infinity because a JSON number cannot carry them.',
  );
});

const asAnalysisError = (value: unknown): AnalysisError => {
  if (!(value instanceof AnalysisError)) throw value;
  return value;
};
