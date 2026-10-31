export function createCliInventory(cli: unknown): {
  readonly primary: readonly string[];
  readonly aliases: readonly {
    readonly name: string;
    readonly target: string;
  }[];
};
export function cliCommandOptionNames(
  cli: unknown,
  name: string,
): readonly string[];
export function cliCommandDescriptionIssues(cli: unknown): readonly string[];
