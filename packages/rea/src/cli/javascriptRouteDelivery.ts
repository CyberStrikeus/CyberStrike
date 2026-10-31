import { z } from "incur";
import { analysisEvidenceDeliveryOptions } from "./analysisEvidenceDelivery.js";

export const javascriptRouteDeliveryOptions = {
  ...analysisEvidenceDeliveryOptions,
  view: z
    .string()
    .optional()
    .describe(
      "JSON javascript-routes view; requires --detail summary and --evidence_output",
    ),
};

export const webBundleDeliveryOptions = {
  ...javascriptRouteDeliveryOptions,
  view: javascriptRouteDeliveryOptions.view.describe(
    "JSON web-bundle (endpoints, inferences, summary) or javascript-routes view; requires --detail summary and --evidence_output",
  ),
};
