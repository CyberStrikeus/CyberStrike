/** Open the large fixture and verify complete inline search results. */
export async function openAndVerifyLargeFixture({
  client,
  options,
  normalizedResult,
  path,
  expectedCount,
  symbolPrefix,
  stringPrefix,
}) {
  const opened = await client.callTool(
    { name: "open_binary", arguments: { path } },
    options,
  );
  if (opened.isError === true)
    throw new Error("Hopper rejected the large fixture");
  const procedures = await collectAllMatches({
    client,
    options,
    normalizedResult,
    tool: "search_procedures",
    pattern: symbolPrefix.replace(/^_+/u, ""),
    expectedPrefix: symbolPrefix.replace(/^_+/u, ""),
    expectedCount,
    normalize: (value) => value.replace(/^_+/u, ""),
  });
  const strings = await collectAllMatches({
    client,
    options,
    normalizedResult,
    tool: "search_strings",
    pattern: stringPrefix,
    expectedPrefix: stringPrefix,
    expectedCount,
    normalize: (value) => value,
  });
  return { procedures, strings };
}

async function collectAllMatches({
  client,
  options,
  normalizedResult,
  tool,
  pattern,
  expectedPrefix,
  expectedCount,
  normalize,
}) {
  const matches = normalizedResult(
    await client.callTool(
      {
        name: tool,
        arguments: { pattern, mode: "literal", case_sensitive: true },
      },
      options,
    ),
    tool,
  );
  if (!Array.isArray(matches) || matches.length !== expectedCount)
    throw new Error(`${tool} did not return every expected match`);
  const addresses = new Set();
  const values = new Set();
  for (const item of matches) {
    const value = normalize(item.value);
    if (
      typeof item.address !== "string" ||
      !/^0x[0-9a-f]+$/iu.test(item.address)
    )
      throw new Error(`${tool} returned a malformed address`);
    if (addresses.has(item.address) || values.has(value))
      throw new Error(`${tool} returned duplicate matches`);
    addresses.add(item.address);
    values.add(value);
  }
  const expectedValues = Array.from(
    { length: expectedCount },
    (_, index) => `${expectedPrefix}${String(index).padStart(4, "0")}`,
  );
  if (expectedValues.some((value) => !values.has(value)))
    throw new Error(`${tool} omitted expected matches`);
  return { count: values.size, calls: 1 };
}
