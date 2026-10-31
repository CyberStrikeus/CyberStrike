import { z } from "zod";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

export const ENVIRONMENT_NAME_CONSTRAINT =
  "ENVIRONMENT_NAME must be a non-empty name when set.";

const environmentNameSchema = z.string().trim().min(1);

/** The served environment name override, or undefined when the manifest name applies. */
export const parseEnvironmentName = (
  environment: Readonly<NodeJS.ProcessEnv>,
): Result<string | undefined, ConfigurationError> => {
  const value = environment.ENVIRONMENT_NAME;
  if (value === undefined) return ok(undefined);
  const parsed = environmentNameSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new ConfigurationError(ENVIRONMENT_NAME_CONSTRAINT, {
          settings: [
            {
              setting: "ENVIRONMENT_NAME",
              constraint: ENVIRONMENT_NAME_CONSTRAINT,
            },
          ],
        }),
      );
};
