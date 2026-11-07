import { expect, it, onTestFinished, vi } from "vitest";

import * as evidenceDomain from "../../src/domain/evidence.js";
import * as evidenceBundleDomain from "../../src/domain/evidenceBundle.js";
import * as residualUnknownDomain from "../../src/domain/residualUnknown.js";
import {
  recordUnknownInputSchema,
  updateUnknownInputSchema,
} from "../../src/domain/residualUnknown.js";
import { processEvidence } from "../../src/application/ReconstructionObligationLedger.fixture.js";
import { createApplicationMcpHarness } from "../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../fixtures/binarySession.js";
import { InvestigationRecords } from "../../src/application/investigation/InvestigationRecords.js";

type ApplicationClient = Awaited<
  ReturnType<typeof createApplicationMcpHarness>
>["client"];

const unknownInput = (question: string) =>
  recordUnknownInputSchema.parse({
    question,
    domain: "ledger-failure",
    severity: "medium",
    required_authority: "analyst-inference",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
  });

const updateInput = (unknownId: string, expectedRevision: number) =>
  updateUnknownInputSchema.parse({
    unknown_id: unknownId,
    expected_revision: expectedRevision,
    status: "investigating",
    severity: "medium",
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
    required_authority: "analyst-inference",
    required_confidence: "observed",
    required_environment: null,
    recommended_probes: [],
    relationships: [],
    resolution: null,
  });

const failureFor = (kind: "TypeError" | "Error", message: string): Error =>
  kind === "TypeError" ? new TypeError(message) : new Error(message);

const expectSdkFailure = async (
  client: ApplicationClient,
  name: "record_unknown" | "update_unknown",
  args: Record<string, unknown>,
  failure: Error,
): Promise<void> => {
  const response = await client.callTool({
    name,
    arguments: args,
  });
  expect(response).toMatchObject({
    isError: true,
    content: [{ type: "text", text: failure.message }],
  });
  expect(response.structuredContent).toBeUndefined();
};

const withHarness = async <T>(
  run: (
    harness: Awaited<ReturnType<typeof createApplicationMcpHarness>>,
  ) => Promise<T>,
): Promise<T> => {
  const session = createTestBinarySession(() => {
    throw new Error("Ledger mutations must not launch a provider");
  });
  const harness = await createApplicationMcpHarness({ session });
  try {
    return await run(harness);
  } finally {
    vi.restoreAllMocks();
    await harness.close();
  }
};

it.each(
  (["recordEvidence", "recordEvidenceWithUnknown"] as const).flatMap(
    (operation) =>
      (["TypeError", "Error"] as const).map(
        (kind) => [operation, kind] as const,
      ),
  ),
)(
  "lets unexpected authentication failure escape %s (%s) without changing the bundle",
  async (operation, kind) =>
    withHarness(async ({ session }) => {
      const derived = processEvidence();
      const input = unknownInput(`Failure during ${operation}`);
      const before = session.exportEvidenceBundle();
      const failure = failureFor(kind, `${operation} authentication failed`);
      const authenticate = vi
        .spyOn(evidenceDomain, "immutableEvidence")
        .mockImplementation(() => {
          throw failure;
        });
      onTestFinished(() => authenticate.mockRestore());

      if (operation === "recordEvidence")
        expect(() => session.recordEvidence(derived)).toThrow(failure);
      else
        expect(() => session.recordEvidenceWithUnknown(derived, input)).toThrow(
          failure,
        );
      expect(session.exportEvidenceBundle()).toEqual(before);
    }),
);

it("preserves an unexpected unknown-construction fault through record_unknown", async () =>
  withHarness(async ({ client, session }) => {
    const before = session.exportEvidenceBundle();
    const failure = new TypeError("unknown constructor implementation failed");
    const construct = vi
      .spyOn(residualUnknownDomain, "createResidualUnknown")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => construct.mockRestore());

    await expectSdkFailure(
      client,
      "record_unknown",
      unknownInput("Unexpected constructor failure"),
      failure,
    );
    expect(session.exportEvidenceBundle()).toEqual(before);
  }));

it("preserves an unexpected unknown-revision fault through update_unknown", async () =>
  withHarness(async ({ client, session }) => {
    const created = session.recordUnknown(unknownInput("Update failure setup"));
    if (!created.ok) throw created.error;
    const before = session.exportEvidenceBundle();
    const failure = new Error("unknown update implementation failed");
    const update = vi
      .spyOn(residualUnknownDomain, "updateResidualUnknown")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => update.mockRestore());

    await expectSdkFailure(
      client,
      "update_unknown",
      updateInput(created.value.unknown_id, created.value.revision),
      failure,
    );
    expect(session.exportEvidenceBundle()).toEqual(before);
  }));

it.each(
  (["record_unknown", "update_unknown"] as const).flatMap((operation) =>
    (["TypeError", "Error"] as const).map((kind) => [operation, kind] as const),
  ),
)(
  "preserves unexpected mutation Evidence authentication failure through %s (%s)",
  async (operation, kind) =>
    withHarness(async ({ client, session }) => {
      let args: Record<string, unknown>;
      if (operation === "record_unknown") {
        args = unknownInput("Mutation Evidence authentication failure");
      } else {
        const created = session.recordUnknown(
          unknownInput("Mutation Evidence authentication setup"),
        );
        if (!created.ok) throw created.error;
        args = updateInput(created.value.unknown_id, created.value.revision);
      }
      const before = session.exportEvidenceBundle();
      const failure = failureFor(
        kind,
        "mutation Evidence authentication failed",
      );
      const authenticate = vi
        .spyOn(evidenceDomain, "immutableEvidence")
        .mockImplementation(() => {
          throw failure;
        });
      onTestFinished(() => authenticate.mockRestore());

      await expectSdkFailure(client, operation, args, failure);
      expect(session.exportEvidenceBundle()).toEqual(before);
    }),
);

it.each([
  ["record_unknown", "record graph failure"],
  ["update_unknown", "update graph failure"],
] as const)(
  "does not convert an unexpected graph-validation fault during %s into a caller error",
  async (operation, message) =>
    withHarness(async ({ client, session }) => {
      let args: Record<string, unknown>;
      if (operation === "record_unknown") {
        args = unknownInput(`Unexpected graph validation: ${message}`);
      } else {
        const created = session.recordUnknown(
          unknownInput(`Graph validation setup: ${message}`),
        );
        if (!created.ok) throw created.error;
        args = updateInput(created.value.unknown_id, created.value.revision);
      }
      const before = session.exportEvidenceBundle();
      const failure = new Error(message);
      const validate = vi
        .spyOn(evidenceBundleDomain, "validateResidualUnknownAddition")
        .mockImplementation(() => {
          throw failure;
        });
      onTestFinished(() => validate.mockRestore());

      await expectSdkFailure(client, operation, args, failure);
      expect(session.exportEvidenceBundle()).toEqual(before);
    }),
);

it("preserves unexpected full-candidate bundle validation faults and leaves import state unchanged", async () =>
  withHarness(async ({ session }) => {
    const source = new InvestigationRecords();
    const created = source.recordUnknown(unknownInput("Imported history"));
    if (!created.ok) throw created.error;
    const bundle = source.exportEvidenceBundle();
    const before = session.exportEvidenceBundle();
    const failure = new TypeError("candidate bundle validation failed");
    const validate = vi
      .spyOn(evidenceBundleDomain, "createImmutableEvidenceBundle")
      .mockImplementation(() => {
        throw failure;
      });
    onTestFinished(() => validate.mockRestore());

    expect(() => session.importEvidenceBundle(bundle)).toThrow(failure);
    expect(session.exportEvidenceBundle()).toEqual(before);
  }));

it("authenticates derived and mutation Evidence before committing recordWithUnknown", async () =>
  withHarness(async ({ session }) => {
    const input = unknownInput("Atomic record with unknown");
    const evidence = processEvidence();
    const expectedId = evidence.evidence_id;
    const original = evidenceDomain.immutableEvidence;
    let evidenceVisibleDuringAuthentication = false;
    const authenticate = vi
      .spyOn(evidenceDomain, "immutableEvidence")
      .mockImplementation((candidate) => {
        if (
          session
            .exportEvidenceBundle()
            .records.some((record) => record.evidence_id === expectedId)
        )
          evidenceVisibleDuringAuthentication = true;
        return original(candidate);
      });
    onTestFinished(() => authenticate.mockRestore());

    const recorded = session.recordEvidenceWithUnknown(evidence, input);
    authenticate.mockRestore();
    expect(recorded.ok).toBe(true);
    expect(evidenceVisibleDuringAuthentication).toBe(false);
    const committed = session.exportEvidenceBundle();
    expect(committed.records.map(({ evidence_id }) => evidence_id)).toContain(
      expectedId,
    );
    expect(committed.unknowns).toHaveLength(1);
    expect(committed.records).toHaveLength(2);
    expect(
      session.immutableEvidenceBundle().records.every(Object.isFrozen),
    ).toBe(true);
  }));

it("authenticates all Evidence before committing an imported unknown history", async () =>
  withHarness(async ({ session }) => {
    const source = new InvestigationRecords();
    expect(source.recordEvidence(processEvidence()).ok).toBe(true);
    const created = source.recordUnknown(
      unknownInput("Atomic imported history"),
    );
    if (!created.ok) throw created.error;
    const bundle = source.exportEvidenceBundle();
    const expectedIds = bundle.records.map(({ evidence_id }) => evidence_id);
    const original = evidenceBundleDomain.safeParseImmutableEvidenceBundle;
    let incomingVisibleDuringAuthentication = false;
    const authenticate = vi
      .spyOn(evidenceBundleDomain, "safeParseImmutableEvidenceBundle")
      .mockImplementation((input) => {
        const visible = session
          .exportEvidenceBundle()
          .records.some(({ evidence_id }) => expectedIds.includes(evidence_id));
        if (visible) incomingVisibleDuringAuthentication = true;
        const admitted = original(input);
        if (
          session
            .exportEvidenceBundle()
            .records.some(({ evidence_id }) =>
              expectedIds.includes(evidence_id),
            )
        )
          incomingVisibleDuringAuthentication = true;
        return admitted;
      });
    onTestFinished(() => authenticate.mockRestore());

    const imported = session.importEvidenceBundle(bundle);
    expect(authenticate).toHaveBeenCalledTimes(1);
    authenticate.mockRestore();
    expect(imported.ok).toBe(true);
    expect(incomingVisibleDuringAuthentication).toBe(false);
    expect(session.exportEvidenceBundle()).toEqual(bundle);
    expect(
      session.immutableEvidenceBundle().records.every(Object.isFrozen),
    ).toBe(true);
  }));
