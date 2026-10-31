import { Cli } from "incur";
import { z } from "zod";

/** Read primary names and aliases from the actual Incur command router. */
export const createCliInventory = (cli) => {
  const commands = Cli.toCommands.get(cli);
  if (commands === undefined)
    throw new Error("Incur did not expose the registered REA CLI commands");
  const primary = [];
  const aliases = [];
  for (const [name, entry] of commands) {
    if ("_alias" in entry) aliases.push({ name, target: entry.target });
    else primary.push(name);
  }
  if (primary.length === 0)
    throw new Error("Incur exposed no primary REA CLI commands");
  return {
    primary: primary.sort((left, right) => left.localeCompare(right)),
    aliases: aliases.sort((left, right) => left.name.localeCompare(right.name)),
  };
};

/** Read one primary command's declared option names from the Incur router. */
export const cliCommandOptionNames = (cli, name) => {
  const commands = Cli.toCommands.get(cli);
  const command = commands?.get(name);
  if (
    command === undefined ||
    "_alias" in command ||
    !("options" in command) ||
    command.options === undefined
  )
    return [];
  const schema = z.toJSONSchema(command.options);
  return Object.keys(schema.properties ?? {}).sort((left, right) =>
    left.localeCompare(right),
  );
};

/** Report primary CLI fields whose generated JSON Schema lacks help text. */
export const cliCommandDescriptionIssues = (cli) => {
  const commands = Cli.toCommands.get(cli);
  if (commands === undefined)
    throw new Error("Incur did not expose the registered REA CLI commands");
  const missing = [];
  for (const [commandName, command] of commands) {
    if ("_alias" in command) continue;
    for (const groupName of ["args", "options"]) {
      if (!(groupName in command) || command[groupName] === undefined) continue;
      const properties = z.toJSONSchema(command[groupName]).properties ?? {};
      for (const [propertyName, property] of Object.entries(properties)) {
        if (
          typeof property !== "object" ||
          property === null ||
          typeof property.description !== "string" ||
          property.description.trim() === ""
        )
          missing.push(`${commandName}.${groupName}.${propertyName}`);
      }
    }
  }
  return missing;
};
