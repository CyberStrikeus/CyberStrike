import { expect, it } from "vitest";
import { createStreamableHttpJebMcpConnection } from "../../../src/jeb/JebMcpConnection.js";
import { startJebMcpFixture } from "../../fixtures/jebMcp.js";

it("retains own structured fields through the JEB SDK transport", async () => {
  const expected = {
    ["__proto__"]: { observed: true },
    success: true,
    nested: [{ ["__proto__"]: "nested fact" }],
  };
  const fixture = await startJebMcpFixture(() => expected);
  const connection = createStreamableHttpJebMcpConnection(
    new URL(fixture.endpoint),
  );
  try {
    await connection.connect();
    const result = await connection.call("get_client_information", {});
    expect(JSON.stringify(result)).toBe(JSON.stringify(expected));
  } finally {
    try {
      await connection.close();
    } finally {
      await fixture.close();
    }
  }
});
