import { Cli } from "incur";

import type { CliInstance } from "./types.js";

type CommandMap = NonNullable<ReturnType<typeof Cli.toCommands.get>>;
type CommandEntry = CommandMap extends Map<string, infer Entry> ? Entry : never;
export type RegisteredCommand = Extract<CommandEntry, { run: unknown }>;
type OutputPolicy = "all" | "agent-only";

// Incur types its router key without vars, env, or globals; accept any CLI.
const registeredCommands: WeakMap<object, CommandMap> = Cli.toCommands;

/** Visit ordinary commands in map order, children before each group's root. */
export const visitRegisteredCommands = (
  cli: CliInstance,
  visit: (
    command: RegisteredCommand,
    path: string,
    outputPolicy: OutputPolicy | undefined,
  ) => void,
): void => {
  const commands = registeredCommands.get(cli);
  if (commands !== undefined) visitCommands(commands, [], undefined, visit);
};

const visitCommands = (
  commands: CommandMap,
  parents: readonly string[],
  inheritedPolicy: OutputPolicy | undefined,
  visit: (
    command: RegisteredCommand,
    path: string,
    outputPolicy: OutputPolicy | undefined,
  ) => void,
): void => {
  for (const [name, entry] of commands) {
    const path = [...parents, name];
    if ("_group" in entry) {
      const policy = entry.outputPolicy ?? inheritedPolicy;
      visitCommands(entry.commands, path, policy, visit);
      if (entry.root !== undefined)
        visit(entry.root, path.join(" "), entry.root.outputPolicy ?? policy);
    } else if (!("_alias" in entry) && !("_fetch" in entry)) {
      visit(entry, path.join(" "), entry.outputPolicy ?? inheritedPolicy);
    }
  }
};
