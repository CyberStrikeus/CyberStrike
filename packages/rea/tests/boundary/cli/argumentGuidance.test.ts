import { expect, it } from "vitest";

import { createCli } from "../../../src/cli.js";
import { MAX_SELECTED_LOCALES } from "../../../src/domain/apktool/apktoolResourceAnalysis.js";
import { serveCli } from "./cliServeHarness.js";

it.each([
  ["analyze"],
  ["decompile"],
  ["setup", "--no-client"],
  ["search", "/caller/selected", "needle", "--kind", "unrecognized"],
])(
  "keeps correction fields and concise guidance for invalid CLI arguments: %j",
  async (...argv) => {
    const cli = createCli({});
    let text = "";
    let exit = 0;
    await cli.serve([...argv, "--json"], {
      stdout: (chunk) => {
        text += chunk;
      },
      exit: (code) => {
        exit = code;
      },
      env: {},
    });
    expect(exit).toBe(1);
    const result = JSON.parse(text);
    expect(result).toMatchObject({
      code: "VALIDATION_ERROR",
      message:
        "REA could not read the command arguments. Check the named argument and its expected type, then try again.",
      fieldErrors: expect.any(Array),
    });
    expect(text).not.toContain("Details:");
    for (const field of result.fieldErrors) {
      expect(field).not.toHaveProperty("maximum");
    }
    if (argv[0] === "search")
      expect(result.fieldErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "kind",
            code: "invalid_value",
            missing: false,
            message: expect.stringContaining('"strings"|"procedures"'),
          }),
        ]),
      );
    else if (argv[0] === "setup")
      expect(result.fieldErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "client",
            missing: false,
            expected: "array",
          }),
        ]),
      );
    else
      expect(result.fieldErrors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "path",
            missing: true,
            expected: "string",
          }),
        ]),
      );
  },
);

it("leaves non-ADB over-limit argument errors unchanged", async () => {
  const result = await serveCli([
    "decode-android-resources",
    "/nonexistent/app.apk",
    ...Array.from({ length: MAX_SELECTED_LOCALES + 1 }, () => [
      "--locales",
      "de",
    ]).flat(),
    "--json",
  ]);
  expect(result.exitCode).toBe(1);
  const output = JSON.parse(result.stdout);
  expect(output).toMatchObject({
    code: "VALIDATION_ERROR",
    fieldErrors: [
      expect.objectContaining({ path: "locales", code: "too_big" }),
    ],
  });
  expect(output.fieldErrors[0]).not.toHaveProperty("maximum");
});
