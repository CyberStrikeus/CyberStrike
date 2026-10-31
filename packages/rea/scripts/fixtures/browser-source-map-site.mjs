import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";

/** Generate a real compiler map and serve only source-owned fixture code. */
export async function startBrowserSourceMapSite(options = {}) {
  const command = process.env.REA_WEB_SOURCE_MAP_COMPILER;
  if (!command || !isAbsolute(command))
    throw new Error(
      "verify:browser:source-maps requires absolute REA_WEB_SOURCE_MAP_COMPILER pointing to isolated esbuild 0.25.10 lib/main.js",
    );
  await access(command);
  const compiler = await import(pathToFileURL(command).href);
  if (compiler.version !== "0.25.10")
    throw new Error(`Expected esbuild 0.25.10; observed ${compiler.version}`);
  const original =
    '// 🎋 UTF-16 and CRLF fixture\r\nfunction boot(): void {\r\n  const marker: string = "source-map proof";\r\n  document.body.dataset.ready = marker;\r\n}\r\nboot();\r\n';
  const compiled = await compiler
    .transform(original, {
      loader: "ts",
      sourcefile: options.sourcefile ?? "../src/fixture.ts?v=7#original",
      sourcemap: "external",
      minify: true,
      format: "iife",
      target: "es2022",
    })
    .finally(() => compiler.stop());
  const prefixes = options.prefixes ?? [];
  const generated =
    prefixes.join("") +
    compiled.code +
    (options.sourceMapAnnotation
      ? "\n//# sourceMappingURL=/maps/app.js.map"
      : "");
  let indexed = JSON.parse(compiled.map);
  for (const prefix of prefixes.toReversed()) {
    const offset = textPosition(prefix, prefix.length);
    indexed = {
      version: 3,
      sections: [
        {
          offset: { line: offset.line - 1, column: offset.column },
          map: indexed,
        },
      ],
    };
  }
  const map = prefixes.length === 0 ? compiled.map : JSON.stringify(indexed);
  const token = '"source-map proof"';
  const generatedOffset = generated.indexOf(token);
  const originalOffset = original.indexOf(token);
  if (generatedOffset < 0 || originalOffset < 0)
    throw new Error("Compiler fixture marker missing");
  const position = textPosition(generated, generatedOffset);
  const originalPosition = textPosition(original, originalOffset);
  let mapRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/")
      return response
        .writeHead(200, { "Content-Type": "text/html" })
        .end('<body><script src="/app.js?build=7"></script></body>');
    if (request.url === "/app.js?build=7")
      return response
        .writeHead(200, { "Content-Type": "text/javascript" })
        .end(generated);
    if (request.url?.startsWith("/maps/app.js.map")) {
      mapRequests += 1;
      return response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(map);
    }
    response.writeHead(404).end("Unselected");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Source map fixture has no TCP address");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    original,
    generated,
    map,
    leafCode: compiled.code,
    leafMap: compiled.map,
    position,
    originalPosition,
    originalOffset,
    mapRequests: () => mapRequests,
    compiler: { id: "esbuild", version: compiler.version },
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
const textPosition = (text, offset) => {
  const preceding = text.slice(0, offset).split(/\r\n?|\n|\u2028|\u2029/u);
  return { line: preceding.length, column: preceding.at(-1).length };
};
