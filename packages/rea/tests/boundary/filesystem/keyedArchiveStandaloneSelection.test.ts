import { createHash } from "node:crypto";
import { chmod, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "plist";
import { expect, it } from "vitest";

import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { createAnalysisExecutionEvidence } from "../../../src/domain/analysisObservation.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.skipIf(process.platform === "win32")(
  "retains standalone archive aliases across session selection and refuses retargeted selections",
  async () => {
    const root = await createTestTempDirectory("rea-keyed-alias-");
    const stored = join(root, "stored.plist");
    const other = join(root, "other.plist");
    const aliases = [join(root, "chosen.plist"), join(root, "second.plist")];
    const bytes = build({
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null", "leaf"],
      $top: { root: { CF$UID: 1 } },
    });
    await writeFile(stored, bytes);
    await writeFile(other, bytes);
    for (const alias of aliases) await symlink(stored, alias);
    const session = composeBinarySession(
      new AnalysisProviderRegistry([], "auto", () => true),
      [new ArtifactProvider(process.env)],
    );
    try {
      for (const alias of aliases) {
        const opened = await session.open(alias);
        if (!opened.ok) throw opened.error;
        for (const parameters of [
          {},
          { path: alias.split("/").at(-1)! },
          { path: "." },
        ]) {
          const inspected = await session.execute(
            "inspect_keyed_archive",
            parameters,
          );
          if (!inspected.ok) throw inspected.error;
          const evidence = createAnalysisExecutionEvidence(
            "inspect_keyed_archive",
            parameters,
            inspected.value,
            "observed",
          );
          expect(evidence.subject).toMatchObject({
            local_path: alias,
            digest: {
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          });
          expect(evidence.normalized_result).toMatchObject({
            archive_path: alias.split("/").at(-1),
            objects: expect.arrayContaining([
              expect.objectContaining({ value: "leaf" }),
            ]),
          });
        }
        const physicalSelection = await session.execute(
          "inspect_keyed_archive",
          { path: "stored.plist" },
        );
        if (!physicalSelection.ok) throw physicalSelection.error;
        expect(physicalSelection.value.result).toMatchObject({
          archive_path: "stored.plist",
        });
        expect(physicalSelection.value.subject).toMatchObject({ path: alias });
        expect(
          await session.execute("inspect_keyed_archive", {
            path: "unrelated.plist",
          }),
        ).toMatchObject({
          ok: false,
          error: {
            _tag: "AnalysisInputError",
            issues: [
              {
                path: ["path"],
                reason: "invalid_value",
                expected: [alias.split("/").at(-1), "stored.plist"],
              },
            ],
          },
        });
      }
      await unlink(aliases[1]!);
      await symlink(other, aliases[1]!);
      expect(await session.execute("inspect_keyed_archive", {})).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisArtifactChangedError" },
      });
      await unlink(aliases[1]!);
      expect(await session.execute("inspect_keyed_archive", {})).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisArtifactChangedError" },
      });
      await symlink(stored, aliases[1]!);
      if (process.getuid?.() !== 0) {
        await chmod(stored, 0);
        try {
          expect(
            await session.execute("inspect_keyed_archive", {}),
          ).toMatchObject({
            ok: false,
            error: { _tag: "AnalysisAccessDeniedError" },
          });
        } finally {
          await chmod(stored, 0o600);
        }
      }
      const cancelled = new AbortController();
      cancelled.abort("caller-stopped");
      expect(
        await session.execute(
          "inspect_keyed_archive",
          {},
          { signal: cancelled.signal },
        ),
      ).toMatchObject({ ok: false, error: { _tag: "AnalysisCancelledError" } });
      await writeFile(stored, "not a keyed archive");
      expect(await session.execute("inspect_keyed_archive", {})).toMatchObject({
        ok: false,
        error: {
          reason: "integrity",
          detail: expect.stringContaining("Active archive digest changed"),
        },
      });
      await truncate(stored, 64 * 1024 * 1024 + 1);
      expect(await session.execute("inspect_keyed_archive", {})).toMatchObject({
        ok: false,
        error: {
          reason: "limit",
          detail: expect.stringContaining("67108864 bytes"),
        },
      });
    } finally {
      expect(await session.close()).toEqual({ ok: true, value: null });
    }
  },
);
