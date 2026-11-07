import assert from "node:assert/strict";

const limitationPattern = /Borland\/Delphi-style SEH frame registration/u;

/** Verify Ghidra reports, and does not absorb, the fixture's handler region. */
export async function verifyGhidraBorlandSeh(functionObservation, x86) {
  assert.equal(x86, true, "The SEH control exists only in the x86 PE fixture");
  const caller = "0x401015";
  const procedure = "0x401080";
  const handler = "0x4010c0";

  const ordinary = await functionObservation("procedure_info", {
    procedure: "0x401010",
  });
  assert.ok(
    !ordinary.limitations.some((item) => limitationPattern.test(item)),
    "The ordinary return-42 control unexpectedly reports an SEH limitation",
  );

  const info = await functionObservation("procedure_info", { procedure });
  assert.ok(info.limitations.some((item) => limitationPattern.test(item)));

  const outgoing = await functionObservation("procedure_references", {
    procedure,
    direction: "outgoing",
  });
  assert.equal(outgoing.value.direction, "outgoing");
  assert.ok(outgoing.limitations.some((item) => limitationPattern.test(item)));
  assert.ok(
    outgoing.value.references.some(
      (reference) =>
        reference.source_address === "0x401083" &&
        reference.target_address === handler &&
        reference.kind.available &&
        reference.kind.data &&
        !reference.kind.call,
    ),
    "The pushed handler address must remain an observed data reference, without inventing a call",
  );

  const incoming = await functionObservation("procedure_references", {
    procedure,
    direction: "incoming",
  });
  assert.equal(incoming.value.direction, "incoming");
  assert.ok(incoming.limitations.some((item) => limitationPattern.test(item)));
  assert.ok(
    incoming.value.references.some(
      (reference) =>
        reference.source_address === caller &&
        reference.target_address === procedure,
    ),
    "The caller-to-registration procedure reference was not observed",
  );

  const dossier = await functionObservation("analyze_function", {
    procedure,
  });
  assert.ok(dossier.limitations.some((item) => limitationPattern.test(item)));
  assert.ok(
    dossier.value.limitations.some((item) => limitationPattern.test(item)),
    "The normalized function dossier lost the SEH limitation",
  );
  assert.equal(dossier.value.procedure.body.available, true);
  assert.ok(dossier.value.procedure.body.ranges.length > 0);
  assert.ok(
    !dossier.value.procedure.body.ranges.some(
      (range) =>
        BigInt(range.start) <= BigInt(handler) &&
        BigInt(range.end) >= BigInt(handler),
    ),
    "The handler was incorrectly claimed as part of the procedure body",
  );

  return {
    limitation: true,
    ordinary_control: true,
    procedure_references_incoming_and_outgoing: true,
    handler_data_reference: true,
    caller_reference: true,
    dossier_limitation: true,
    handler_body_not_claimed: true,
  };
}
