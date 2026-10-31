import assert from "node:assert/strict";

/** Compare exact native symbol and literal selectors through MCP and the real CLI. */
export async function verifyHopperCliSelectors(call, runCli, dispatcher, path) {
  const procedures = await call("list_procedures");
  const delegate = procedures.find(
    (item) => item.value === "-[REAWidget delegate]",
  );
  assert.ok(delegate, "Objective-C fixture omitted its tail-call method");
  const cases = [
    {
      command: "function",
      option: "procedure",
      operation: "analyze_function",
      // MCP defaults to a summary; match the CLI's complete dossier.
      parameters: { procedure: delegate.value, detail: "complete" },
    },
    {
      command: "instructions",
      option: "procedure",
      operation: "read_function_instructions",
      parameters: { procedure: delegate.value },
    },
    {
      command: "decompile",
      option: "procedure",
      operation: "procedure_pseudo_code",
      parameters: { procedure: delegate.value },
    },
    {
      command: "xrefs",
      option: "address",
      operation: "xrefs",
      parameters: { address: delegate.value },
    },
    {
      command: "search",
      option: "pattern",
      operation: "search_procedures",
      parameters: {
        pattern: delegate.value,
        mode: "literal",
        case_sensitive: true,
      },
      flags: ["--kind", "procedures", "--case-sensitive"],
    },
    {
      command: "trace",
      option: "query",
      operation: "trace_feature",
      parameters: { query: "--help" },
    },
  ];
  const expected = [];
  for (const item of cases)
    expected.push(await call(item.operation, item.parameters));
  await call("close_binary");
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i];
    const selector = item.parameters[item.option];
    const { stdout } = await runCli([
      dispatcher,
      item.command,
      path,
      `--${item.option}=${selector}`,
      ...(item.flags ?? []),
      "--provider",
      "hopper",
      "--format",
      "json",
    ]);
    const evidence = JSON.parse(stdout);
    assert.deepEqual(
      evidence.normalized_result,
      expected[i],
      `${item.command} named selector differs from MCP`,
    );
    assert.equal(
      evidence.parameters[item.option],
      selector,
      `${item.command} altered its selector`,
    );
  }
  return {
    commands: cases.map(({ command }) => command),
    exactObjectiveCNames: true,
    literalGlobalFlagPreserved: true,
  };
}
