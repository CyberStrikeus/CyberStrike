import type { NativeSymbolMetadata } from "../../../src/domain/native/nativeSymbol.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { expect, it, onTestFinished } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";
import { SESSION_TOOL_CONTRACTS } from "../../../src/contracts/sessionToolContracts.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";

import { createFunctionCoordinateContext } from "../../../src/domain/native/functionCoordinateContext.js";
import { FUNCTION_COMPARISON_EXAMPLE } from "../../../src/contracts/functionComparisonExample.js";
import {
  createAnalysisProfile,
  type AnalysisProfileCommitment,
} from "../../../src/domain/analysisProfile.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { functionComparisonResultSchema } from "../../../src/domain/functionComparisonSchemas.js";
import { functionDossierSchema } from "../../../src/domain/native/functionDossier.js";

import { reconstructionVerificationResultSchema } from "../../../src/domain/reconstructionVerificationSchemas.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";

const example = FUNCTION_COMPARISON_EXAMPLE.left;
const dossier = functionDossierSchema.parse(example.normalized_result);
const provider = { ...example.provider, version: "1" };
const mapping = {
  loader: "auto-from-header",
  language_id: "auto-from-header",
  compiler_spec_id: "auto-default",
  load_segment: null,
  address_coordinates: null,
  entry_point: null,
};
const profile = createAnalysisProfile(provider, {
  architecture: "arm64",
  ...mapping,
  function_coordinate_context: createFunctionCoordinateContext(mapping),
});
type Reference = (typeof dossier.outgoing_references)[number];
type Classification = "call" | "data" | "unknown";

const createHarness = async () => {
  const harness = await createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Function comparison must not launch a provider");
    }),
  });
  onTestFinished(harness.close);
  return harness;
};

const procedure = (
  address: string,
  name: string,
  symbol: NativeSymbolMetadata | null = {
    primary: true,
    dynamic: false,
    external: false,
    type: "function",
    source: "imported",
  },
) => ({
  address,
  name,
  symbol,
  classification: null,
  body: dossier.procedure.body,
});

const reference = (
  sourceAddress: string,
  targetAddress: string,
  classification: Classification = "call",
  options: {
    readonly sourceName?: string;
    readonly targetName?: string | null;
    readonly targetSymbol?: NativeSymbolMetadata | null;
    readonly sourceEntryAddress?: string;
    readonly targetEntryAddress?: string;
  } = {},
): Reference => ({
  source_address: sourceAddress,
  target_address: targetAddress,
  source_procedure:
    options.sourceName === undefined
      ? procedure(options.sourceEntryAddress ?? sourceAddress, "main")
      : procedure(
          options.sourceEntryAddress ?? sourceAddress,
          options.sourceName,
        ),
  target_procedure:
    options.targetName === null
      ? null
      : procedure(
          options.targetEntryAddress ?? targetAddress,
          options.targetName ?? "helper",
          options.targetSymbol,
        ),
  kind:
    classification === "unknown"
      ? { available: false, reason: "Reference kind was not exposed." }
      : {
          available: true,
          provenance: "controlled-reference-fact",
          type: classification === "call" ? "UNCONDITIONAL_CALL" : "READ",
          flow: classification === "call",
          call: classification === "call",
          jump: false,
          data: classification === "data",
          read: classification === "data",
          write: false,
          indirect: false,
          computed: false,
          conditional: false,
          terminal: false,
          primary: true,
          operand_index: 0,
          external: false,
        },
});

const evidence = (
  id: string,
  digest: string,
  outgoing: readonly Reference[] = [],
  options: {
    readonly incoming?: readonly Reference[];
    readonly procedureAddress?: string;
    readonly procedureName?: string;
    readonly procedureSymbol?: NativeSymbolMetadata | null;
    readonly architecture?: "arm64" | "x86_64" | null;
    readonly format?: "mach-o" | "mach-o-universal";
    readonly profile?: AnalysisProfileCommitment | null;
    readonly callees?: readonly (typeof dossier.callees)[number][];
    readonly callers?: readonly (typeof dossier.callers)[number][];
  } = {},
) =>
  createEvidence(
    {
      path: `/fixture/function-reference/${id}`,
      sha256: digest.repeat(64),
      format: options.format ?? "mach-o",
      ...(options.architecture === null
        ? {}
        : { architecture: options.architecture ?? "arm64" }),
    },
    provider,
    {
      operation: "analyze_function",
      ...(options.profile === null
        ? {}
        : { analysisProfile: options.profile ?? profile }),
      parameters: { ...example.parameters, observation: id },
      result: {
        ...dossier,
        procedure: {
          ...dossier.procedure,
          address: options.procedureAddress ?? dossier.procedure.address,
          name: options.procedureName ?? dossier.procedure.name,
          symbol:
            options.procedureSymbol === undefined
              ? dossier.procedure.symbol
              : options.procedureSymbol,
        },
        callees: [...(options.callees ?? [])],
        callers: [...(options.callers ?? [])],
        incoming_references: [...(options.incoming ?? [])],
        outgoing_references: [...outgoing],
      },
      confidence: "derived",
      authority: "shipped-artifact",
      relationshipCoverage: { status: "complete" },
    },
  );

const compare = async (
  client: Client,
  left: ReturnType<typeof evidence>,
  right: ReturnType<typeof evidence>,
) => {
  const response = await client.callTool({
    name: "compare_functions",
    arguments: { left, right },
  });
  expect(
    response.isError,
    JSON.stringify({
      content: response.content,
      structured: response.structuredContent,
    }),
  ).not.toBe(true);
  const resultEvidence = parseEvidence(response.structuredContent);
  expect(resultEvidence.operation).toBe("compare_functions");
  expect(resultEvidence.evidence_links).toEqual(
    expect.arrayContaining([left.evidence_id, right.evidence_id]),
  );
  return {
    evidence: resultEvidence,
    result: functionComparisonResultSchema.parse(
      resultEvidence.normalized_result,
    ),
  };
};

const expectReferences = (
  comparison: Awaited<ReturnType<typeof compare>>,
  status: "unchanged" | "changed" | "unknown",
) =>
  expect
    .soft(
      comparison.result.dimensions.find(
        ({ dimension }) => dimension === "references",
      ),
    )
    .toMatchObject({ status });

const verifyDimension = async (
  client: Client,
  comparisonEvidenceId: string,
  status: "pass" | "fail" | "unknown",
  dimension: "references" | "calls" | "identity" = "references",
  observedStatus: "unchanged" | "changed" | "unknown" = status === "pass"
    ? "unchanged"
    : status === "fail"
      ? "changed"
      : "unknown",
) => {
  const claimId = `${dimension}-${comparisonEvidenceId}`;
  const response = await client.callTool({
    name: "verify_reconstruction",
    arguments: {
      specification: {
        name: `Reference identity check ${comparisonEvidenceId}`,
        claims: [
          {
            kind: "structural-function",
            claim_id: claimId,
            title: `${dimension} facts agree`,
            comparison_evidence_id: comparisonEvidenceId,
            dimension,
          },
        ],
      },
    },
  });
  expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
  const verification = reconstructionVerificationResultSchema.parse(
    parseEvidence(response.structuredContent).normalized_result,
  );
  expect.soft(verification).toMatchObject({
    status,
    summary: {
      total: 1,
      passed: status === "pass" ? 1 : 0,
      failed: status === "fail" ? 1 : 0,
      unknown: status === "unknown" ? 1 : 0,
    },
    claims: {
      items: [
        expect.objectContaining({
          claim_id: claimId,
          status,
          observed_status: observedStatus,
        }),
      ],
    },
  });
};

it("preserves reference identity uncertainty and same-artifact coordinates", async () => {
  const { client } = await createHarness();
  const namedLeft = evidence("named-left", "a", [
    reference("0x1000", "0x1010"),
  ]);
  const namedRight = evidence(
    "named-right",
    "b",
    [reference("0x2000", "0x2020")],
    { procedureAddress: "0x2000" },
  );
  expectReferences(await compare(client, namedLeft, namedRight), "unchanged");

  const named = evidence("known-helper", "c", [reference("0x1000", "0x1010")]);
  const unnamedElsewhere = evidence(
    "unknown-helper",
    "d",
    [reference("0x2000", "0x2020", "call", { targetName: null })],
    { procedureAddress: "0x2000" },
  );
  const namedToNull = await compare(client, named, unnamedElsewhere);
  expectReferences(namedToNull, "unknown");
  await verifyDimension(client, namedToNull.evidence.evidence_id, "unknown");
  const nullToNamed = await compare(client, unnamedElsewhere, named);
  expectReferences(nullToNamed, "unknown");

  const knownSameArtifact = evidence("same-named", "e", [
    reference("0x1000", "0x1010"),
  ]);
  expectReferences(
    await compare(
      client,
      knownSameArtifact,
      evidence("same-unnamed", "e", [
        reference("0x1000", "0x1010", "call", { targetName: null }),
      ]),
    ),
    "unchanged",
  );
  expectReferences(
    await compare(
      client,
      knownSameArtifact,
      evidence("same-different-raw", "e", [
        reference("0x1000", "0x1020", "call", { targetName: null }),
      ]),
    ),
    "changed",
  );

  const reversed = await compare(
    client,
    namedLeft,
    evidence("reverse", "f", [], {
      procedureAddress: "0x2000",
      incoming: [
        reference("0x2020", "0x2000", "call", {
          sourceName: "helper",
          targetName: "main",
        }),
      ],
    }),
  );
  expectReferences(reversed, "changed");
  expectReferences(await compare(client, namedRight, namedLeft), "unchanged");
});

it("keeps unqualified and ambiguous procedure names from proving cross-artifact identity", async () => {
  const { client } = await createHarness();
  for (const [index, name] of ["sub_1010", "fcn.1010", "FUN_1010"].entries()) {
    const left = evidence(`auto-left-${index}`, "1", [
      reference("0x1000", "0x1010", "call", {
        targetName: name,
        targetSymbol: null,
      }),
    ]);
    const right = evidence(
      `auto-right-${index}`,
      "2",
      [
        reference("0x2000", "0x2020", "call", {
          targetName: name,
          targetSymbol: null,
        }),
      ],
      { procedureAddress: "0x2000" },
    );
    expectReferences(await compare(client, left, right), "unknown");
    const otherName = ["fcn.2020", "FUN_2020", "sub_2020"][index] ?? "sub_2020";
    expectReferences(
      await compare(
        client,
        left,
        evidence(
          `auto-different-${index}`,
          "3",
          [
            reference("0x2000", "0x2020", "call", {
              targetName: otherName,
              targetSymbol: null,
            }),
          ],
          { procedureAddress: "0x2000" },
        ),
      ),
      "unknown",
    );
  }

  const sameCoordinates = await compare(
    client,
    evidence("auto-coordinate-left", "4", [
      reference("0x1000", "0x1010", "call", { targetName: "sub_1010" }),
    ]),
    evidence("auto-coordinate-right", "4", [
      reference("0x1000", "0x1010", "call", { targetName: "FUN_1010" }),
    ]),
  );
  expectReferences(sameCoordinates, "unchanged");

  const overloads = await compare(
    client,
    evidence("duplicate-helper-left", "5", [
      reference("0x1000", "0x1010"),
      reference("0x1000", "0x1020"),
    ]),
    evidence(
      "duplicate-helper-right",
      "6",
      [reference("0x2000", "0x2010"), reference("0x2000", "0x2020")],
      { procedureAddress: "0x2000" },
    ),
  );
  expectReferences(overloads, "unknown");

  const generatedFunctions = await compare(
    client,
    evidence("generated-function-left", "7", [], {
      procedureName: "sub_1000",
      procedureSymbol: null,
    }),
    evidence("generated-function-right", "8", [], {
      procedureAddress: "0x2000",
      procedureName: "FUN_2000",
      procedureSymbol: null,
    }),
  );
  expect.soft(generatedFunctions.result.function_match).toMatchObject({
    status: "ambiguous",
  });
  expect.soft(generatedFunctions.result.status).toBe("unknown");
});

it("preserves call endpoint identity through public comparisons and selected reconstruction claims", async () => {
  const { client, session } = await createHarness();
  const observedCalls = (
    id: string,
    digest: string,
    entry: string,
    targets: readonly string[],
    includeReferences = true,
  ) =>
    evidence(
      id,
      digest,
      includeReferences
        ? targets.map((target) =>
            reference(entry, target, "call", { sourceName: "worker" }),
          )
        : [],
      {
        procedureAddress: entry,
        procedureName: "worker",
        callees: targets.map((target) => procedure(target, "helper")),
      },
    );
  const original = observedCalls("original-calls", "1", "0x1000", [
    "ram:0x2000",
  ]);
  const cases = [
    {
      left: original,
      right: original,
      status: "unchanged",
      verification: "unknown",
    },
    {
      left: original,
      right: observedCalls("distinct-helpers", "1", "0x1100", ["ram:0x3000"]),
      status: "changed",
      verification: "fail",
    },
    {
      left: original,
      right: observedCalls("same-helper-coordinate", "1", "0x1000", [
        "ram:0X002000",
      ]),
      status: "unchanged",
      verification: "pass",
    },
    {
      left: original,
      right: observedCalls("cross-build-helper", "2", "0x1100", ["ram:0x3000"]),
      status: "unchanged",
      verification: "pass",
    },
    ...[true, false].map((includeReferences) => ({
      left: observedCalls(
        `duplicate-helpers-left-${includeReferences}`,
        "3",
        "0x1000",
        ["0x2000", "0x3000"],
        includeReferences,
      ),
      right: observedCalls(
        `duplicate-helpers-right-${includeReferences}`,
        "4",
        "0x1100",
        ["0x4000", "0x5000"],
        includeReferences,
      ),
      status: "unknown" as const,
      verification: "unknown" as const,
    })),
  ] as const;
  for (const test of cases) {
    const compared = await compare(client, test.left, test.right);
    expect(
      compared.result.dimensions.find((value) => value.dimension === "calls"),
    ).toMatchObject({
      status: test.status,
      evidence_links: [test.left.evidence_id, test.right.evidence_id],
      ...(test.status === "unknown"
        ? {
            left_count: 2,
            right_count: 2,
            left_digest: null,
            right_digest: null,
            limitations: [
              expect.stringContaining("unique comparable procedure entry"),
            ],
          }
        : {}),
    });
    await verifyDimension(
      client,
      compared.evidence.evidence_id,
      test.verification,
      "calls",
      test.status,
    );
    for (const source of [test.left, test.right])
      expect(
        session.evidenceById(source.evidence_id)?.normalized_result,
      ).toEqual(source.normalized_result);
  }
});

it("normalizes numeric coordinates but preserves address spaces and source sites", async () => {
  const { client } = await createHarness();
  const at = (id: string, address: string) =>
    evidence(id, "9", [
      {
        ...reference("0x1000", "0x1010", "call", { targetName: null }),
        target_address: address,
      },
    ]);
  const equivalentCoordinates = [
    ["0x1010", "0x00001010"],
    ["0x1010", "0X001010"],
    ["0x10a", "0x10A"],
  ] as const;
  for (const [index, [left, right]] of equivalentCoordinates.entries())
    expectReferences(
      await compare(
        client,
        at(`coordinate-left-${index}`, left),
        at(`coordinate-right-${index}`, right),
      ),
      "unchanged",
    );

  expectReferences(
    await compare(
      client,
      at("space-left", "left:0x1010"),
      at("space-right", "right:0x1010"),
    ),
    "changed",
  );

  expectReferences(
    await compare(
      client,
      at("escaped-space-left", "seg%2f:0x0010"),
      at("escaped-space-right", "seg%2F:0x10"),
    ),
    "unchanged",
  );
  expectReferences(
    await compare(
      client,
      at("space-case-left", "RAM:0x10"),
      at("space-case-right", "ram:0x10"),
    ),
    "changed",
  );

  const unsupported = (
    id: string,
    digest: string,
    address: string,
    classification: Classification = "call",
  ) =>
    evidence(id, digest, [
      reference("0x1000", address, classification, { targetName: null }),
    ]);
  expectReferences(
    await compare(
      client,
      unsupported("unsupported-same-left", "a", "bad coordinate"),
      unsupported("unsupported-same-right", "a", "bad coordinate"),
    ),
    "unknown",
  );
  expectReferences(
    await compare(
      client,
      unsupported("unsupported-different-left", "b", "bad coordinate"),
      unsupported("unsupported-different-right", "c", "other bad coordinate"),
    ),
    "unknown",
  );
  expectReferences(
    await compare(
      client,
      unsupported("unsupported-call", "d", "bad coordinate", "call"),
      unsupported("unsupported-data", "e", "other bad coordinate", "data"),
    ),
    "changed",
  );

  const atSite = (id: string, site: string) =>
    evidence(id, "a", [
      reference(site, "0x1010", "call", { sourceEntryAddress: "0x1000" }),
    ]);
  expectReferences(
    await compare(
      client,
      atSite("site-left", "0x1004"),
      atSite("site-right", "0x1008"),
    ),
    "changed",
  );
});

it("keeps known reference changes decisive beside unrelated unknown kinds", async () => {
  const { client } = await createHarness();
  const left = evidence("mixed-left", "b", [
    reference("0x1000", "0x1010", "call"),
    reference("0x1000", "0x1020", "unknown", { targetName: "other" }),
  ]);
  const right = evidence(
    "mixed-right",
    "c",
    [
      reference("0x2000", "0x2020", "unknown", { targetName: "other" }),
      reference("0x2000", "0x2010", "data"),
    ],
    { procedureAddress: "0x2000" },
  );
  const compared = await compare(client, left, right);
  expectReferences(compared, "changed");
  await verifyDimension(client, compared.evidence.evidence_id, "fail");
});

it("keeps ambiguous duplicate edge kinds unknown independent of input order", async () => {
  const { client } = await createHarness();
  const left = [
    reference("0x1000", "0x1010", "call"),
    reference("0x1000", "0x1010", "unknown"),
  ];
  const right = [
    reference("0x2000", "0x2010", "unknown"),
    reference("0x2000", "0x2010", "data"),
  ];
  const first = await compare(
    client,
    evidence("ambiguous-left", "d", left),
    evidence("ambiguous-right", "e", right, { procedureAddress: "0x2000" }),
  );
  const reversed = await compare(
    client,
    evidence("ambiguous-left-reversed", "f", [...left].reverse()),
    evidence("ambiguous-right-reversed", "1", [...right].reverse(), {
      procedureAddress: "0x2000",
    }),
  );
  expectReferences(first, "unknown");
  expectReferences(reversed, "unknown");
  expect(
    reversed.result.dimensions.find(
      ({ dimension }) => dimension === "references",
    )?.limitations,
  ).toEqual(
    first.result.dimensions.find(({ dimension }) => dimension === "references")
      ?.limitations,
  );

  const changed = await compare(
    client,
    evidence("changed-target-left", "2", [reference("0x1000", "0x1010")]),
    evidence(
      "changed-target-right",
      "3",
      [reference("0x2000", "0x2020", "call", { targetName: "replacement" })],
      { procedureAddress: "0x2000" },
    ),
  );
  expectReferences(changed, "changed");
});

it("uses shared endpoint identity for selected calls and references claims", async () => {
  const { client } = await createHarness();
  const observed = (
    id: string,
    digest: string,
    target: string,
    name = "helper",
    options: Parameters<typeof evidence>[3] = {},
  ) =>
    evidence(
      id,
      digest,
      [reference("0x1000", target, "call", { targetName: name })],
      {
        callees: [procedure(target, name)],
        ...options,
      },
    );
  const baseline = observed("identity-baseline", "a", "0x1010");
  const cases = [
    {
      name: "retarget",
      right: observed("identity-retarget", "a", "0x1020"),
      expected: "fail",
    },
    {
      name: "rename",
      right: observed("identity-rename", "a", "0x1010", "renamed"),
      expected: "pass",
    },
    {
      name: "relocated-symbol",
      right: observed("identity-relocated", "b", "0x2020"),
      expected: "pass",
    },
    {
      name: "different-slice",
      right: observed("identity-slice", "a", "0x1010", "helper", {
        architecture: "x86_64",
        profile: createAnalysisProfile(provider, {
          ...profile.parameters,
          architecture: "x86_64",
        }),
      }),
      expected: "unknown",
    },
    {
      name: "unknown-architecture",
      right: observed("identity-no-arch", "a", "0x1010", "helper", {
        architecture: null,
      }),
      expected: "unknown",
    },
    {
      name: "rename-without-mapping",
      right: observed("identity-rename-no-profile", "a", "0x1010", "renamed", {
        profile: null,
      }),
      expected: "unknown",
    },
    {
      name: "unknown-mapping",
      right: observed("identity-no-profile", "a", "0x1010", "helper", {
        profile: null,
      }),
      expected: "unknown",
    },
    {
      name: "unrelated-analysis-options",
      right: observed("identity-options", "a", "0x1010", "helper", {
        profile: createAnalysisProfile(provider, {
          ...profile.parameters,
          analysis_options: {
            disabled_analyzers: ["Decompiler Switch Analysis"],
          },
        }),
      }),
      expected: "pass",
    },
    {
      name: "different-mapping",
      right: observed("identity-mapping", "a", "0x1010", "helper", {
        profile: createAnalysisProfile(provider, {
          architecture: "arm64",
          ...mapping,
          function_coordinate_context: createFunctionCoordinateContext({
            ...mapping,
            load_segment: "0x2000",
          }),
        }),
      }),
      expected: "unknown",
    },
    {
      name: "duplicate-name",
      right: observed("identity-duplicate", "b", "0x1010", "helper", {
        callees: [procedure("0x1010", "helper")],
        incoming: [
          reference("0x3030", "0x1000", "call", {
            sourceName: "helper",
            targetName: "main",
          }),
        ],
      }),
      expected: "unknown",
    },
    {
      name: "empty-name",
      right: observed("identity-empty", "b", "0x1010", ""),
      expected: "unknown",
    },
  ] as const;
  for (const scenario of cases) {
    const comparison = await compare(client, baseline, scenario.right);
    for (const dimension of ["calls", "references"] as const) {
      // The duplicate-name reference also adds an edge, a known multiplicity change.
      const expected =
        scenario.name === "duplicate-name" && dimension === "references"
          ? "fail"
          : scenario.expected;
      await verifyDimension(
        client,
        comparison.evidence.evidence_id,
        expected,
        dimension,
      );
    }
  }
});

it("keeps empty function labels ambiguous and selected identity unknown", async () => {
  const { client } = await createHarness();
  const comparison = await compare(
    client,
    evidence("empty-function-left", "a", [], { procedureName: "" }),
    evidence("empty-function-right", "b", [], { procedureName: "" }),
  );
  expect(comparison.result.function_match.status).toBe("ambiguous");
  expect(
    comparison.result.dimensions.find(
      ({ dimension }) => dimension === "identity",
    ),
  ).toMatchObject({ status: "unknown" });
  await verifyDimension(
    client,
    comparison.evidence.evidence_id,
    "unknown",
    "identity",
  );
});

it("retains caller entries and independent contradictions beside unknown endpoints", async () => {
  const { client } = await createHarness();
  const left = evidence("caller-left", "a", [], {
    callers: [procedure("0x1010", "caller")],
  });
  const right = evidence("caller-right", "a", [], {
    callers: [procedure("0x1020", "caller")],
  });
  const retargeted = await compare(client, left, right);
  await verifyDimension(
    client,
    retargeted.evidence.evidence_id,
    "fail",
    "calls",
  );

  const knownAndUnknown = (id: string, digest: string, name: string) =>
    evidence(id, digest, [], {
      callees: [
        procedure("0x1010", name),
        procedure("0x1010", name),
        procedure("0x1020", "sub_1020", null),
      ],
    });
  const mixed = await compare(
    client,
    knownAndUnknown("calls-mixed-left", "a", "known_left"),
    knownAndUnknown("calls-mixed-right", "b", "known_right"),
  );
  await verifyDimension(client, mixed.evidence.evidence_id, "fail", "calls");
});

it("keeps equal coordinates in distinct same-architecture universal slices unknown", async () => {
  const { client } = await createHarness();
  const selection = {
    kind: "macho-selected-image-v1" as const,
    container: "fat" as const,
    offset: 4096,
    byte_length: 256,
    cpu_type: 0x0100000c,
    cpu_subtype: 0,
    container_table_sha256: "c".repeat(64),
  };
  const atSlice = (id: string, selected: typeof selection) =>
    evidence(id, "a", [reference("0x1000", "0x1010")], {
      format: "mach-o-universal",
      callees: [procedure("0x1010", "helper")],
      profile: createAnalysisProfile(provider, {
        architecture: "arm64",
        function_coordinate_context: createFunctionCoordinateContext(
          { loader_arguments: ["-l", "Mach-O", "--aarch64"] },
          selected,
        ),
      }),
    });
  const left = atSlice("slice-arm64-left", selection);
  for (const [id, selected, expected] of [
    ["same", selection, "pass"],
    ["different", { ...selection, offset: 8192, cpu_subtype: 2 }, "unknown"],
  ] as const) {
    const comparison = await compare(
      client,
      left,
      atSlice(`slice-arm64-${id}`, selected),
    );
    for (const dimension of ["calls", "references"] as const)
      await verifyDimension(
        client,
        comparison.evidence.evidence_id,
        expected,
        dimension,
      );
  }
});

it.each([null, "default", "imported"] as const)(
  "native comparison uses observed symbol origin %s for EntryPoint labels",
  async (source) => {
    const harness = await createHarness();
    const edge = (base: "0x1000" | "0x2000", name: string) => {
      const value = reference(
        base,
        base === "0x1000" ? "0x1010" : "0x2010",
        "call",
        { targetName: name },
      );
      if (value.target_procedure === null)
        throw new Error("Missing fixture target");
      value.target_procedure.symbol =
        source === null
          ? null
          : {
              primary: true,
              dynamic: false,
              external: false,
              type: "function",
              source,
            };
      return value;
    };
    const leftEdge = edge(
      "0x1000",
      source === "imported" ? "EntryPoint" : "_main",
    );
    const rightEdge = edge("0x2000", "EntryPoint");
    if (
      leftEdge.target_procedure === null ||
      rightEdge.target_procedure === null
    )
      throw new Error("Missing fixture target");
    const compared = await compare(
      harness.client,
      evidence("origin-left", "1", [leftEdge], {
        procedureAddress: "0x1000",
        callees: [leftEdge.target_procedure],
      }),
      evidence("origin-right", "2", [rightEdge], {
        procedureAddress: "0x2000",
        callees: [rightEdge.target_procedure],
      }),
    );
    const status = source === "imported" ? "unchanged" : "unknown";
    expectReferences(compared, status);
    expect(
      compared.result.dimensions.find((value) => value.dimension === "calls"),
    ).toMatchObject({ status });
    await verifyDimension(
      harness.client,
      compared.evidence.evidence_id,
      source === "imported" ? "pass" : "unknown",
      "references",
    );
    await verifyDimension(
      harness.client,
      compared.evidence.evidence_id,
      source === "imported" ? "pass" : "unknown",
      "calls",
    );
  },
);

it("distinguishes same-entry renames from different entries through retained MCP Evidence", async () => {
  const harness = await createHarness();
  const left = evidence("before-rename", "a", [], {
    procedureAddress: "0x1000",
    procedureName: "evaluate",
  });
  const right = evidence("after-rename", "a", [], {
    procedureAddress: "0x01000",
    procedureName: "renamed_evaluate",
    procedureSymbol: {
      ...procedure("0x1000", "evaluate").symbol!,
      source: "user_defined",
    },
  });
  const first = await compare(harness.client, left, right);
  expect(first.result.function_match).toMatchObject({
    status: "matched",
    method: "same-entry",
    entry_address: "0x1000",
    left_name: "evaluate",
    right_name: "renamed_evaluate",
  });
  expect(
    first.result.dimensions.find(({ dimension }) => dimension === "identity"),
  ).toMatchObject({ status: "changed" });
  const repeated = await harness.client.callTool({
    name: "compare_functions",
    arguments: {
      left: { kind: "retained-evidence", evidence_id: left.evidence_id },
      right: { kind: "retained-evidence", evidence_id: right.evidence_id },
    },
  });
  expect(repeated.isError).not.toBe(true);
  expect(parseEvidence(repeated.structuredContent).normalized_result).toEqual(
    first.result,
  );
  const contract = SESSION_TOOL_CONTRACTS.find(
    ({ name }) => name === "compare_functions",
  );
  if (contract === undefined)
    throw new Error("compare_functions contract is missing");
  const schemaServer = new McpServer({
    name: "comparison-schema",
    version: "1",
  });
  const schemaClient = new Client({ name: "comparison-schema", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  onTestFinished(async () => {
    await schemaClient.close();
    await schemaServer.close();
  });
  schemaServer.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async () => ({
      content: [],
      structuredContent: repeated.structuredContent,
    }),
  );
  await schemaServer.connect(serverTransport);
  await schemaClient.connect(clientTransport);
  const advertised = (await schemaClient.listTools()).tools.find(
    ({ name }) => name === "compare_functions",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("compare_functions output schema is missing");
  const outputSchema = z
    .record(z.string(), z.unknown())
    .parse(advertised.outputSchema);
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  expect(ajv.validateSchema(outputSchema)).toBe(true);
  const validate = ajv.compile(outputSchema);
  expect(
    validate(repeated.structuredContent),
    JSON.stringify(validate.errors),
  ).toBe(true);
  const sdkResult = await schemaClient.callTool({
    name: contract.name,
    arguments: {
      left: { kind: "retained-evidence", evidence_id: left.evidence_id },
      right: { kind: "retained-evidence", evidence_id: right.evidence_id },
    },
  });
  expect(sdkResult.structuredContent).toEqual(repeated.structuredContent);
  expect(
    validate({
      ...first.evidence,
      normalized_result: {
        ...first.result,
        function_match: {
          status: "matched",
          method: "same-entry",
          left_name: "evaluate",
          right_name: "renamed_evaluate",
        },
      },
    }),
  ).toBe(false);
  const different = evidence("distinct-entry", "a", [], {
    procedureAddress: "0x2000",
    procedureName: "evaluate",
  });
  expect(
    (await compare(harness.client, left, different)).result.function_match,
  ).toMatchObject({ status: "mismatched", method: "explicit" });
});

it.each([
  { name: "missing profile", profile: null },
  {
    name: "missing coordinate commitment",
    profile: createAnalysisProfile(provider, {}),
  },
  {
    name: "malformed coordinate commitment",
    profile: createAnalysisProfile(provider, {
      function_coordinate_context: {
        kind: "native-function-coordinate-context-v1",
        mapping_sha256: "invalid",
        selected_image: null,
      },
    }),
  },
  {
    name: "different loader mapping",
    profile: createAnalysisProfile(provider, {
      function_coordinate_context: createFunctionCoordinateContext({
        ...mapping,
        entry_point: "0x2000",
      }),
    }),
  },
  { name: "unknown architecture", architecture: null },
  { name: "different architecture", architecture: "x86_64" as const },
  { name: "different format", format: "mach-o-universal" as const },
  {
    name: "unestablished entry coordinate",
    procedureAddress: "unresolved-entry",
  },
])(
  "keeps rename correspondence unknown with $name",
  async ({ name, ...options }) => {
    const harness = await createHarness();
    const left = evidence("known-entry", "a", [], {
      procedureAddress: "0x1000",
      procedureName: "evaluate",
    });
    const right = evidence(name, "a", [], {
      procedureAddress: "0x1000",
      procedureName: "renamed_evaluate",
      ...options,
    });
    expect(
      (await compare(harness.client, left, right)).result.function_match,
    ).toMatchObject({ status: "ambiguous", method: "explicit" });
  },
);

it.each([4096, 8192])(
  "binds same-entry correspondence to selected image offset %i",
  async (rightOffset) => {
    const harness = await createHarness();
    const source = (offset: number, name: string) =>
      evidence(name, "a", [], {
        procedureAddress: "0x1000",
        procedureName: name,
        format: "mach-o-universal",
        profile: createAnalysisProfile(provider, {
          function_coordinate_context: createFunctionCoordinateContext(
            mapping,
            {
              kind: "macho-selected-image-v1",
              container: "fat",
              offset,
              byte_length: 1024,
              cpu_type: 0x0100000c,
              cpu_subtype: 0,
              container_table_sha256: "a".repeat(64),
            },
          ),
        }),
      });
    expect(
      (
        await compare(
          harness.client,
          source(4096, "before"),
          source(rightOffset, "renamed"),
        )
      ).result.function_match,
    ).toMatchObject(
      rightOffset === 4096
        ? { status: "matched", method: "same-entry", entry_address: "0x1000" }
        : { status: "ambiguous", method: "explicit" },
    );
  },
);
