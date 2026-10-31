export function selectTypeScriptCompiler(
  platform: string,
  arch: string,
  optionalDependencies: Readonly<Record<string, string>>,
): "tsrs" | "typescript";

export function resolveTypeScriptCompiler(): {
  readonly name: "tsrs" | "typescript";
  readonly identity: string;
  readonly launcher: string;
};
