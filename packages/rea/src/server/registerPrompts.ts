import { promptArgumentsSchema } from "./promptArguments.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";
import { currentMcpRequestSignal } from "./EvidenceMcpServerCore.js";
import type { RegisteredPrompt } from "@modelcontextprotocol/server";

import type { AnalysisOperationPort } from "../application/AnalysisProvider.js";
import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import {
  guidedPromptArgumentValues,
  renderGuidedPrompt,
  type PromptContract,
} from "../contracts/promptContracts.js";
import { promptsForToolFamilies } from "../contracts/promptToolFamilyScope.js";
import {
  createPromptCompletionSource,
  type PromptCompletionSource,
} from "./promptCompletion.js";

/** Live prompt registry whose updates emit MCP prompts/list_changed. */
export interface GuidedPromptRegistry {
  update(contract: PromptContract): void;
}

/** Register every guided workflow and its session-scoped argument completers. */
export const registerGuidedPrompts = (
  server: EvidenceMcpServer,
  analysis: AnalysisOperationPort,
  session?: BinarySessionPort,
): GuidedPromptRegistry => {
  const source = createPromptCompletionSource(analysis, session);
  const completion = server.bindPromptCompletion({
    async complete(kind, value, context) {
      // Completions can query the same providers as tools. Cancellation alone
      // does not mean their provider cleanup has finished.
      return server.runRequest(currentMcpRequestSignal(), () =>
        source.complete(kind, value, context),
      );
    },
  });
  const prompts = new Map<string, RegisteredPrompt>();
  // Only workflows whose complete tool set is advertised: a partially
  // available workflow would name disabled calls in its rendered steps.
  for (const contract of promptsForToolFamilies(server.advertisedToolFamilies))
    prompts.set(contract.name, registerPrompt(server, contract, completion));
  return {
    update(contract) {
      const prompt = prompts.get(contract.name);
      if (prompt === undefined)
        throw new RangeError(`Unknown guided prompt ${contract.name}`);
      const argsSchema = promptArgumentsSchema(contract, completion);
      prompt.update({
        title: contract.title,
        description: contract.description,
        argsSchema,
        callback: (arguments_) => promptResult(contract, arguments_),
      });
    },
  };
};

const registerPrompt = (
  server: EvidenceMcpServer,
  contract: PromptContract,
  completion: PromptCompletionSource,
): RegisteredPrompt => {
  const argsSchema = promptArgumentsSchema(contract, completion);
  return server.registerCanonicalPrompt(
    contract.name,
    {
      title: contract.title,
      description: contract.description,
      argsSchema,
    },
    (arguments_) => promptResult(contract, arguments_),
  );
};

const promptResult = (contract: PromptContract, arguments_: unknown) => {
  const values = guidedPromptArgumentValues(contract, arguments_);
  return {
    description: contract.description,
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: renderGuidedPrompt(contract, values),
        },
      },
    ],
  };
};
