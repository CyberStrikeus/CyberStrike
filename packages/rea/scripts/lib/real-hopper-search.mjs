import assert from "node:assert/strict";
import { mcpTextValue } from "./mcp-verifier-results.mjs";

const fixtureSymbolPrefix = process.platform === "darwin" ? "_" : "";

/** Exercise literal/regex search, Unicode identities and cache invalidation in Hopper. */
export async function verifyHopperSearch(call, invalid, procedure) {
  const address = procedure.address;
  const original = await call("address_name", { address });
  let stringCoverage;
  try {
    await verifySymbolNames(call, invalid, address);
    stringCoverage = await verifySearchModes(call, address);
  } finally {
    await call("set_address_name", { address, name: original });
  }
  assert.deepEqual(
    await call("search_procedures", {
      pattern: original,
      mode: "literal",
      case_sensitive: true,
    }),
    [{ address, value: original }],
  );
  return {
    unicodeIdentity: true,
    literalMetacharacters: true,
    longValuePreserved: true,
    symbolUtf16LimitValidatedBeforeMutation: true,
    regexAndCaseModes: true,
    annotationCacheInvalidation: true,
    stringCoverage,
  };
}

async function verifySymbolNames(call, invalid, address) {
  const unicode = "REA_é_e\u0301_😀_Straße_ſ_İ";
  const extentNames = ["x".repeat(1024), "é".repeat(1024), "😀".repeat(512)];
  for (const name of ["REA_a.b[0]", unicode, ...extentNames]) {
    assert.equal(await call("set_address_name", { address, name }), true);
    assert.equal(await call("address_name", { address }), name);
    assert.deepEqual(await call("list_names", { address }), [
      { address, value: name },
    ]);
    assert.deepEqual(
      await call("search_procedures", {
        pattern: name,
        mode: "literal",
        case_sensitive: true,
      }),
      [{ address, value: name }],
    );
    assert.equal(await call("procedure_address", { procedure: name }), address);
  }
  assert.deepEqual(
    await call("search_procedures", { pattern: unicode, mode: "literal" }),
    [],
  );
  const other = (await call("list_procedures")).find(
    (item) => item.address !== address,
  );
  assert.ok(other);
  for (const name of ["x".repeat(1025), "é".repeat(1025), "😀".repeat(513)]) {
    await invalid(
      "set_address_name",
      { address, name },
      /UTF-16 code-unit symbol-name limit/u,
    );
    await invalid(
      "set_addresses_names",
      { names: { [other.address]: "must_not_apply", [address]: name } },
      /UTF-16 code-unit symbol-name limit/u,
    );
    assert.equal(await call("address_name", { address }), extentNames.at(-1));
    assert.equal(
      await call("address_name", { address: other.address }),
      other.value,
    );
  }
}

async function verifySearchModes(call, address) {
  await call("set_address_name", { address, name: "REA_Search_Upper" });
  assert.deepEqual(
    await call("search_procedures", {
      pattern: "rea_search_upper",
      mode: "literal",
      case_sensitive: false,
    }),
    [{ address, value: "REA_Search_Upper" }],
  );
  assert.deepEqual(
    await call("search_procedures", {
      pattern: "rea_search_upper",
      mode: "literal",
      case_sensitive: true,
    }),
    [],
  );
  assert.deepEqual(
    await call("search_procedures", {
      pattern: "^REA_Search_(?:Upper|Lower)$",
      mode: "regex",
      case_sensitive: true,
    }),
    [{ address, value: "REA_Search_Upper" }],
  );
  const strings = await call("list_strings");
  const fullLiteral = await verifyHopperStringFragments(call, strings, {
    symbol: `${fixtureSymbolPrefix}rea_long_literal`,
    value: "REA_LONG_LITERAL_" + "x".repeat(4096) + "needle",
    recognitionOptional: true,
  });
  const fragmentedLiteral = await verifyHopperStringFragments(call, strings, {
    symbol: `${fixtureSymbolPrefix}rea_fragmented_literal`,
    value: "REA_FRAGMENTED_LITERAL_" + "x".repeat(512) + "fragment_tail",
  });
  const [longItem] = fragmentedLiteral.fragments;
  assert.ok(longItem, "fixture omitted its typed fragmented literal");
  assert.ok(fragmentedLiteral.fragments.length > 1);
  assert.ok(longItem.provider_value.endsWith("…"));
  assert.equal(longItem.string.termination, "missing");
  const literalProcedure = (await call("list_procedures")).find((item) =>
    item.value.endsWith("rea_long_literal_procedure"),
  );
  assert.ok(literalProcedure);
  const dossier = await call("analyze_function", {
    procedure: literalProcedure.address,
    detail: "complete",
  });
  const referenced = dossier.referenced_strings.find(
    (item) => item.address === longItem.address,
  );
  assert.ok(referenced, "function dossier omitted its long literal reference");
  const { source_address, ...stringRecord } = referenced;
  assert.ok(
    dossier.outgoing_references.some(
      (edge) =>
        edge.source_address === source_address &&
        edge.target_address === longItem.address,
    ),
  );
  assert.deepEqual(
    stringRecord,
    longItem,
    "function dossier discarded typed string provenance",
  );

  assert.deepEqual(
    await call("search_strings", {
      pattern: "fragment_tail",
      mode: "literal",
      case_sensitive: true,
    }),
    [fragmentedLiteral.fragments.at(-1)],
  );
  const expected = strings.filter((item) =>
    /^REA_C_(?:ENTRY|LEAF)$/u.test(item.value),
  );
  assert.equal(expected.length, 2);
  assert.deepEqual(
    await call("search_strings", {
      pattern: "^REA_C_(?:ENTRY|LEAF)$",
      mode: "regex",
      case_sensitive: true,
    }),
    expected,
  );
  const objects = await verifyHopperStringObjects(
    call,
    [
      {
        value: "REA_UTF8_é_😀",
        encoding: "utf-8",
        symbol: `${fixtureSymbolPrefix}rea_utf8_literal`,
        recognitionOptional: true,
      },
      { value: 'REA_ESCAPED_"\\line\nend\t\r', encoding: "utf-8" },
      { value: "REA_LITERAL_BACKSLASH_\\n", encoding: "utf-8" },
      {
        value: "REA_LITERAL_…",
        encoding: "utf-8",
        symbol: `${fixtureSymbolPrefix}rea_ellipsis_literal`,
        recognitionOptional: true,
      },
      {
        value: "REA_LATIN1_ÿ",
        encoding: "latin-1",
        symbol: `${fixtureSymbolPrefix}rea_latin1_literal`,
        recognitionOptional: true,
      },
    ],
    strings,
  );
  return {
    fullLiteralSourceBytes: fullLiteral.sourceBytes,
    fragmentedLiteralSourceBytes: fragmentedLiteral.sourceBytes,
    fullLiteralRecognition: fullLiteral.recognition,
    ...objects,
  };
}

/** Bind native fragments to exact source bytes without assuming loader recognition. */
export async function verifyHopperStringFragments(
  call,
  strings,
  { symbol, value, recognitionOptional = false },
) {
  const expectedBytes = Buffer.from(value + "\0");
  const raw = await call("read_bytes", {
    address: symbol,
    length: expectedBytes.length,
  });
  assert.equal(raw.complete, true);
  assert.equal(raw.bytes_hex, expectedBytes.toString("hex"));
  const start = BigInt(raw.address);
  const end = start + BigInt(expectedBytes.length);
  const fragments = strings.filter((item) => {
    const address = BigInt(item.address);
    return address >= start && address < end;
  });
  if (fragments.length === 0 && recognitionOptional)
    return {
      sourceBytes: expectedBytes.length,
      recognition: {
        address: raw.address,
        state: "not_observed",
        decodedObject: "unverified",
      },
      fragments,
    };
  assert.ok(fragments.length > 0, "fixture omitted its typed string fragments");
  let next = start;
  for (const [index, fragment] of fragments.entries()) {
    assert.equal(
      BigInt(fragment.address),
      next,
      "string fragments have a gap, overlap or wrong source identity",
    );
    const terminal = index === fragments.length - 1;
    assert.equal(
      fragment.string.termination,
      terminal ? "present_or_not_required" : "missing",
    );
    const expected = Buffer.from(fragment.value + (terminal ? "\0" : ""));
    assert.equal(fragment.string.byte_length, expected.length);
    const bytes = await call("read_bytes", {
      address: fragment.address,
      length: expected.length,
    });
    assert.equal(bytes.complete, true);
    assert.equal(bytes.bytes_hex, expected.toString("hex"));
    next += BigInt(expected.length);
  }
  assert.equal(next, end, "string fragments do not cover the source extent");
  assert.equal(fragments.map((item) => item.value).join(""), value);
  return {
    sourceBytes: expectedBytes.length,
    recognition: {
      address: raw.address,
      state: "observed",
      decodedObject: "verified",
    },
    fragments,
  };
}

/** Compare native string identities and values with the source fixture's bytes. */
export async function verifyHopperStringObjects(
  call,
  expectations,
  inventory = null,
) {
  // Reuse only the caller's inventory for this unchanged document, never live
  // state from an earlier session. Address-filter and search checks remain real.
  const strings = inventory ?? (await call("list_strings"));
  const recognition = [];
  for (const {
    value,
    encoding,
    symbol,
    recognitionOptional = false,
  } of expectations) {
    const expectedBytes = Buffer.from(
      value + "\0",
      encoding.replaceAll("-", ""),
    );
    let sourceBytes;
    if (symbol !== undefined) {
      const raw = await call("read_bytes", {
        address: symbol,
        length: expectedBytes.length,
      });
      sourceBytes = raw;
      assert.equal(raw.complete, true);
      assert.equal(raw.bytes_hex, expectedBytes.toString("hex"));
    }
    const item = strings.find((candidate) =>
      sourceBytes === undefined
        ? candidate.value === value
        : candidate.address === sourceBytes.address,
    );
    if (item === undefined && recognitionOptional) {
      assert.ok(
        symbol,
        "optional recognition requires independent source-byte coverage",
      );
      recognition.push({
        value,
        address: sourceBytes.address,
        state: "not_observed",
        decodedObject: "unverified",
      });
      continue;
    }
    assert.ok(
      item,
      `Hopper omitted the decoded string ${JSON.stringify(value)}`,
    );
    assert.equal(
      item.value,
      value,
      "native string decoding changed the source value",
    );
    recognition.push({
      value,
      address: item.address,
      state: "observed",
      decodedObject: "verified",
    });
    assert.equal(item.string.encoding, encoding);
    assert.equal(item.string.encoding_status, "inferred");
    assert.equal(item.string.termination, "present_or_not_required");
    assert.equal(item.string.byte_length, expectedBytes.length);
    const bytes =
      sourceBytes ??
      (await call("read_bytes", {
        address: item.address,
        length: expectedBytes.length,
      }));
    assert.equal(bytes.complete, true);
    assert.equal(bytes.bytes_hex, expectedBytes.toString("hex"));
    assert.deepEqual(await call("list_strings", { address: item.address }), [
      item,
    ]);
    assert.deepEqual(
      await call("search_strings", {
        pattern: value,
        mode: "literal",
        case_sensitive: true,
      }),
      [item],
    );
  }
  assert.deepEqual(
    await call("search_strings", { pattern: "\\xC3\\xA9", mode: "literal" }),
    [],
  );
  return {
    sourceBytesVerified: true,
    recognition,
    displayEscapesExcludedFromMatching: true,
  };
}

/** A failed or cancelled pathological regex must leave the real Hopper API usable. */
export async function verifyHopperRegexIsolation(
  client,
  options,
  call,
  address,
) {
  const original = await call("address_name", { address });
  const pathological = "a".repeat(40) + "!";
  try {
    await call("set_address_name", { address, name: pathological });
    const reply = await client.callTool(
      {
        name: "search_procedures",
        arguments: { pattern: "(a+)+$", mode: "regex", case_sensitive: true },
      },
      options,
    );
    assert.equal(reply.isError, true);
    const { error } = JSON.parse(mcpTextValue(reply));
    assert.equal(error.code, "resource_constraint");
    assert.equal(error.details.operation, "search_procedures");
    assert.equal(error.details.resource, "cpu");
    assert.equal(await call("address_name", { address }), pathological);
    const controller = new AbortController();
    const pending = client.callTool(
      {
        name: "search_procedures",
        arguments: { pattern: "(a+)+$", mode: "regex", case_sensitive: true },
      },
      { ...options, signal: controller.signal },
    );
    const cancelled = pending.catch((cause) => cause);
    // The same small inventory has already completed once; leave the pathological
    // matching worker running before cancelling the second caller.
    await new Promise((resolve) => setTimeout(resolve, 750));
    controller.abort();
    await cancelled;
    assert.equal(await call("address_name", { address }), pathological);
    assert.deepEqual(
      await call("search_procedures", {
        pattern: pathological,
        mode: "literal",
        case_sensitive: true,
      }),
      [{ address, value: pathological }],
    );
  } finally {
    await call("set_address_name", { address, name: original });
  }
  return {
    regexDeadlinePreservesSession: true,
    regexCancellationPreservesSession: true,
  };
}
