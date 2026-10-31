import { PROMPT_CONTRACTS } from "../dist/contracts/promptContracts.js";

export const names = PROMPT_CONTRACTS.map(({ name }) => name);

/** Extract the text payload used by packaged MCP smoke assertions. */
export const mcpText = (result) => {
  const value = result.content?.find((item) => item.type === "text")?.text;
  if (typeof value !== "string") throw new Error("MCP result omitted text");
  return value;
};

/** Verify packaged prompt discovery and rendering through the public client. */
export const verifyPromptCatalog = async (client, options, expectedNames) => {
  const prompts = await client.listPrompts(undefined, options);
  if (
    JSON.stringify(prompts.prompts.map(({ name }) => name)) !==
    JSON.stringify(expectedNames)
  )
    throw new Error("packaged MCP prompt inventory diverged from contracts");
  const guided = await client.getPrompt(
    {
      name: "investigate_feature",
      arguments: { feature: "fixture behavior" },
    },
    options,
  );
  const guidedText = guided.messages.find(
    ({ content }) => content.type === "text",
  )?.content;
  if (
    guidedText?.type !== "text" ||
    !guidedText.text.includes("`trace_feature`") ||
    !guidedText.text.includes("Observations") ||
    !guidedText.text.includes("Unknowns")
  )
    throw new Error("packaged MCP guided prompt rendering failed");
};

/** Verify completion candidates for the installed provider readiness state. */
export const verifyPromptCompletion = async (client, options, expected) => {
  const requests = [
    {
      ref: { type: "ref/prompt", name: "investigate_feature" },
      argument: { name: "document", value: "fix" },
    },
    {
      ref: { type: "ref/prompt", name: "investigate_feature" },
      argument: { name: "procedure", value: "fix" },
      context: { arguments: { document: "fixture" } },
    },
  ];
  for (const request of requests) {
    const result = await client.complete(request, options);
    if (
      JSON.stringify(result.completion.values) !== JSON.stringify(expected) ||
      result.completion.total !== expected.length ||
      result.completion.hasMore !== false
    )
      throw new Error(
        `packaged MCP ${request.argument.name} completion mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(result.completion)}`,
      );
  }
};
