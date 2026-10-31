import { Errors } from "incur";
import { z } from "zod";

import { projectInputIssues } from "../domain/inputIssueProjection.js";
import type { CliInstance } from "./types.js";
import { visitRegisteredCommands } from "./visitRegisteredCommands.js";

const ARGUMENT_GUIDANCE =
  "REA could not read the command arguments. Check the named argument and its expected type, then try again.";

const adbPackageCommands = new Set([
  "pull-adb-package",
  "inspect-adb-package",
  "uninstall-adb-package",
  "start-adb-app",
  "stop-adb-app",
]);

const isAdbSelector = (command: string, field: string): boolean =>
  (command.includes("-adb-") && field === "serial") ||
  (adbPackageCommands.has(command) && field === "package") ||
  (command === "start-adb-activity" &&
    ["action", "component", "data-uri"].includes(field));

/** Preserve parser correction fields without embedding its serialized cause. */
export const presentCliArgumentErrors = (cli: CliInstance): void => {
  visitRegisteredCommands(cli, (command, path) => {
    command.middleware = [
      async (_context, next) => {
        try {
          await next();
        } catch (cause: unknown) {
          if (!(cause instanceof Errors.ValidationError)) throw cause;
          const failure = new Errors.ValidationError({
            message: ARGUMENT_GUIDANCE,
            fieldErrors: adbSelectorConstraints(path, cause),
          });
          // Incur's constructor appends cause.message as display details. Keep
          // the original error separately, without copying it into the message.
          Object.defineProperty(failure, "cause", { value: cause });
          throw failure;
        }
      },
      ...(command.middleware ?? []),
    ];
  });
};

/** Retain safe selector constraints dropped by Incur's parser projection. */
const adbSelectorConstraints = (
  command: string,
  error: Errors.ValidationError,
): Errors.FieldError[] => {
  if (!command.includes("-adb-") || !(error.cause instanceof z.ZodError))
    return error.fieldErrors;
  return error.fieldErrors.map((field, index) => {
    const issue =
      error.cause instanceof z.ZodError ? error.cause.issues[index] : undefined;
    if (
      issue === undefined ||
      issue.path.length !== 1 ||
      issue.path[0] !== field.path ||
      issue.code !== field.code ||
      !isAdbSelector(command, field.path) ||
      (issue.code !== "too_big" && issue.code !== "invalid_format")
    )
      return field;
    const projected = projectInputIssues([issue], undefined)[0];
    if (projected?.maximum !== undefined)
      return { ...field, maximum: projected.maximum };
    if (projected?.expected === "regex") return { ...field, expected: "regex" };
    return field;
  });
};
