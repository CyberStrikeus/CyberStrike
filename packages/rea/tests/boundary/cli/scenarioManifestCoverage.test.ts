import { Cli } from "incur";
import { expect, it } from "vitest";

import { registerAnalysisViewCommands } from "../../../src/cli/analysisViewCommands.js";
import { sanitizeBrowserUrl } from "../../../src/domain/browserObservation.js";
import { browserScenarioCaptureSchema } from "../../../src/domain/browserScenarioCapture.js";
import { silentLogger } from "../../../src/logger.js";
import {
  scenarioCaptureEvidence,
  scenarioCaptureFixture,
} from "../../fixtures/browserScenarioCapture.js";

const unusableUrls = [
  "data:text/plain,no-origin",
  "file:///public/example.txt",
  "blob:https://example.test/resource",
  "not a url",
  "https:example.test/api/items",
];

const manifest = async (
  urls: readonly string[],
  body: "absent" | "redacted",
) => {
  const original = scenarioCaptureFixture(
    urls.map(() => ({
      method: "GET",
      url: "/api/items",
      ...(body === "absent"
        ? {}
        : {
            status: 200,
            mediaType: "application/json",
            body: '{"token":"[REDACTED:token]"}',
          }),
    })),
  );
  let request = 0;
  const capture = browserScenarioCaptureSchema.parse({
    ...original,
    events: {
      ...original.events,
      items: original.events.items.map((event) => {
        if (event.kind === "request")
          return { ...event, url: sanitizeBrowserUrl(urls[request++]!) };
        if (event.kind === "network-content" && event.body.state === "captured")
          return { ...event, body: { ...event.body, redacted: true } };
        return event;
      }),
    },
  });
  const cli = Cli.create("scenario-coverage", { sync: false });
  registerAnalysisViewCommands(cli, silentLogger);
  let stdout = "";
  let exitCode = 0;
  await cli.serve(
    [
      "inspect-analysis-view",
      JSON.stringify({
        source: { kind: "inline", evidence: scenarioCaptureEvidence(capture) },
        view: { kind: "environment-manifest" },
      }),
      "--json",
    ],
    {
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      exit: (code) => {
        exitCode = code;
      },
    },
  );
  expect(exitCode).toBe(0);
  return (
    JSON.parse(stdout) as {
      normalized_result: {
        records: { ordinal: number }[];
        limitations: string[];
      };
    }
  ).normalized_result;
};

it.each(
  unusableUrls.flatMap((url) =>
    (["absent", "redacted"] as const).map((body) => ({ url, body })),
  ),
)(
  "excludes $url from scenario $body body-retention coverage through the CLI handler",
  async ({ url, body }) => {
    const result = await manifest([url], body);
    expect(result.records).toEqual([]);
    expect(result.limitations).toContain(
      "1 retained records without a usable request line are not represented in the manifest.",
    );
    expect(
      result.limitations.filter((limitation) =>
        limitation.includes("scenario transactions with a usable request line"),
      ),
    ).toEqual([]);
  },
);

it.each(["absent", "redacted"] as const)(
  "counts only the admitted request in mixed scenario %s body-retention coverage",
  async (body) => {
    const urls = [...unusableUrls, "https://example.test/api/control"];
    const result = await manifest(urls, body);
    expect(result.records.map((record) => record.ordinal)).toEqual([
      unusableUrls.length,
    ]);
    expect(result.limitations).toContain(
      `${String(unusableUrls.length)} retained records without a usable request line are not represented in the manifest.`,
    );
    expect(
      result.limitations.filter((limitation) =>
        limitation.includes("scenario transactions with a usable request line"),
      ),
    ).toEqual([
      body === "absent"
        ? "1 of 1 scenario transactions with a usable request line retained no response body; tools citing them replay only the recorded status and content type, either of which may be absent."
        : "1 of 1 scenario transactions with a usable request line retained a response body with declared secret values replaced by redaction markers; tools citing them replay the redacted bytes.",
    ]);
  },
);

it("does not derive a tool from conflicting header-only MIME evidence through the CLI handler", async () => {
  for (const values of [
    ["application/json", "application/octet-stream"],
    ["application/octet-stream", "application/json"],
    ["application/json", null],
    ["application/json", "application/json"],
  ]) {
    const capture = scenarioCaptureFixture([
      {
        method: "GET",
        url: "/download",
        status: 200,
        responseHeaders: values.map((value) => ({
          name: "Content-Type",
          value,
        })),
      },
    ]);
    const cli = Cli.create("scenario-mime", { sync: false });
    registerAnalysisViewCommands(cli, silentLogger);
    let stdout = "";
    let exitCode = 0;
    await cli.serve(
      [
        "inspect-analysis-view",
        JSON.stringify({
          source: {
            kind: "inline",
            evidence: scenarioCaptureEvidence(capture),
          },
          view: { kind: "environment-manifest" },
        }),
        "--json",
      ],
      {
        env: {},
        stdout: (text) => {
          stdout += text;
        },
        exit: (code) => {
          exitCode = code;
        },
      },
    );
    expect(exitCode, stdout).toBe(0);
    const result = (
      JSON.parse(stdout) as {
        normalized_result: { tools: unknown[] };
      }
    ).normalized_result;
    expect(result.tools, JSON.stringify(values)).toHaveLength(
      values.every((value) => value === "application/json") ? 1 : 0,
    );
  }
});
