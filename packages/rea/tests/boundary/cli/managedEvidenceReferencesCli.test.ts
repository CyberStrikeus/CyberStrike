import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import {
  MANAGED_APPLICATION_GRAPH_EXAMPLE,
  MANAGED_NATIVE_VERIFICATION_EXAMPLE,
  MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
} from "../../../src/contracts/managed/managedWorkflowExamples.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const reference = (evidence: Evidence) => ({
  kind: "retained-evidence" as const,
  evidence_id: evidence.evidence_id,
});

cliTest(
  "uses an explicitly selected bundle for managed Evidence workflows without rewriting it",
  async ({ cli }) => {
    const directory = await createTestTempDirectory("rea-managed-ref-cli-");
    const bundleName = " selected evidence.json";
    const members = MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE.static_members;
    const records = [
      members,
      MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
      ...MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations,
    ];
    const bytes = JSON.stringify(createEvidenceBundle(records));
    await writeFile(join(directory, bundleName), bytes);

    const scenarios = [
      {
        command: "project-managed-application-graph",
        inline: MANAGED_APPLICATION_GRAPH_EXAMPLE,
        retained: { managed_members: reference(members) },
      },
      {
        command: "import-managed-reconstruction",
        inline: MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
        retained: {
          ...MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
          static_members: reference(members),
        },
      },
      {
        command: "verify-managed-native-boundaries",
        inline: MANAGED_NATIVE_VERIFICATION_EXAMPLE,
        retained: {
          managed_boundaries: reference(
            MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
          ),
          native_observations:
            MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations.map(
              reference,
            ),
        },
      },
    ];

    for (const scenario of scenarios) {
      const inline = await cli.run({
        arguments: [
          scenario.command,
          JSON.stringify(scenario.inline),
          "--json",
        ],
        cwd: directory,
      });
      expect(inline.exitCode, inline.stderr).toBe(0);
      const retained = await cli.run({
        arguments: [
          scenario.command,
          JSON.stringify(scenario.retained),
          "--evidence-bundle",
          bundleName,
          "--json",
        ],
        cwd: directory,
      });
      expect(retained.exitCode, retained.stderr).toBe(0);
      expect(parseEvidence(retained.json)).toEqual(parseEvidence(inline.json));
    }

    const missingContext = await cli.run({
      arguments: [
        "project-managed-application-graph",
        JSON.stringify({ managed_members: reference(members) }),
        "--json",
      ],
      cwd: directory,
    });
    expect(missingContext.exitCode, missingContext.stderr).toBe(1);
    expect(missingContext.json).toMatchObject({
      details: { evidence_id: members.evidence_id, reason: "missing" },
    });
    expect(await readFile(join(directory, bundleName), "utf8")).toBe(bytes);
  },
);
