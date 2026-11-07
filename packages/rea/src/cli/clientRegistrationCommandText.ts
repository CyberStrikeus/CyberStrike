/** Incur takes a command string and splits quoted segments without backslash escapes. */
export const clientRegistrationCommandText = (
  command: readonly string[],
): string =>
  command.map((argument) => `'${argument.replaceAll("'", `'"'"'`)}'`).join(" ");
