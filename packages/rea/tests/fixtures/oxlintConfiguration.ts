import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const configurationSchema = z.looseObject({
  jsPlugins: z
    .array(z.union([z.string(), z.looseObject({ specifier: z.string() })]))
    .optional(),
});

/** Preserve repository lint policy while resolving local plugins at their owner. */
export const writeRepositoryOxlintConfiguration = async (
  project: string,
): Promise<string> => {
  const configuration = configurationSchema.parse(
    JSON.parse(await readFile(join(repository, ".oxlintrc.json"), "utf8")),
  );
  const rebase = (specifier: string): string =>
    specifier.startsWith(".") ? resolve(repository, specifier) : specifier;
  const path = join(project, ".oxlintrc.json");
  await writeFile(
    path,
    JSON.stringify({
      ...configuration,
      ...(configuration.jsPlugins === undefined
        ? {}
        : {
            jsPlugins: configuration.jsPlugins.map((plugin) =>
              typeof plugin === "string"
                ? rebase(plugin)
                : { ...plugin, specifier: rebase(plugin.specifier) },
            ),
          }),
    }),
  );
  return path;
};
