import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, it } from "vitest";

it("loads the isolated coordinator without loading its worker's JavaScript parser", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import { registerHooks } from "node:module";
        const parser = import.meta.resolve("@babel/parser");
        let parserLoaded = false;
        const hook = registerHooks({
          load(url, context, nextLoad) {
            if (url === parser) parserLoaded = true;
            return nextLoad(url, context);
          },
        });
        const { IsolatedWebBundleAnalyzer } = await import(process.argv[1]);
        hook.deregister();
        process.stdout.write(JSON.stringify({
          coordinatorLoaded: typeof IsolatedWebBundleAnalyzer === "function",
          parserLoaded,
        }));
      `,
      new URL(
        "../../../dist/browser/IsolatedWebBundleAnalyzer.js",
        import.meta.url,
      ).href,
    ],
    { timeout: 10_000 },
  );
  expect(JSON.parse(stdout)).toEqual({
    coordinatorLoaded: true,
    parserLoaded: false,
  });
});
