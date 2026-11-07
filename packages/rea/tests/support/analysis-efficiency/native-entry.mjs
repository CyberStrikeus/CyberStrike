import { open, readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

export const NATIVE_ARTIFACTS = ["jq", "sharex.exe", "freedos.edlin.exe"];
const normalized = (value) => value.normalized_result;

const retainedEntryViews = async (
  call,
  info,
  inputSha,
  ToolFailure,
  sourceEvidenceIds,
) => {
  const n = normalized(info);
  const retainedViews = [];
  const retainedViewEvidence = [];
  const observedEvidenceIds = new Set([info.evidence_id, ...sourceEvidenceIds]);
  let nativeSummaryOutcome, summaryEvidenceId;
  for (const facet of ["procedure", "pseudocode", "callers", "callees"]) {
    const selected = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id: info.evidence_id },
      view: {
        kind: "native",
        facet,
        offset: 0,
        limit: facet === "pseudocode" ? 512 : 64,
      },
    });
    const view = normalized(selected);
    if (observedEvidenceIds.has(selected.evidence_id))
      throw new Error("Retained native view reused an Evidence identity");
    const expected =
      facet === "procedure"
        ? n.procedure
        : facet === "pseudocode"
          ? { text: n.pseudocode.slice(0, 512), unit: "utf16-code-units" }
          : n[facet].slice(0, 64);
    if (
      !isDeepStrictEqual(view.item, expected) ||
      view.parent_evidence_id !== info.evidence_id ||
      view.artifact.sha256 !== inputSha
    )
      throw new Error(
        "Retained native view changed the selected source facts or identity",
      );
    observedEvidenceIds.add(selected.evidence_id);
    retainedViews.push({
      facet,
      item: view.item,
      coverage: view.coverage,
      limitations: view.limitations,
      unknowns: view.unknowns,
    });
    retainedViewEvidence.push({
      facet,
      evidence_id: selected.evidence_id,
      parent_evidence_id: view.parent_evidence_id,
    });
  }
  // Exercise the advertised summary recipe separately. A known refusal
  // is recorded as such; it does not validate a nonexistent capability.
  try {
    const summary = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id: info.evidence_id },
      view: { kind: "summary" },
    });
    if (observedEvidenceIds.has(summary.evidence_id))
      throw new Error("Native summary reused an Evidence identity");
    nativeSummaryOutcome = { status: "supported" };
    summaryEvidenceId = summary.evidence_id;
  } catch (error) {
    if (
      !(error instanceof ToolFailure) ||
      error.value?.error?.code !== "invalid_request"
    )
      throw error;
    nativeSummaryOutcome = {
      status: "unsupported",
      error: error.value.error,
    };
  }
  return {
    retainedViews,
    retainedViewEvidence,
    nativeSummaryOutcome,
    summaryEvidenceId,
  };
};

const retainedJqMain = async (call, ToolFailure) => {
  // This exact application entry is materialized in the pinned jq entry's
  // observed MOV RDI, 0x401f00 instruction, not an original-source claim.
  let main;
  const mainEvidenceIds = [];
  let sourceId;
  try {
    const completed = await call("analyze_function", {
      procedure: "0x401f00",
    });
    sourceId = completed.evidence_id;
  } catch (error) {
    const reference =
      error instanceof ToolFailure &&
      error.value?.error?.code === "resource_constraint"
        ? error.value.error.details?.reported_limits?.evidence_reference
        : undefined;
    if (reference?.kind !== "retained-evidence") throw error;
    sourceId = reference.evidence_id;
  }
  mainEvidenceIds.push(sourceId);
  main = {};
  for (const facet of [
    "procedure",
    "pseudocode",
    "referenced_strings",
    "callees",
    "callers",
    "basic_blocks",
  ]) {
    let offset = 0;
    const items = [];
    const pages = [];
    do {
      const selected = await call("inspect_analysis_view", {
        source: { kind: "retained-evidence", evidence_id: sourceId },
        view: {
          kind: "native",
          facet,
          offset,
          limit:
            facet === "pseudocode" ? 65536 : facet === "basic_blocks" ? 1 : 64,
        },
      });
      mainEvidenceIds.push(selected.evidence_id);
      const v = normalized(selected);
      items.push(v.item);
      pages.push({
        coverage: v.coverage,
        limitations: v.limitations,
        unknowns: v.unknowns,
      });
      if (v.coverage.exhausted || facet === "basic_blocks") break;
      if (v.coverage.next_offset === null || v.coverage.next_offset <= offset)
        throw new Error("Native view did not advance");
      offset = v.coverage.next_offset;
    } while (true);
    main[facet] = { items, pages };
  }
  return { main, mainEvidenceIds };
};

export const measureNativeEntry = async ({
  seed,
  values,
  call,
  inputSha,
  ToolFailure,
}) => {
  await call("open_binary", { path: values.path, provider_id: "ghidra" });
  try {
    // DOS addresses follow the actual admitted load image. A file header
    // offset is not a provider address or proof of runtime execution.
    let loadImage, loadImageEvidenceId;
    if (seed === undefined) {
      const imageEvidence = await call("inspect_native_load_image", {});
      loadImage = normalized(imageEvidence);
      if (loadImage.status !== "verified")
        throw new Error(
          "The shipped DOS load image was not independently verified",
        );
      if (loadImage.target_sha256 !== inputSha)
        throw new Error("The DOS load image belongs to a different target");
      loadImageEvidenceId = imageEvidence.evidence_id;
      seed = loadImage.entry.linear_address;
    }
    const address = seed;
    const containing = await call("resolve_containing_procedure", {
      address,
    });
    const info = await call("analyze_function", { procedure: address });
    const n = normalized(info);
    const selected =
      values["native-question"] === "entry-views"
        ? await retainedEntryViews(call, info, inputSha, ToolFailure, [
            containing.evidence_id,
            ...(loadImageEvidenceId === undefined ? [] : [loadImageEvidenceId]),
          ])
        : {};
    const { main, mainEvidenceIds = [] } =
      values["native-question"] === "entry-and-main"
        ? await retainedJqMain(call, ToolFailure)
        : {};
    return {
      artifact_sha256: info.subject?.digest.sha256,
      entry_address: address,
      containing_procedure: normalized(containing),
      procedure: n.procedure,
      pseudocode_prefix: n.pseudocode.slice(0, 512),
      caller_count: n.callers.length,
      callee_count: n.callees.length,
      ...(main === undefined ? {} : { main }),
      analysis_profile: info.analysis_profile,
      ...(loadImage === undefined ? {} : { load_image: loadImage }),
      ...(selected.retainedViews === undefined
        ? {}
        : {
            retained_views: selected.retainedViews,
            native_summary_outcome: selected.nativeSummaryOutcome,
          }),
      evidence_ids:
        selected.retainedViews === undefined
          ? [
              containing.evidence_id,
              info.evidence_id,
              ...mainEvidenceIds,
              ...(loadImageEvidenceId === undefined
                ? []
                : [loadImageEvidenceId]),
            ]
          : {
              containing_procedure: containing.evidence_id,
              function_dossier: info.evidence_id,
              ...(loadImageEvidenceId === undefined
                ? {}
                : { native_load_image: loadImageEvidenceId }),
              retained_views: selected.retainedViewEvidence,
              ...(selected.summaryEvidenceId === undefined
                ? {}
                : { native_summary: selected.summaryEvidenceId }),
            },
    };
  } finally {
    await call("close_binary", {});
  }
};

export const nativeEntrySeed = async (artifact, path) => {
  if (artifact === "jq") {
    const file = await open(path, "r");
    let header;
    try {
      header = (await file.read(Buffer.alloc(32), 0, 32, 0)).buffer;
    } finally {
      await file.close();
    }
    if (header.subarray(0, 6).toString("hex") !== "7f454c460201")
      throw new Error("Expected ELF64 little endian entry seed");
    return `0x${header.readBigUInt64LE(24).toString(16)}`;
  }
  if (artifact === "sharex.exe") {
    const bytes = await readFile(path);
    const pe = bytes.readUInt32LE(0x3c);
    const optional = pe + 24;
    if (
      bytes.subarray(pe, pe + 4).toString("hex") !== "50450000" ||
      bytes.readUInt16LE(pe + 4) !== 0x8664 ||
      bytes.readUInt16LE(optional) !== 0x20b ||
      bytes.readUInt32LE(optional + 108) <= 14 ||
      bytes.readUInt32LE(optional + 112 + 14 * 8) !== 0 ||
      bytes.readUInt32LE(optional + 116 + 14 * 8) !== 0
    )
      throw new Error(
        "Expected the pinned native PE32+ entry seed without CLR metadata",
      );
    const address =
      bytes.readBigUInt64LE(optional + 24) +
      BigInt(bytes.readUInt32LE(optional + 16));
    return `0x${address.toString(16)}`;
  }
  if (artifact === "freedos.edlin.exe") return undefined;
  throw new Error("Select a pinned native artifact");
};
