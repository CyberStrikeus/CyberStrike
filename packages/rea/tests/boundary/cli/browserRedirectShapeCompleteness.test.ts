import { afterEach, expect } from "vitest";

import { cliTest } from "../../support/cli/cliFixture.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
} from "../../fixtures/fakeCdpBrowser.js";

const browsers: FakeCdpBrowser[] = [];

afterEach(async () => {
  await Promise.all(browsers.splice(0).map(async (browser) => browser.close()));
});

cliTest(
  "reports missing JSON shapes only when body shapes are selected",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser({
      malformedRedirectResponse: true,
      redirectResponseEnvelope: null,
    });
    browsers.push(browser);
    const commonArgs = [
      "inspect-web-page",
      browser.endpoint,
      "allowed-page",
      "--allowed-origins",
      browser.allowedOrigin,
      "--observation-ms",
      "0",
    ];
    const selectedInvocation = await cli.run({
      arguments: [...commonArgs, "--include-json-body-shapes", "--json"],
      environment: process.env,
    });
    expect(selectedInvocation.exitCode, selectedInvocation.stderr).toBe(0);
    expect(selectedInvocation.signal).toBeNull();
    const selected = normalizedResult(selectedInvocation.json);
    expect(selected).toMatchObject({
      network: {
        requests: [
          {
            body_shapes: {
              status: "partial",
              request: expect.any(Object),
              response: null,
            },
          },
        ],
      },
      completeness: {
        unavailable_sections: expect.arrayContaining([
          "network_requests",
          "json_body_shapes",
        ]),
        excluded: expect.arrayContaining([
          {
            section: "json_body_shapes",
            reason: "invalid_protocol_value",
            count: expect.any(Number),
          },
        ]),
      },
    });

    const defaultedInvocation = await cli.run({
      arguments: [...commonArgs, "--json"],
      environment: process.env,
    });
    expect(defaultedInvocation.exitCode, defaultedInvocation.stderr).toBe(0);
    expect(defaultedInvocation.signal).toBeNull();
    const defaulted = normalizedResult(defaultedInvocation.json);
    expect(defaulted).toMatchObject({
      network: {
        requests: [
          {
            body_shapes: {
              status: "not_approved",
              request: null,
              response: null,
            },
          },
        ],
      },
    });
    expect(defaulted.completeness).toMatchObject({
      unavailable_sections: expect.not.arrayContaining(["json_body_shapes"]),
    });
  },
);

const normalizedResult = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value) || !isRecord(value.normalized_result))
    throw new TypeError("Missing CLI normalized result");
  return value.normalized_result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
