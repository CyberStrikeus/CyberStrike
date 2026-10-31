import type { ToolContract } from "../contracts/toolContractTypes.js";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import type { z } from "zod";
import {
  getEvidenceInputContract,
  type EvidenceRequestFrameInput,
} from "../domain/evidenceInputContract.js";
import {
  toolInputSchemaWithMetadata,
  toolOutputSchemaWithMetadata,
} from "../contracts/toolSchemaMetadata.js";

/** Project the canonical Zod contracts directly into SDK registration. */
export const toolRegistrationOptions = <Contract extends ToolContract>(
  contract: Contract,
): {
  readonly title: Contract["title"];
  readonly description: Contract["description"];
  readonly inputSchema: StandardSchemaWithJSON<
    z.input<Contract["inputSchema"]>,
    EvidenceRequestFrameInput<z.output<Contract["inputSchema"]>>
  >;
  readonly outputSchema: Contract["outputSchema"];
  readonly annotations: Contract["annotations"];
} => {
  const advertised = toolInputSchemaWithMetadata(contract);
  const evidenceInputs = getEvidenceInputContract<Contract["inputSchema"]>(
    contract.inputSchema,
  );
  // The application owns source admission. Preserve the exact advertised
  // declaration while the SDK validates only the borrowing request envelope.
  const inputSchema = {
    "~standard": {
      version: advertised["~standard"].version,
      vendor: advertised["~standard"].vendor,
      jsonSchema: advertised["~standard"].jsonSchema,
      validate: evidenceInputs.frameSchema["~standard"].validate,
    },
  };
  return {
    title: contract.title,
    description: contract.description,
    inputSchema,
    outputSchema: toolOutputSchemaWithMetadata(contract),
    annotations: contract.annotations,
  };
};

/** Register a workflow that validates raw input before effects and projects its own errors. */
export const applicationToolRegistrationOptions = <
  Contract extends ToolContract,
>(
  contract: Contract,
) => {
  const registration = toolRegistrationOptions(contract);
  const inputSchema: StandardSchemaWithJSON = {
    "~standard": {
      ...registration.inputSchema["~standard"],
      vendor: "rea-application",
      validate: (value: unknown) => ({ value }),
    },
  };
  return { ...registration, inputSchema };
};
