import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, onTestFinished } from "vitest";

import { readAnalysisSnapshot } from "../../../src/application/binary/AnalysisSnapshotFiles.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createAnalysisProfile } from "../../../src/domain/analysisProfile.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { MANAGED_STATIC_PROVIDER } from "../../../src/domain/investigationProviders.js";
import { ok } from "../../../src/domain/result.js";
import { ManagedStaticProvider } from "../../../src/dotnet/ManagedStaticProvider.js";
import { buildManagedPeFixture } from "../../../src/dotnet/ManagedPe.fixture.js";
import { silentLogger } from "../../../src/logger.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { withAdmittedAnalysis } from "../../../src/server/analysisAdmission.js";
import { registerEvidenceTools } from "../../../src/server/registerEvidenceTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

const createSnapshotReplayFixture = async (missingSource: boolean) => {
  const directory = await createTestTempDirectory("rea-snapshot-source-mcp-");
  const path = join(directory, "application.exe");
  const snapshotPath = join(directory, "historical.json");
  await writeFile(path, buildManagedPeFixture());
  const provider = new ManagedStaticProvider();
  const profile = createAnalysisProfile(MANAGED_STATIC_PROVIDER, {
    fixture: "snapshot-source-delivery",
  });
  // A concrete profile selects the real static reader for this session-boundary
  // integration. Normal managed composition uses a profileless auxiliary route.
  const session = createTestBinarySession(provider, {
    resolveAnalysisProfile: () => Promise.resolve(ok({ profile })),
  });
  onTestFinished(async () => {
    const closed = await session.close();
    if (!closed.ok) throw closed.error;
  });
  const opened = await session.open(path);
  if (!opened.ok) throw opened.error;
  const facts = [];
  for (const operation of [
    "inspect_managed_members",
    "inspect_managed_native_boundaries",
    "inspect_managed_artifact",
  ] as const) {
    const execution = await session.execute(operation, {});
    if (!execution.ok) throw execution.error;
    const evidenceId = execution.value.evidenceId;
    const evidence =
      evidenceId === undefined ? undefined : session.evidenceById(evidenceId);
    if (evidence === undefined)
      throw new Error("Real managed observation was not retained");
    facts.push(evidence);
  }
  const [ancestor, sourceFacts, parentFacts] = facts;
  if (
    ancestor === undefined ||
    sourceFacts === undefined ||
    parentFacts === undefined
  )
    throw new Error("Expected three managed observations");
  const linked = (evidence: typeof parentFacts, sourceId: string) =>
    createEvidence(opened.value, provider.identity(), {
      operation: evidence.operation,
      parameters: evidence.parameters,
      result: evidence.normalized_result,
      rawResult: evidence.raw_result,
      analysisProfile: profile,
      limitations: evidence.limitations,
      locations: evidence.locations,
      evidenceLinks: [sourceId],
    });
  const source = linked(sourceFacts, ancestor.evidence_id);
  const parent = linked(parentFacts, source.evidence_id);
  const exported = session.exportAnalysisSnapshot();
  if (!exported.ok) throw exported.error;
  // Persist a valid historical snapshot whose primitive entries have source
  // links. Current record() excludes these because entries alone omit sources.
  const written = await session.writeAnalysisSnapshot(
    {
      ...exported.value,
      entries: missingSource
        ? exported.value.entries.filter(
            (entry) => entry.operation !== source.operation,
          )
        : exported.value.entries,
      evidence_bundle: createEvidenceBundle(
        missingSource ? [ancestor, parent] : [ancestor, source, parent],
      ),
    },
    snapshotPath,
    false,
  );
  if (!written.ok) throw written.error;
  const closed = await session.close();
  if (!closed.ok) throw closed.error;
  const loaded = await readAnalysisSnapshot(snapshotPath);
  if (!loaded.ok) throw loaded.error;
  const historicalBytes = await readFile(snapshotPath);
  const reopened = await session.open(path, { snapshot: loaded.value });
  if (!reopened.ok) throw reopened.error;
  await unlink(path);
  return {
    directory,
    snapshotPath,
    session,
    ancestor,
    source,
    parent,
    historicalBytes,
  };
};

for (const missingSource of [false, true])
  mcpTest(
    missingSource
      ? "declines snapshot replay when its immediate source record is unavailable"
      : "preserves immediate and transitive imported snapshot provenance through MCP Evidence delivery",
    async ({ mcp }) => {
      const {
        directory,
        snapshotPath,
        session,
        ancestor,
        source,
        parent,
        historicalBytes,
      } = await createSnapshotReplayFixture(missingSource);

      // Exercise the same named-contract production adapter as the official tools,
      // directly on the session so managed's independent-service route cannot bypass replay.
      const server = new EvidenceMcpServer(
        { name: "snapshot-source-delivery", version: "1" },
        { capabilities: {} },
        session.recordEvidence.bind(session),
        createToolResultDelivery(undefined),
      );
      registerEvidenceTools(
        server,
        [toolContract("inspect_managed_artifact")],
        {
          logger: silentLogger,
          activeTarget: () => session.activeTarget(),
          recordEvidence: session.recordEvidence.bind(session),
          withAdmittedAnalysis: withAdmittedAnalysis({
            kind: "session",
            session,
          }),
        },
      );
      const client = await mcp.connect(server);
      const response = await client.callTool({
        name: "inspect_managed_artifact",
        arguments: {},
      });
      if (missingSource) {
        expect(parseMcpToolError(response)).toMatchObject({
          error: { code: "target_unavailable" },
        });
        expect(session.evidenceById(parent.evidence_id)).toEqual(parent);
        expect(session.evidenceById(source.evidence_id)).toBeUndefined();
        expect(session.evidenceById(ancestor.evidence_id)).toEqual(ancestor);
        expect((await readFile(snapshotPath)).equals(historicalBytes)).toBe(
          true,
        );
        return;
      }
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const replayed = parseEvidence(response.structuredContent);
      expect(replayed.normalized_result).toEqual(parent.normalized_result);
      expect(replayed.evidence_links).toEqual([source.evidence_id]);
      expect(replayed.evidence_links).not.toContain(ancestor.evidence_id);
      expect(session.evidenceById(replayed.evidence_id)).toEqual(replayed);
      expect(session.evidenceById(parent.evidence_id)).toEqual(parent);
      expect(session.evidenceById(source.evidence_id)).toEqual(source);
      expect(session.evidenceById(ancestor.evidence_id)).toEqual(ancestor);
      expect(session.evidenceById(source.evidence_id)?.evidence_links).toEqual([
        ancestor.evidence_id,
      ]);
      const firstReplay = await session.execute("inspect_managed_artifact", {});
      if (!firstReplay.ok) throw firstReplay.error;
      expect(firstReplay.value.sourceEvidence?.[0]).toBe(
        session.evidenceForAnalysis(source.evidence_id),
      );
      expect(Object.isFrozen(firstReplay.value.sourceEvidence?.[0])).toBe(true);

      if (source.subject === null)
        throw new Error("Expected a file-backed source");
      const relocated = {
        ...source,
        subject: {
          ...source.subject,
          local_path: join(directory, "relocated.exe"),
        },
      };
      const imported = session.importEvidenceBundle(
        createEvidenceBundle([relocated]),
      );
      if (!imported.ok) throw imported.error;
      const refreshed = await session.execute("inspect_managed_artifact", {});
      if (!refreshed.ok) throw refreshed.error;
      expect(refreshed.value.sourceEvidence?.[0]).toBe(
        session.evidenceForAnalysis(source.evidence_id),
      );
      expect(refreshed.value.sourceEvidence?.[0]).toEqual(relocated);
      expect(refreshed.value.sourceEvidence?.[0]?.evidence_links).toEqual([
        ancestor.evidence_id,
      ]);
      expect(Object.isFrozen(refreshed.value.sourceEvidence?.[0])).toBe(true);
      const refreshedResponse = await client.callTool({
        name: "inspect_managed_artifact",
        arguments: {},
      });
      expect(
        refreshedResponse.isError,
        JSON.stringify(refreshedResponse.content),
      ).not.toBe(true);
      expect(
        parseEvidence(refreshedResponse.structuredContent).evidence_links,
      ).toEqual([source.evidence_id]);
      expect(session.evidenceById(source.evidence_id)).toEqual(relocated);
      expect((await readFile(snapshotPath)).equals(historicalBytes)).toBe(true);
    },
  );
