import { expect, it } from "vitest";

import { createOpenAiModelFixture } from "../../../scripts/verify/clients/model-fixture.mjs";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("routes OpenAI fixture requests by pathname, not query", async () => {
  const directory = await createTestTempDirectory("rea-model-fixture-");
  let calls = 0;
  const fixture = await createOpenAiModelFixture({
    directory,
    prefix: "probe",
    onRequest: () => {
      calls += 1;
      return { role: "assistant", content: "ok" };
    },
  });
  try {
    const statusOf = async (path: string, method = "POST") =>
      (
        await fetch(`${fixture.baseUrl}${path}`, {
          method,
          ...(method === "POST"
            ? {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  model: "rea-client-fixture",
                  messages: [{ role: "user", content: "hi" }],
                }),
              }
            : {}),
        })
      ).status;

    expect([
      await statusOf("/chat/completions"),
      await statusOf("/chat/completions?api-version=1"),
      await statusOf("/completions"),
      await statusOf("/models?limit=1", "GET"),
    ]).toEqual([200, 200, 404, 200]);
    expect(calls).toBe(2);
    expect(fixture.requests.map(({ path }) => path)).toEqual([
      "/v1/chat/completions",
      "/v1/chat/completions?api-version=1",
    ]);
    expect(fixture.probes).toEqual([
      expect.objectContaining({ path: "/v1/completions", status: 404 }),
    ]);
    expect(fixture.failure).toBeUndefined();
  } finally {
    await fixture.close();
  }
});
