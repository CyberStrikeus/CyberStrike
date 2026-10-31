import assert from "node:assert/strict";

export const WINDOWS_GHIDRA_BYTE_SEARCH_FIXTURE = Object.freeze({
  pattern: "a0 ?? c0",
  mask: "f0 ff f0",
  startFileOffset: 0x380,
  endFileOffset: 0x392,
  markerOffsets: Object.freeze([0x380, 0x390]),
});

/** Put two masked, wildcarded signatures in loaded, source-owned PE bytes. */
export function writeWindowsGhidraByteSearchFixture(bytes) {
  bytes.set([0xa1, 0xb2, 0xc3], 0x380);
  bytes.set([0xa4, 0xb5, 0xc6], 0x390);
}

/** Verify real Ghidra search pages against the immutable source fixture. */
export async function verifyWindowsGhidraByteSearch({
  invoke,
  sourceBytes,
  imageBase,
  sourceOwnedFixture = true,
  fallbackAddress,
  fallbackFileOffset,
  runCliPage,
}) {
  const query = sourceOwnedFixture
    ? {
        pattern: WINDOWS_GHIDRA_BYTE_SEARCH_FIXTURE.pattern,
        mask: WINDOWS_GHIDRA_BYTE_SEARCH_FIXTURE.mask,
        start: addressAtFileOffset(
          imageBase,
          WINDOWS_GHIDRA_BYTE_SEARCH_FIXTURE.startFileOffset,
        ),
        end: addressAtFileOffset(
          imageBase,
          WINDOWS_GHIDRA_BYTE_SEARCH_FIXTURE.endFileOffset,
        ),
        limit: 1,
      }
    : {
        pattern: sourceBytes
          .subarray(fallbackFileOffset, fallbackFileOffset + 1)
          .toString("hex"),
        start: fallbackAddress,
        end: fallbackAddress,
        limit: 1,
      };

  if (!sourceOwnedFixture) {
    const result = await invoke("search_bytes", query);
    assert.equal(result.complete, true);
    assert.equal(result.next_cursor, null);
    assert.deepEqual(
      result.matches.map(({ address, file_offset }) => ({
        address,
        file_offset,
      })),
      [{ address: fallbackAddress, file_offset: fallbackFileOffset }],
    );
    assert.ok(result.searched.bytes > 0);
    return { bounded_source_match: true };
  }

  const { startFileOffset, endFileOffset } = WINDOWS_GHIDRA_BYTE_SEARCH_FIXTURE;
  const expected = [];
  for (
    let fileOffset = startFileOffset;
    fileOffset + 2 <= endFileOffset;
    fileOffset += 1
  ) {
    const first = sourceBytes[fileOffset];
    const last = sourceBytes[fileOffset + 2];
    if (first === undefined || last === undefined) break;
    if ((first & 0xf0) === 0xa0 && (last & 0xf0) === 0xc0)
      expected.push({
        address: addressAtFileOffset(imageBase, fileOffset),
        file_offset: fileOffset,
      });
  }
  assert.deepEqual(
    expected.map(({ file_offset }) => file_offset),
    [...WINDOWS_GHIDRA_BYTE_SEARCH_FIXTURE.markerOffsets],
    "The source-owned byte oracle must retain both distinct signatures",
  );

  const first = await invoke("search_bytes", query);
  assert.deepEqual(
    first.matches.map(({ address, file_offset }) => ({ address, file_offset })),
    [expected[0]],
  );
  assert.equal(first.complete, false);
  assert.equal(typeof first.next_cursor, "string");
  assert.ok(first.searched.bytes > 0);
  if (runCliPage !== undefined) {
    const cli = await runCliPage(query);
    assert.deepEqual(cli.matches, first.matches);
    assert.deepEqual(cli.searched, first.searched);
    assert.equal(cli.complete, first.complete);
  }

  const second = await invoke("search_bytes", {
    ...query,
    cursor: first.next_cursor,
  });
  assert.deepEqual(
    second.matches.map(({ address, file_offset }) => ({
      address,
      file_offset,
    })),
    [expected[1]],
  );
  assert.equal(second.complete, true);
  assert.equal(second.next_cursor, null);
  assert.ok(second.searched.bytes > 0);

  const covered = new Set();
  for (const page of [first, second]) {
    assert.equal(
      page.searched.bytes,
      page.searched.blocks.reduce((sum, block) => sum + block.bytes, 0),
    );
    for (const block of page.searched.blocks) {
      const start = BigInt(block.start);
      const end = BigInt(block.end);
      assert.ok(start >= BigInt(query.start) && end <= BigInt(query.end));
      for (let offset = start; offset <= end; offset += 1n)
        covered.add(offset.toString());
    }
  }
  assert.equal(
    covered.size,
    endFileOffset - startFileOffset + 1,
    "Paged byte-search coverage must account for the complete bounded source range",
  );
  return {
    bounded: true,
    wildcardAndMask: true,
    matches: expected,
    continuation: true,
    examinedBytes: covered.size,
    cliMcpParity: runCliPage !== undefined,
  };
}

function addressAtFileOffset(imageBase, fileOffset) {
  return `0x${(imageBase + 0x1000n + BigInt(fileOffset - 0x200)).toString(16)}`;
}
