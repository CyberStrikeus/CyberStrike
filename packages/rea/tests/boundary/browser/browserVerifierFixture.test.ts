import { createConnection } from "node:net";
import { it, expect } from "vitest";
import { startBrowserVerifierSite } from "../../../scripts/fixtures/browser-verifier-site.mjs";

it("closes an accepted HTTP socket that has not sent request headers", async () => {
  const site = await startBrowserVerifierSite();
  const { port } = new URL(site.origin);
  const socket = createConnection(Number(port), "127.0.0.1");
  let close: Promise<void> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const closing = site.close();
    close = closing;
    const closedBeforeDeadline = await Promise.race([
      closing.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), 1_000);
      }),
    ]);
    expect(closedBeforeDeadline).toBe(true);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    socket.destroy();
    await (close ?? site.close());
  }
});
