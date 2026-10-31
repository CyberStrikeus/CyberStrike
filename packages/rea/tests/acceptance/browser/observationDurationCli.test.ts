import { expect } from "vitest";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "rejects empty observation selections before connecting to a browser",
  async ({ cli }) => {
    for (const selection of [["--observation-ms="], ["--observation-ms", ""]]) {
      const result = await cli.run({
        arguments: [
          "inspect-web-page",
          "http://127.0.0.1:9",
          "page",
          ...selection,
          "--json",
        ],
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "VALIDATION_ERROR",
        fieldErrors: expect.arrayContaining([
          expect.objectContaining({ path: "observationMs" }),
        ]),
      });
    }
  },
);

cliTest(
  "preserves the default capture window and explicit zero through CDP",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser();
    try {
      for (const [selection, expected] of [
        [[], 500],
        [["--observation-ms=0"], 0],
      ] as const) {
        const result = await cli.run({
          arguments: [
            "inspect-web-page",
            browser.endpoint,
            "allowed-page",
            ...selection,
            "--json",
          ],
        });
        expect(result.exitCode, result.stderr).toBe(0);
        expect(result.json).toMatchObject({
          normalized_result: { capture_window: { observation_ms: expected } },
        });
      }
    } finally {
      await browser.close();
    }
  },
);

cliTest(
  "advertises the lexical guard after SDK conversion",
  async ({ cli }) => {
    const result = await cli.run({
      arguments: ["inspect-web-page", "--schema", "--json"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.json).toMatchObject({
      options: {
        properties: {
          observationMs: {
            default: 500,
            anyOf: [
              { type: "integer", minimum: 0 },
              { type: "string", pattern: "\\S" },
            ],
          },
        },
      },
    });
  },
);
