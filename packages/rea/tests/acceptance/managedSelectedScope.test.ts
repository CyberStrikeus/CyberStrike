import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../src/domain/evidence.js";
import { managedMemberInspectionSchema } from "../../src/domain/managed/managedArtifact.js";
import { managedMemberComparisonResultSchema } from "../../src/domain/managed/managedMemberComparison.js";
import {
  distinctSelectedNestedOwners,
  namespaceBearingNestedTypes,
} from "../fixtures/managedSelectedScope.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { cliTest } from "../support/cli/cliFixture.js";

cliTest(
  "compares actual selected type scope from public CLI Evidence through stdio MCP after source removal",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-managed-selected-scope-");
    const path = join(root, "selected.dll");
    const bytes = namespaceBearingNestedTypes();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path, bytes);
    const sources: ReturnType<typeof parseEvidence>[] = [];
    for (const selection of [
      ["Inner"],
      ["Inner", "Fixture.Inner"],
      ["Fixture.Inner"],
    ]) {
      const output = await cli.sharedCliRun!({
        arguments: [
          "inspect-managed-members",
          path,
          ...selection.flatMap((name) => ["--type", name]),
          "--json",
        ],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const evidence = parseEvidence(output.json);
      const report = managedMemberInspectionSchema.parse(
        evidence.normalized_result,
      );
      expect(report.artifact).toMatchObject({ path, sha256 });
      expect(report.selection).toEqual({
        type_names: selection,
        unmatched_type_names: [],
      });
      expect(report.coverage.state).toBe("complete");
      sources.push(evidence);
    }
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    await rm(path);
    const call = await cli.sharedMcpCall!();
    for (const [index, right] of sources.slice(1).entries()) {
      const response = await call("compare_managed_members", {
        left: sources[0]!,
        right,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const evidence = parseEvidence(response.structuredContent);
      const report = managedMemberComparisonResultSchema.parse(
        evidence.normalized_result,
      );
      expect(report.evidence_links).toEqual([
        sources[0]!.evidence_id,
        right.evidence_id,
      ]);
      expect(report.coverage.status).toBe(
        index === 0 ? "complete-within-inputs" : "partial",
      );
      expect(report.summary).toMatchObject({ added: 0, removed: 0 });
      if (index === 0)
        expect(report.limitations).toContain(
          "Both observations cover only the selected declaring types (Fixture.Inner, Inner); member totals and statuses describe those types, not the whole assembly.",
        );
      else {
        expect(report.summary.unknown).toBeGreaterThan(0);
        expect(report.limitations).toContain(
          "The observations select different declaring types; a member outside the other side's selection is unknown, not added or removed.",
        );
      }
    }
  },
);

cliTest(
  "preserves nominal selected membership and whole-inventory absence through CLI Evidence and stdio MCP after source removal",
  async ({ cli }) => {
    const root = await createTestTempDirectory(
      "rea-managed-nominal-membership-",
    );
    const bytes = distinctSelectedNestedOwners();
    const selected: ReturnType<typeof parseEvidence>[] = [];
    const whole: ReturnType<typeof parseEvidence>[] = [];
    for (const [name, content] of Object.entries(bytes)) {
      const path = join(root, `${name}.dll`);
      const sha256 = createHash("sha256").update(content).digest("hex");
      await writeFile(path, content);
      for (const isSelected of [true, false]) {
        const output = await cli.sharedCliRun!({
          arguments: [
            "inspect-managed-members",
            path,
            ...(isSelected ? ["--type", "Fixture.Inner"] : []),
            "--json",
          ],
        });
        expect(output.exitCode, output.stderr).toBe(0);
        const evidence = parseEvidence(output.json);
        const report = managedMemberInspectionSchema.parse(
          evidence.normalized_result,
        );
        expect(report.artifact).toMatchObject({ path, sha256 });
        expect(report.coverage.state).toBe("complete");
        if (isSelected) {
          expect(report.selection).toEqual({
            type_names: ["Fixture.Inner"],
            unmatched_type_names: [],
          });
          expect(report.types).toHaveLength(1);
          expect(report.types[0]).toMatchObject({
            full_name: "Fixture.Inner",
            token: "0x02000004",
          });
          expect(report.types[0]?.name_sha256).toMatch(/^[a-f0-9]{64}$/u);
          selected.push(evidence);
        } else {
          expect(report.selection).toBeNull();
          whole.push(evidence);
        }
      }
      expect(Buffer.compare(await readFile(path), content)).toBe(0);
      await rm(path);
    }
    const left = managedMemberInspectionSchema.parse(
      selected[0]!.normalized_result,
    );
    const right = managedMemberInspectionSchema.parse(
      selected[1]!.normalized_result,
    );
    expect(left.types[0]?.name_sha256).not.toBe(right.types[0]?.name_sha256);
    const call = await cli.sharedMcpCall!();
    for (const [sources, isSelected] of [
      [selected, true],
      [whole, false],
    ] as const) {
      const response = await call("compare_managed_members", {
        left: sources[0]!,
        right: sources[1]!,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      const evidence = parseEvidence(response.structuredContent);
      const report = managedMemberComparisonResultSchema.parse(
        evidence.normalized_result,
      );
      expect(report.evidence_links).toEqual(
        sources.map(({ evidence_id }) => evidence_id),
      );
      expect(report.left.artifact_sha256).toBe(left.artifact.sha256);
      expect(report.right.artifact_sha256).toBe(right.artifact.sha256);
      expect(report.coverage.status).toBe(
        isSelected ? "partial" : "complete-within-inputs",
      );
      expect(report.summary).toEqual({
        added: isSelected ? 0 : 5,
        removed: isSelected ? 0 : 5,
        unknown: isSelected ? 4 : 0,
        changed: 0,
        unchanged: 0,
      });
      if (isSelected) {
        expect(report.methods).toHaveLength(2);
        expect(report.fields).toHaveLength(2);
        for (const item of [...report.methods, ...report.fields]) {
          expect(item.match.status).toBe("unmatched");
          expect(item.left?.declaring_type ?? item.right?.declaring_type).toBe(
            "Fixture.Inner",
          );
          expect(item.evidence_links).toEqual(report.evidence_links);
        }
      }
    }
  },
);
