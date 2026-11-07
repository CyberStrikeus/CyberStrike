import { parse } from "@babel/parser";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Reduce filesystem resolution during CLI and MCP startup. Keep dependencies
 * external, dynamic imports lazy, and original compiled worker entrypoints.
 */
export const bundleRuntime = async (root) => {
  const compiledRoot = resolve(root, "dist");
  // CLI, MCP, workers and updater fixtures share one release-identity owner.
  const metadataModule = join(compiledRoot, "generatedPackageMetadata.js");
  const isMetadataModule = (id) =>
    isAbsolute(id) && resolve(id) === metadataModule;
  const { rolldown, RUNTIME_MODULE_ID } = await import("rolldown");
  const { imports = {} } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  for (const [directory, entries] of [
    ["mcp", { main: "main.js" }],
    [
      "cli-runtime",
      {
        cli: "cli.js",
        cliOutput: "cliOutput.js",
        cliBuiltinArguments: "cliBuiltinArguments.js",
        cliResultOutput: "cli/cliResultOutput.js",
        mcpDoctor: "mcpDoctor.js",
      },
    ],
  ]) {
    const bundle = await rolldown({
      input: Object.fromEntries(
        Object.entries(entries).map(([name, path]) => [
          name,
          join(compiledRoot, path),
        ]),
      ),
      platform: "node",
      treeshake: false,
      external: (source) =>
        isMetadataModule(source) ||
        (!source.startsWith(".") && !isAbsolute(source)),
      plugins: [
        {
          name: "preserve-compiled-module-locations",
          transform(code, id) {
            if (id === RUNTIME_MODULE_ID) return null;
            if (!code.includes("import.meta")) return null;
            const sourcePath = relative(compiledRoot, id);
            if (
              isAbsolute(sourcePath) ||
              sourcePath === ".." ||
              sourcePath.startsWith(`..${sep}`)
            )
              throw new Error(`Runtime bundle input is outside dist: ${id}`);
            // Each output directory is directly under dist. Preserve the original
            // module URL, including URL escaping, for bridges and createRequire.
            const moduleUrl = `new URL(${JSON.stringify(`../${sourcePath.split(sep).map(encodeURIComponent).join("/")}`)}, import.meta.url).href`;
            const edits = [];
            const visit = (node) => {
              if (node === null || typeof node !== "object") return;
              const isMeta = (value) =>
                value?.type === "MetaProperty" &&
                value.meta.name === "import" &&
                value.property.name === "meta";
              if (
                node.type === "CallExpression" &&
                node.callee.type === "MemberExpression" &&
                !node.callee.computed &&
                isMeta(node.callee.object) &&
                node.callee.property.name === "resolve" &&
                node.arguments.length === 1 &&
                node.arguments[0].type === "StringLiteral" &&
                Object.hasOwn(imports, node.arguments[0].value)
              )
                // Package imports resolve in the same package scope after bundling.
                return;
              if (
                node.type === "MemberExpression" &&
                !node.computed &&
                isMeta(node.object) &&
                node.property.name === "url"
              ) {
                edits.push({ start: node.start, end: node.end });
                return;
              }
              if (isMeta(node))
                throw new Error(
                  `Unsupported import.meta use in runtime bundle: ${id}`,
                );
              for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else visit(value);
              }
            };
            visit(parse(code, { sourceType: "module" }).program);
            for (const { start, end } of edits.sort(
              (a, b) => b.start - a.start,
            ))
              code = code.slice(0, start) + moduleUrl + code.slice(end);
            return { code, map: null };
          },
        },
      ],
    });
    try {
      await bundle.write({
        dir: join(compiledRoot, directory),
        format: "esm",
        entryFileNames: "[name].js",
        chunkFileNames:
          directory === "mcp"
            ? "[name]-[hash].js"
            : (chunk) => {
                // Keep lazy facades distinguishable when source basenames repeat.
                if (typeof chunk.facadeModuleId !== "string")
                  return "[name]-[hash].js";
                const path = relative(compiledRoot, chunk.facadeModuleId);
                return `${path.replace(/\.js$/u, "").split(sep).join("__")}-[hash].js`;
              },
        paths: (id) =>
          isMetadataModule(id) ? "../generatedPackageMetadata.js" : id,
        minifyInternalExports: directory === "mcp",
        codeSplitting: true,
        strictExecutionOrder: true,
        minify: false,
        sourcemap: false,
      });
    } finally {
      await bundle.close();
    }
  }
};

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await bundleRuntime(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
