import { digestSchema } from "../digests.js";
import { providerSchema } from "../evidence.js";
import { jsonValueSchema } from "../jsonValue.js";

/** Native projections reference the original provider/profile without repeating its full commitment. */
export const nativeViewSourceContext = {
  source_provider: providerSchema.nullable(),
  source_analysis_profile_digest: digestSchema.nullable(),
  source_parameters: jsonValueSchema,
};
