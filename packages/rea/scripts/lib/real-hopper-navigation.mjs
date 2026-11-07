import assert from "node:assert/strict";

/** Verify native cursor readback and reject unrepresentable text before mutations. */
export async function verifyHopperNavigationAndText(call, invalid, address) {
  const cursor = await call("current_address");
  const procedures = await call("list_procedures");
  const other = procedures.find((item) => item.address !== address);
  assert.ok(other, "fixture omitted a second procedure for batch validation");
  const originalName = await call("address_name", { address });
  const originalComment = await call("comment", { address });
  const originalInline = await call("inline_comment", { address });
  const originalBookmark = (await call("list_bookmarks")).find(
    (item) => item.address === address,
  );
  try {
    await verifyNavigation(call, invalid, address, {
      originalName,
      originalComment,
      originalInline,
    });
    await verifyAnnotationText(call, invalid, { address, other, originalName });
    return {
      cursorReadback: true,
      interiorObjectNavigation: true,
      unmappedNavigationRejected: true,
      nativeTextValidationBeforeMutation: true,
      mappedAnnotationValidationBeforeMutation: true,
      unselectedLabelOwnersPreserved: true,
      explicitLabelSwap: true,
      observedLocalMetadata: true,
    };
  } finally {
    await call("goto_address", { address: cursor });
    await call("set_comment", { address, comment: originalComment ?? "" });
    await call("set_inline_comment", {
      address,
      comment: originalInline ?? "",
    });
    if (originalBookmark === undefined)
      await call("unset_bookmark", { address });
    else
      await call("set_bookmark", {
        address,
        ...(originalBookmark.name === null
          ? {}
          : { name: originalBookmark.name }),
      });
  }
}

async function verifyNavigation(
  call,
  invalid,
  address,
  { originalName, originalComment, originalInline },
) {
  const instructions = await call("read_function_instructions", {
    procedure: address,
  });
  const info = await call("procedure_info", { procedure: address });
  assert.equal(info.classification, null);
  assert.equal(info.body.available, false);
  assert.match(
    info.body.reason,
    /public Python API does not expose complete function body ranges/u,
  );
  assert.ok(info.locals.length > 0, "fixture omitted real stack locals");
  for (const local of info.locals) {
    assert.equal(typeof local.name, "string");
    assert.match(local.stack_displacement, /^-?\d+$/u);
    assert.ok(local.description.includes(local.name));
    assert.ok(local.description.includes(local.stack_displacement));
    assert.doesNotMatch(local.description, /object at 0x/u);
  }
  const dossier = await call("analyze_function", {
    procedure: address,
    detail: "complete",
  });
  assert.deepEqual(dossier.procedure.locals, info.locals);
  assert.equal(dossier.procedure.classification, null);
  assert.equal(dossier.procedure.body.available, false);
  assert.match(
    dossier.procedure.body.reason,
    /public Python API does not expose complete function body ranges/u,
  );
  assert.equal(dossier.native_api, null);
  assert.equal(dossier.native_value_flow, null);
  assert.ok(
    Array.isArray(dossier.limitations) && dossier.limitations.length > 0,
    "function dossier omitted Hopper's unsupported-facet limitations",
  );
  const coordinates = instructions.instructions.map(
    (line) => /^0x[0-9a-f]+/u.exec(line)?.[0],
  );
  assert.equal(coordinates[0], address);
  assert.ok(coordinates[1], "fixture omitted a second instruction");
  // The host toolchain controls the prologue encoding: without endbr64-style
  // padding the first instruction is one byte, so address + 1 is itself an
  // instruction boundary. Probe from inside the first multi-byte instruction
  // so the interior coordinate is never an analyzed-object boundary.
  let anchor = 0;
  while (anchor + 1 < coordinates.length) {
    if (BigInt(coordinates[anchor + 1]) - BigInt(coordinates[anchor]) > 1n)
      break;
    anchor += 1;
  }
  assert.ok(
    anchor + 1 < coordinates.length,
    "fixture omitted a multi-byte instruction for interior navigation",
  );
  const containing = coordinates[anchor];
  const interior = `0x${(BigInt(containing) + 1n).toString(16)}`;
  assert.equal(await call("goto_address", { address: interior }), containing);
  assert.equal(await call("current_address"), containing);
  assert.equal(
    await call("next_address", { address: interior }),
    coordinates[anchor + 1],
  );
  assert.equal(await call("prev_address", { address: interior }), containing);
  for (const unmapped of ["0x0", "0xfffffffffffffffe"]) {
    for (const operation of ["goto_address", "next_address", "prev_address"])
      await invalid(
        operation,
        { address: unmapped },
        /Address is outside every segment/u,
      );
    assert.equal(await call("current_address"), containing);
    for (const operation of [
      "set_address_name",
      "set_bookmark",
      "unset_bookmark",
      "set_comment",
      "set_inline_comment",
    ])
      await invalid(
        operation,
        {
          address: unmapped,
          ...(operation === "unset_bookmark"
            ? {}
            : operation.endsWith("comment")
              ? { comment: "must_not_apply" }
              : { name: "must_not_apply" }),
        },
        /Address is outside every segment/u,
      );
    await invalid(
      "set_addresses_names",
      { names: { [address]: "must_not_apply", [unmapped]: "unmapped" } },
      /Address is outside every segment/u,
    );
    assert.equal(await call("address_name", { address }), originalName);
    assert.equal(await call("comment", { address }), originalComment);
    assert.equal(await call("inline_comment", { address }), originalInline);
    assert.ok(
      !(await call("list_bookmarks")).some((item) => item.address === unmapped),
    );
  }
  const segments = await call("list_segments");
  const first = segments.reduce((left, right) =>
    BigInt(left.start) < BigInt(right.start) ? left : right,
  );
  const last = segments.reduce((left, right) =>
    BigInt(left.end) > BigInt(right.end) ? left : right,
  );
  await invalid(
    "prev_address",
    { address: first.start },
    /No previous address exists in mapped memory/u,
  );
  await invalid(
    "next_address",
    { address: `0x${(BigInt(last.end) - 1n).toString(16)}` },
    /No adjacent analyzed object exists in mapped memory/u,
  );
}

async function verifyAnnotationText(
  call,
  invalid,
  { address, other, originalName },
) {
  const comment = "REA representation boundary 测试";
  await call("set_comment", { address, comment });
  await call("set_inline_comment", { address, comment });
  await call("set_bookmark", { address, name: comment });
  for (const [text, reason] of [
    ["before\0after", /contains a NUL character/u],
    ["before\ud800after", /contains an unpaired Unicode surrogate/u],
  ]) {
    for (const operation of ["procedure_info", "read_bytes"])
      await invalid(
        operation,
        operation === "procedure_info"
          ? { procedure: text }
          : { address: text, length: 1 },
        reason,
      );
    for (const operation of ["set_address_name", "set_bookmark"])
      await invalid(operation, { address, name: text }, reason);
    for (const operation of ["set_comment", "set_inline_comment"])
      await invalid(operation, { address, comment: text }, reason);
    await invalid(
      "set_addresses_names",
      { names: { [address]: "must_not_apply", [other.address]: text } },
      reason,
    );
    assert.equal(await call("address_name", { address }), originalName);
    assert.equal(
      await call("address_name", { address: other.address }),
      other.value,
    );
    assert.equal(await call("comment", { address }), comment);
    assert.equal(await call("inline_comment", { address }), comment);
    assert.equal(
      (await call("list_bookmarks")).find((item) => item.address === address)
        ?.name,
      comment,
    );
  }
  await invalid(
    "set_address_name",
    { address, name: other.value },
    /already assigned to/u,
  );
  await invalid(
    "set_addresses_names",
    { names: { [address]: other.value } },
    /already assigned to/u,
  );
  await invalid(
    "set_addresses_names",
    { names: { [address]: "duplicate", [other.address]: "duplicate" } },
    /assigns the same name more than once/u,
  );
  await invalid(
    "set_addresses_names",
    { names: { [address]: "first", [address.slice(2)]: "second" } },
    /selects the same address more than once/u,
  );
  assert.equal(await call("address_name", { address }), originalName);
  assert.equal(
    await call("address_name", { address: other.address }),
    other.value,
  );
  try {
    const swapped = await call("set_addresses_names", {
      names: { [address]: other.value, [other.address]: originalName },
    });
    assert.equal(swapped[address], true);
    assert.equal(swapped[other.address], true);
    assert.equal(await call("address_name", { address }), other.value);
    assert.equal(
      await call("address_name", { address: other.address }),
      originalName,
    );
  } finally {
    await call("set_addresses_names", {
      names: { [address]: originalName, [other.address]: other.value },
    });
  }
}
