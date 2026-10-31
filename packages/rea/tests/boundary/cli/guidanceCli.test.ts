import { afterAll, expect, it } from "vitest";
import { createCli, closeCliResources } from "../../../src/cli.js";

afterAll(async () => closeCliResources());

const run = async (arguments_: string[]) => {
  const cli = createCli({});
  let stdout = "";
  let exitCode = 0;
  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await cli.serve([...arguments_, "--json"], {
      env: {},
      exit: (code) => {
        exitCode = code;
      },
      stdout: (chunk) => {
        stdout += chunk;
      },
    });
    return { exitCode: process.exitCode || exitCode, stdout };
  } finally {
    process.exitCode = previousExitCode ?? 0;
  }
};

it("searches and reads packaged guidance through the provider-free CLI", async () => {
  const found = await run(["guidance", "--query", "exact JavaScript module"]);
  expect(found.exitCode, found.stdout).toBe(0);
  const search = JSON.parse(found.stdout) as {
    readonly status: string;
    readonly matches: readonly {
      readonly heading: string;
      readonly locator: string;
    }[];
  };
  expect(search.status).toBe("matches");
  const selected = search.matches.find(
    ({ heading }) => heading === "Read a module without repeating analysis",
  );
  expect(selected).toBeDefined();
  const read = await run([
    "guidance",
    "--action",
    "read",
    "--locator",
    selected?.locator ?? "",
  ]);
  expect(read.exitCode, read.stdout).toBe(0);
  expect(JSON.parse(read.stdout)).toMatchObject({
    status: "section",
    heading: selected?.heading,
    locator: selected?.locator,
    source: "installed_rea_guidance",
  });
  const ignoredLimit = await run([
    "guidance",
    "--action",
    "read",
    "--locator",
    selected?.locator ?? "",
    "--limit",
    "2",
  ]);
  expect(ignoredLimit.exitCode).not.toBe(0);
});

it("reports no matches and rejects invalid CLI inputs", async () => {
  const absent = await run(["guidance", "--query", "qzxv"]);
  expect(absent.exitCode).toBe(0);
  expect(JSON.parse(absent.stdout)).toMatchObject({
    status: "no_matches",
    total_matches: 0,
  });
  const empty = await run(["guidance", "--query", "   "]);
  expect(empty.exitCode).not.toBe(0);
  const malformed = await run([
    "guidance",
    "--action",
    "read",
    "--locator",
    "../guide.md",
  ]);
  expect(malformed.exitCode).not.toBe(0);
  expect(malformed.stdout).toContain("locator");
  const incompatible = await run([
    "guidance",
    "--action",
    "read",
    "--locator",
    "looks-like-a-locator",
    "--query",
    "module",
  ]);
  expect(incompatible.exitCode).not.toBe(0);
});

it("continues a CLI search with a query- and bundle-bound cursor", async () => {
  const first = await run(["guidance", "--query", "module", "--limit", "1"]);
  expect(first.exitCode, first.stdout).toBe(0);
  const firstPage = JSON.parse(first.stdout) as {
    readonly next_cursor?: string;
    readonly matches: readonly { readonly locator: string }[];
  };
  expect(firstPage.next_cursor).toBeDefined();
  const next = await run([
    "guidance",
    "--query",
    "module",
    "--limit",
    "1",
    "--cursor",
    firstPage.next_cursor ?? "",
  ]);
  expect(next.exitCode, next.stdout).toBe(0);
  const nextPage = JSON.parse(next.stdout) as {
    readonly matches: readonly { readonly locator: string }[];
  };
  expect(firstPage.matches[0]?.locator).toEqual(expect.any(String));
  expect(nextPage.matches[0]?.locator).toEqual(expect.any(String));
  expect(nextPage.matches[0]?.locator).not.toBe(firstPage.matches[0]?.locator);
  const wrongQuery = await run([
    "guidance",
    "--query",
    "different",
    "--cursor",
    firstPage.next_cursor ?? "",
  ]);
  expect(wrongQuery.exitCode).not.toBe(0);
});
