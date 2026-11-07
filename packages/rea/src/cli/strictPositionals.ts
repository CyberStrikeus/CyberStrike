import { AsyncLocalStorage } from "node:async_hooks";

import { Errors, Parser, z } from "incur";

import { splitIncurBuiltinArguments } from "../cliBuiltinArguments.js";
import type { CliInstance } from "./types.js";
import { visitRegisteredCommands } from "./visitRegisteredCommands.js";

type ServeOptions = NonNullable<Parameters<CliInstance["serve"]>[1]>;

/** Match the wrapper types the pinned Incur parser unwraps for token binding. */
const tokenType = (field: z.ZodType): z.ZodType => {
  let inner = field;
  while ("innerType" in inner.def) {
    const candidate = inner.def.innerType;
    if (!(candidate instanceof z.ZodType)) break;
    inner = candidate;
  }
  return inner;
};

/** Preserve flag consumption without evaluating command defaults or transforms. */
const optionTokenShape = (schema: z.ZodObject): z.ZodObject =>
  z.object(
    Object.fromEntries(
      Object.entries(schema.shape).map(([name, field]) => {
        const inner = tokenType(field);
        const token =
          inner instanceof z.ZodBoolean
            ? z.boolean().optional()
            : inner instanceof z.ZodArray
              ? z.array(z.unknown()).optional()
              : z.unknown().optional();
        return [
          name,
          field.meta()?.count === true ? token.meta({ count: true }) : token,
        ];
      }),
    ),
  );

/**
 * Incur 0.6.1 drops unbound positionals. Its public parser owns token binding,
 * but provides neither a strict-count option nor raw argv in middleware.
 * Capture its unbound tail with inert schemas, before the real command parse.
 * The original schemas still own validation, transforms, defaults and catalog.
 */
export const rejectSurplusCliArguments = (
  cli: CliInstance,
): ((
  arguments_: readonly string[],
  options: ServeOptions,
  serve: (arguments_: string[], options: ServeOptions) => Promise<void>,
) => Promise<void>) => {
  const invocation = new AsyncLocalStorage<readonly string[]>();
  visitRegisteredCommands(cli, (command) => {
    const fields =
      command.args instanceof z.ZodObject ? command.args.shape : {};
    const entries = Object.entries(fields);
    // A declared final array already consumes every remaining positional.
    const final = entries.at(-1)?.[1];
    if (final !== undefined && tokenType(final) instanceof z.ZodArray) return;
    let tail = "__rea_unbound_positionals";
    while (Object.hasOwn(fields, tail)) tail += "_";
    const optionsSchema =
      command.options instanceof z.ZodObject ? command.options : undefined;
    command.middleware = [
      async (context, next) => {
        const tokens = invocation.getStore();
        if (tokens !== undefined) {
          // Only the resolved command needs an inert token-binding schema.
          // Keep the original schema references, but do not prepare every
          // registered command for each one-shot invocation.
          const args = z.object({
            ...Object.fromEntries(
              entries.map(([name]) => [name, z.unknown().optional()]),
            ),
            [tail]: z.array(z.string()).optional(),
          });
          const options =
            optionsSchema === undefined
              ? undefined
              : optionTokenShape(optionsSchema);
          // Incur supplies the invoked path, including aliases, after resolving
          // groups. No second router decides which command receives the tokens.
          const parsed = Parser.parse(
            tokens.slice(context.command.split(" ").length),
            {
              args,
              options,
              alias: command.alias as Record<string, string> | undefined,
            },
          );
          const surplus: unknown = parsed.args[tail];
          if (Array.isArray(surplus) && surplus.length > 0)
            throw new Errors.ParseError({
              message: `Unexpected positional arguments: ${surplus.map((value) => JSON.stringify(value)).join(" ")}. Use '${context.displayName} ${context.command} --help' for the declared argument shape.`,
            });
        }
        await next();
      },
      ...(command.middleware ?? []),
    ];
  });
  return (arguments_, options, serve) =>
    invocation.run(splitIncurBuiltinArguments(arguments_).command, () =>
      serve([...arguments_], options),
    );
};
