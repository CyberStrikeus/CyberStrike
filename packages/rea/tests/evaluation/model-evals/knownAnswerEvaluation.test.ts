import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createEvidence, type Evidence } from "../../../src/domain/evidence.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { evaluateCodexEvents } from "./CodexAgentEval.js";
import {
  agentFixtureAnswerInstructions,
  agentFixtureClaims,
} from "./AgentEvaluationFixtures.js";
import { inspectManagedArtifactBytes } from "../../../src/dotnet/ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "../../../src/dotnet/ManagedMemberInspector.js";
import {
  buildManagedPeFixture,
  managedPeFixtureTarget,
} from "../../../src/dotnet/ManagedPe.fixture.js";
import type { FixtureClaimExpectation } from "./KnownAnswerEvaluation.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";

const delivery = createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE);

const provider = { id: "fixture", name: "Fixture analysis", version: "1" };
const subject = {
  path: "/targets/app.asar",
  sha256: "a".repeat(64),
  format: "asar",
};
const createObservation = (
  result: JsonValue = {
    fact: { present: true, channel: "profile:read" },
    unrelated: 1,
  },
  path = subject.path,
): Evidence =>
  createEvidence({ ...subject, path, format: "asar" }, provider, {
    operation: "analyze_javascript_application",
    parameters: { format: "asar" },
    result,
    confidence: "derived",
    authority: "shipped-artifact",
  });
const resultFor = (evidence: Evidence) =>
  delivery.toEvidenceToolResult(
    evidence,
    toolContract(
      evidence.operation === "inspect_managed_artifact"
        ? "inspect_managed_artifact"
        : evidence.operation === "inspect_managed_members"
          ? "inspect_managed_members"
          : "analyze_javascript_application",
    ),
    undefined,
  );
const delivered = (
  evidence: Evidence,
  overrides: Record<string, unknown> = {},
) => ({
  type: "item.completed",
  item: {
    id: evidence.evidence_id,
    type: "mcp_tool_call",
    server: "rea",
    tool: evidence.operation,
    status: "completed",
    result: resultFor(evidence),
    ...overrides,
  },
});
const final = (text: string) => ({
  type: "item.completed",
  item: { type: "agent_message", text },
});
const claimFor = (
  evidence: Evidence,
  overrides: Record<string, unknown> = {},
) => ({
  id: "bridge",
  value: { present: true, channel: "profile:read" },
  evidence_id: evidence.evidence_id,
  confidence: "derived",
  authority: "shipped-artifact",
  ...overrides,
});
const expected = (): FixtureClaimExpectation => ({
  id: "bridge",
  expectedValue: { present: true, channel: "profile:read" },
  source: {
    operation: "analyze_javascript_application",
    confidence: "derived",
    authority: "shipped-artifact",
    subject: { path: subject.path, sha256: subject.sha256 },
    parameters: { format: "asar" },
    select: (value) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? value.fact
        : undefined,
  },
});
const assess = (
  events: readonly unknown[],
  text: string,
  fixtureClaims: readonly FixtureClaimExpectation[] = [expected()],
) =>
  evaluateCodexEvents(
    [...events, final(text)],
    "analyze_javascript_application",
    {
      fixtureClaims,
    },
  );
const answer = (claims: readonly unknown[]) => JSON.stringify({ claims });

// Synthetic transcript cases exercise grading, not an SDK-built assembly oracle.
const managedTranscript = () => {
  const bytes = buildManagedPeFixture({
    typeNamespace: "AgentEval",
    typeName: "Program",
    methodName: "Main",
  });
  const target = managedPeFixtureTarget(bytes, "/targets/AgentEval.dll");
  const artifact = inspectManagedArtifactBytes(bytes, target);
  const members = inspectManagedMembersBytes(bytes, target);
  const program = members.types[0];
  if (program === undefined) throw new Error("Fixture type missing");
  const result = {
    ...members,
    types: [
      program,
      {
        ...program,
        token: "0x02000002",
        name: "Profile",
        full_name: "AgentEval.Profile",
      },
    ],
  };
  const rubric = agentFixtureClaims("managed", {
    javascript: "",
    javascriptSha256: "",
    javascriptShapeLeft: "",
    javascriptShapeRight: "",
    notesElectron: "",
    notesElectronSha256: "",
    managed: target.path,
    managedSha256: target.sha256,
  });
  if (rubric === undefined) throw new Error("Managed rubric missing");
  const evidenceFor = (
    operation: string,
    value: JsonValue,
    overrides: Record<string, unknown> = {},
  ) =>
    createEvidence(target, provider, {
      operation,
      parameters: {},
      result: value,
      confidence: "observed",
      authority: "shipped-artifact",
      ...overrides,
    });
  const artifactEvidence = evidenceFor("inspect_managed_artifact", artifact);
  const memberEvidence = evidenceFor("inspect_managed_members", result);
  const textFor = (evidence: Evidence) =>
    answer([
      {
        id: "public_types",
        value: ["AgentEval.Profile", "AgentEval.Program"],
        evidence_id: evidence.evidence_id,
        confidence: "observed",
        authority: "shipped-artifact",
      },
      {
        id: "entry_point",
        value: { declaring_type: "AgentEval.Program", name: "Main" },
        evidence_id: evidence.evidence_id,
        confidence: "observed",
        authority: "shipped-artifact",
      },
    ]);
  const grade = (
    events = [delivered(artifactEvidence), delivered(memberEvidence)],
    text = textFor(memberEvidence),
  ) =>
    evaluateCodexEvents([...events, final(text)], "inspect_managed_artifact", {
      fixtureClaims: rubric,
    });
  return {
    artifact,
    result,
    artifactEvidence,
    memberEvidence,
    evidenceFor,
    textFor,
    grade,
  };
};

describe("managed known-answer fixture grading", () => {
  it("grades public types independent of row order and resolves the header token", () => {
    expect(managedTranscript().grade().factualCorrectness).toBe("passed");
  });

  it("does not pin compiler-local entry tokens or MVIDs", () => {
    const fixture = managedTranscript();
    const artifact = structuredClone(fixture.artifact);
    const members = structuredClone(fixture.result);
    if (
      artifact.pe.cli === null ||
      artifact.module === null ||
      members.module === null ||
      members.methods[0] === undefined
    )
      throw new Error("Fixture identity missing");
    artifact.pe.cli.entry_point.value = "0x06000009";
    members.methods[0].token = "0x06000009";
    const mvid = "11111111-2222-3333-4444-555555555555";
    artifact.module.mvid = mvid;
    members.module.mvid = mvid;
    members.identity_scope.requires_mvid = mvid;
    members.types.reverse();
    const artifactEvidence = fixture.evidenceFor(
      "inspect_managed_artifact",
      artifact,
    );
    const memberEvidence = fixture.evidenceFor(
      "inspect_managed_members",
      members,
    );
    expect(
      fixture.grade(
        [delivered(artifactEvidence), delivered(memberEvidence)],
        fixture.textFor(memberEvidence),
      ).factualCorrectness,
    ).toBe("passed");
  });

  it.each([
    "wrong-token",
    "native-rva",
    "mvid",
    "null-mvid",
    "digest",
    "partial",
  ])("rejects an unsupported artifact entry point: %s", (kind) => {
    const fixture = managedTranscript();
    const artifact = structuredClone(fixture.artifact);
    if (artifact.pe.cli === null || artifact.module === null)
      throw new Error("Fixture identity missing");
    if (kind === "wrong-token")
      artifact.pe.cli.entry_point.value = "0x06000002";
    if (kind === "native-rva") artifact.pe.cli.entry_point.kind = "native-rva";
    if (kind === "mvid")
      artifact.module.mvid = "11111111-2222-3333-4444-555555555555";
    if (kind === "null-mvid") artifact.module.mvid = null;
    if (kind === "digest") artifact.artifact.sha256 = "b".repeat(64);
    if (kind === "partial") artifact.coverage.state = "partial";
    const evidence = fixture.evidenceFor("inspect_managed_artifact", artifact);
    expect(
      fixture.grade([delivered(evidence), delivered(fixture.memberEvidence)])
        .factualCorrectness,
    ).toBe("failed");
  });
});

describe("managed inventory scope", () => {
  it.each(["selection", "parameters", "both"])(
    "rejects selected public-type inventories while retaining entry-point grounding: %s",
    (kind) => {
      const fixture = managedTranscript();
      const typeNames = ["AgentEval.Profile", "AgentEval.Program"];
      const members = {
        ...fixture.result,
        selection:
          kind === "parameters"
            ? null
            : { type_names: typeNames, unmatched_type_names: [] },
      };
      const evidence = fixture.evidenceFor("inspect_managed_members", members, {
        parameters: kind === "selection" ? {} : { type_names: typeNames },
      });
      expect(
        fixture.grade(
          [delivered(fixture.artifactEvidence), delivered(evidence)],
          fixture.textFor(evidence),
        ),
      ).toMatchObject({
        factualCorrectness: "failed",
        factualAssessment: {
          claims: [
            { id: "public_types", status: "failed" },
            { id: "entry_point", status: "passed" },
          ],
        },
      });
    },
  );
});

describe("managed member grounding", () => {
  it.each([
    "extra-public-type",
    "missing-public-type",
    "duplicate-method",
    "decoy-main",
    "scope-digest",
    "scope-mvid",
    "null-scope",
    "partial",
    "unavailable",
  ])("rejects unsupported member facts: %s", (kind) => {
    const fixture = managedTranscript();
    const members = structuredClone(fixture.result);
    const method = members.methods[0];
    const type = members.types[0];
    if (method === undefined || type === undefined)
      throw new Error("Fixture members missing");
    if (kind === "extra-public-type")
      members.types.push({
        ...type,
        name: "Extra",
        full_name: "AgentEval.Extra",
      });
    if (kind === "missing-public-type") members.types.pop();
    if (kind === "duplicate-method") members.methods.push(method);
    if (kind === "decoy-main") {
      method.name = "Other";
      members.methods.push({ ...method, token: "0x06000002", name: "Main" });
    }
    if (kind === "scope-digest")
      members.identity_scope.requires_artifact_sha256 = "b".repeat(64);
    if (kind === "scope-mvid")
      members.identity_scope.requires_mvid =
        "11111111-2222-3333-4444-555555555555";
    if (kind === "null-scope") members.identity_scope.requires_mvid = null;
    if (kind === "partial") members.metadata.status = "partial";
    if (kind === "unavailable") members.coverage.state = "unavailable";
    const evidence = fixture.evidenceFor("inspect_managed_members", members);
    expect(
      fixture.grade(
        [delivered(fixture.artifactEvidence), delivered(evidence)],
        fixture.textFor(evidence),
      ).factualCorrectness,
    ).toBe("failed");
  });

  it("rejects distinct authenticated matching artifact deliveries", () => {
    const fixture = managedTranscript();
    const secondArtifact = fixture.evidenceFor(
      "inspect_managed_artifact",
      fixture.artifact,
      { parameters: { path: "/targets/AgentEval.dll" } },
    );
    expect(secondArtifact.evidence_id).not.toBe(
      fixture.artifactEvidence.evidence_id,
    );
    const member = delivered(fixture.memberEvidence);
    expect(
      fixture.grade([delivered(secondArtifact), member]).factualCorrectness,
    ).toBe("passed");
    expect(
      fixture.grade([
        delivered(fixture.artifactEvidence),
        delivered(secondArtifact),
        member,
      ]).factualCorrectness,
    ).toBe("failed");
  });

  it("accepts identical repeated artifact deliveries", () => {
    const fixture = managedTranscript();
    expect(
      fixture.grade([
        delivered(fixture.artifactEvidence),
        delivered(fixture.artifactEvidence),
        delivered(fixture.memberEvidence),
      ]).factualCorrectness,
    ).toBe("passed");
  });

  it("requires companion delivery and rejects conflicting or failed artifact deliveries", () => {
    const fixture = managedTranscript();
    const member = delivered(fixture.memberEvidence);
    expect(fixture.grade([member]).factualCorrectness).toBe("failed");
    expect(
      fixture.grade([
        delivered(fixture.artifactEvidence, { status: "failed" }),
        member,
      ]).factualCorrectness,
    ).toBe("failed");
    const conflicting = {
      ...fixture.artifactEvidence,
      subject:
        fixture.memberEvidence.subject === null
          ? null
          : { ...fixture.memberEvidence.subject, local_path: "/other.dll" },
    };
    expect(
      fixture.grade([
        delivered(fixture.artifactEvidence),
        delivered(conflicting),
        member,
      ]).factualCorrectness,
    ).toBe("failed");
  });

  it("binds the digest, rejects fabricated values and cites the supporting operation", () => {
    const fixture = managedTranscript();
    expect(
      fixture.grade(undefined, fixture.textFor(fixture.artifactEvidence))
        .factualCorrectness,
    ).toBe("failed");
    expect(
      fixture.grade(
        undefined,
        fixture.textFor(fixture.memberEvidence).replace('"Main"', '"Invented"'),
      ).factualCorrectness,
    ).toBe("failed");
    const other = createEvidence(
      { path: "/targets/AgentEval.dll", sha256: "b".repeat(64), format: "pe" },
      provider,
      {
        operation: "inspect_managed_members",
        parameters: {},
        result: fixture.result,
        confidence: "observed",
        authority: "shipped-artifact",
      },
    );
    expect(
      fixture.grade(
        [delivered(fixture.artifactEvidence), delivered(other)],
        fixture.textFor(other),
      ).factualCorrectness,
    ).toBe("failed");
  });

  it("keeps golden names out of instructions and preserves routing-only scenarios", () => {
    const instructions = agentFixtureAnswerInstructions("managed");
    expect(instructions).toContain("do not read target files directly");
    expect(instructions).not.toMatch(/AgentEval|Profile|Program|Main/u);
    expect(agentFixtureAnswerInstructions("native")).toBe("");
  });
});

// Removing exact fixture comparison or accepted-source validation must break these regressions.
describe("known-answer fixture grading", () => {
  it("passes closed claims against authenticated production MCP Evidence", () => {
    const evidence = createObservation();
    expect(
      assess([delivered(evidence)], answer([claimFor(evidence)])),
    ).toMatchObject({
      factualCorrectness: "passed",
      factualAssessment: {
        scope: "configured_fixture_claims",
        status: "passed",
      },
    });
  });

  it("rejects fabricated prose despite expected terms and a produced Evidence ID", () => {
    const evidence = createObservation();
    const text = `Observed evidence ${evidence.evidence_id}: profileApi and profile:read do not exist; there is no preload or contextBridge. All communications use quantum teleportation.`;
    expect(assess([delivered(evidence)], text).factualCorrectness).toBe(
      "failed",
    );
  });

  it.each([
    { present: false, channel: "profile:read" },
    { present: true, channel: "invented:channel" },
    { present: true, channel: "profile:read", fabricated: "teleportation" },
    "profile:read does not exist",
  ])("rejects a wrong or contradictory value %j", (value) => {
    const evidence = createObservation();
    expect(
      assess([delivered(evidence)], answer([claimFor(evidence, { value })]))
        .factualCorrectness,
    ).toBe("failed");
  });

  it("retains not_assessed without a fixture rubric", () => {
    expect(
      evaluateCodexEvents(
        [final("Observed metadata remains unknown.")],
        "analyze_javascript_application",
      ).factualCorrectness,
    ).toBe("not_assessed");
  });

  it.each([{ rubric: [] }, { rubric: [expected(), expected()] }])(
    "fails closed for an empty or duplicate rubric",
    ({ rubric }) => {
      const evidence = createObservation();
      expect(
        assess([delivered(evidence)], answer([claimFor(evidence)]), rubric)
          .factualCorrectness,
      ).toBe("failed");
    },
  );

  it("rejects selector failures without crashing the evaluation", () => {
    const evidence = createObservation();
    const expectation = expected();
    const rubric = [
      {
        ...expectation,
        source: {
          ...expectation.source,
          select: () => {
            throw new TypeError("Malformed result");
          },
        },
      },
    ];
    expect(
      assess([delivered(evidence)], answer([claimFor(evidence)]), rubric)
        .factualCorrectness,
    ).toBe("failed");
  });
});

describe("closed final claim manifests", () => {
  it.each([
    "missing",
    "duplicate",
    "unknown",
    "extra-field",
    "extra-top-level",
    "surrounding-prose",
    "missing-authority",
  ])("rejects %s claims", (kind) => {
    const evidence = createObservation();
    const claim = claimFor(evidence);
    let text = answer([claim]);
    if (kind === "missing") text = answer([]);
    if (kind === "duplicate") text = answer([claim, claim]);
    if (kind === "unknown")
      text = answer([claim, { ...claim, id: "fabrication" }]);
    if (kind === "extra-field")
      text = answer([{ ...claim, explanation: "Also teleportation" }]);
    if (kind === "extra-top-level")
      text = JSON.stringify({
        claims: [claim],
        explanation: "Also teleportation",
      });
    if (kind === "surrounding-prose") text = `${text}\nAlso teleportation.`;
    if (kind === "missing-authority")
      text = answer([
        {
          id: claim.id,
          value: claim.value,
          evidence_id: claim.evidence_id,
          confidence: claim.confidence,
        },
      ]);
    expect(assess([delivered(evidence)], text).factualCorrectness).toBe(
      "failed",
    );
  });

  it("rejects duplicate object members containing contradictory values", () => {
    const evidence = createObservation();
    const text = answer([claimFor(evidence)]).replace(
      '"present":true',
      '"present":false,"present":true',
    );
    expect(assess([delivered(evidence)], text).factualCorrectness).toBe(
      "failed",
    );
  });

  it("fails closed for a deeply nested generated answer", () => {
    const text = `${"[".repeat(20_000)}null${"]".repeat(20_000)}`;
    expect(assess([], text).factualCorrectness).toBe("failed");
  });

  it.each(["confidence", "authority"])("rejects an overstated %s", (field) => {
    const evidence = createObservation();
    const claim = claimFor(evidence, {
      [field]: field === "confidence" ? "observed" : "controlled-replay",
    });
    expect(
      assess([delivered(evidence)], answer([claim])).factualCorrectness,
    ).toBe("failed");
  });
});

describe("successful Evidence grounding", () => {
  it.each([
    { server: "other" },
    { server: null },
    { status: "failed" },
    { status: "in_progress" },
    { error: { code: "unavailable" } },
    { tool: "other_tool" },
  ])("rejects a foreign or unsuccessful completion %j", (overrides) => {
    const evidence = createObservation();
    expect(
      assess([delivered(evidence, overrides)], answer([claimFor(evidence)]))
        .factualCorrectness,
    ).toBe("failed");
  });

  it("rejects IDs present only in arguments or unrelated metadata", () => {
    const evidence = createObservation();
    const event = delivered(evidence, {
      arguments: { evidence },
      result: {
        structuredContent: { metadata: { evidence_id: evidence.evidence_id } },
      },
    });
    expect(
      assess([event], answer([claimFor(evidence)])).factualCorrectness,
    ).toBe("failed");
  });

  it("rejects a tampered envelope even with a valid-looking Evidence ID", () => {
    const evidence = createObservation();
    const event = delivered(evidence, {
      result: {
        structuredContent: {
          ...evidence,
          authority: "controlled-replay",
        },
      },
    });
    expect(
      assess([event], answer([claimFor(evidence)])).factualCorrectness,
    ).toBe("failed");
  });

  it.each(["id", "result", "error"])(
    "rejects inconsistent or failed MCP wrapper %s",
    (field) => {
      const evidence = createObservation();
      const projection = {
        evidence_id: evidence.evidence_id,
        result: evidence.normalized_result,
        evidence,
      };
      const event = delivered(evidence, {
        result: {
          structuredContent: {
            ...projection,
            ...(field === "id"
              ? { evidence_id: `ev_${"b".repeat(64)}` }
              : field === "result"
                ? { result: { fabricated: true } }
                : {}),
          },
          ...(field === "error" ? { isError: true } : {}),
        },
      });
      expect(
        assess([event], answer([claimFor(evidence)])).factualCorrectness,
      ).toBe("failed");
    },
  );

  it.each(["error", "contradictory-data"])(
    "rejects conflicting outer result/output aliases containing %s",
    (kind) => {
      const evidence = createObservation();
      const output =
        kind === "error"
          ? { isError: true, structuredContent: { error: { code: "denied" } } }
          : {
              ...resultFor(evidence),
              structuredContent: {
                ...evidence,
                normalized_result: {
                  fact: { present: false, channel: "profile:read" },
                },
              },
            };
      const event = delivered(evidence, { output });
      expect(
        assess([event], answer([claimFor(evidence)])).factualCorrectness,
      ).toBe("failed");
    },
  );

  it("accepts JSON-equal separately allocated outer result/output aliases", () => {
    const evidence = createObservation();
    const event = delivered(evidence, { output: resultFor(evidence) });
    expect(
      assess([event], answer([claimFor(evidence)])).factualCorrectness,
    ).toBe("passed");
  });

  it("accepts the documented snake-case structured-content transcript representation", () => {
    const evidence = createObservation();
    const event = delivered(evidence, {
      result: { structured_content: resultFor(evidence).structuredContent },
    });
    expect(
      assess([event], answer([claimFor(evidence)])).factualCorrectness,
    ).toBe("passed");
  });

  it("grades a complete text-only production Evidence response", () => {
    const evidence = createObservation();
    const event = delivered(evidence, {
      result: {
        content: resultFor(evidence).content,
        structured_content: null,
      },
    });
    expect(
      assess([event], answer([claimFor(evidence)])).factualCorrectness,
    ).toBe("passed");
  });

  it("rejects authentic unrelated Evidence containing the same value elsewhere", () => {
    const evidence = createObservation({ unrelated: expected().expectedValue });
    expect(
      assess([delivered(evidence)], answer([claimFor(evidence)]))
        .factualCorrectness,
    ).toBe("failed");
  });
});

describe("fixture identity and provenance binding", () => {
  it("rejects Evidence for a different subject despite an equal supported value", () => {
    const evidence = createObservation(undefined, "/targets/other.asar");
    expect(
      assess([delivered(evidence)], answer([claimFor(evidence)]))
        .factualCorrectness,
    ).toBe("failed");
  });

  it("rejects a wrong required source parameter", () => {
    const evidence = createObservation();
    const expectation = expected();
    const rubric = [
      {
        ...expectation,
        source: { ...expectation.source, parameters: { format: "directory" } },
      },
    ];
    expect(
      assess([delivered(evidence)], answer([claimFor(evidence)]), rubric)
        .factualCorrectness,
    ).toBe("failed");
  });

  it("rejects conflicting subject diagnostics for the same semantic Evidence ID", () => {
    const evidence = createObservation();
    const conflicting = {
      ...evidence,
      subject:
        evidence.subject === null
          ? null
          : { ...evidence.subject, local_path: "/targets/other.asar" },
    };
    expect(
      assess(
        [delivered(evidence), delivered(conflicting)],
        answer([claimFor(evidence)]),
      ).factualCorrectness,
    ).toBe("failed");
  });

  it("requires linked source Evidence to be delivered and match the configured artifact", () => {
    const source = createObservation(undefined, "/targets/parser-v1");
    const evidence = createEvidence({ ...subject, format: "asar" }, provider, {
      operation: "analyze_javascript_application",
      parameters: { format: "asar" },
      result: { fact: expected().expectedValue },
      confidence: "derived",
      authority: "shipped-artifact",
      evidenceLinks: [source.evidence_id],
    });
    const expectation = expected();
    const rubric = [
      {
        ...expectation,
        source: {
          ...expectation.source,
          linkedSubjects: [
            {
              operation: source.operation,
              path: "/targets/parser-v1",
              sha256: subject.sha256,
            },
          ],
        },
      },
    ];
    const text = answer([claimFor(evidence)]);
    expect(assess([delivered(evidence)], text, rubric).factualCorrectness).toBe(
      "failed",
    );
    expect(
      assess([delivered(source), delivered(evidence)], text, rubric)
        .factualCorrectness,
    ).toBe("passed");
    expect(
      assess([delivered(source), delivered(evidence)], text, [
        {
          ...expectation,
          source: {
            ...expectation.source,
            linkedSubjects: [
              { operation: source.operation, path: "/targets/other-parser" },
            ],
          },
        },
      ]).factualCorrectness,
    ).toBe("failed");
  });
});
