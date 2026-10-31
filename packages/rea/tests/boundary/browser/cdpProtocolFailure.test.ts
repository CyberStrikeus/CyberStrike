import { expect, it, onTestFinished } from "vitest";
import { CdpConnection } from "../../../src/browser/CdpConnection.js";
import type { BrowserObservationError } from "../../../src/domain/browserObservationError.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";

it("reports one fatal wire failure without a pending command and retains it for late subscribers", async () => {
  const browser = await startFakeCdpBrowser();
  onTestFinished(() => browser.close());
  const connection = await CdpConnection.connect(
    browser.browserWebSocketUrl,
    "observe_web_execution",
  );
  onTestFinished(() => connection.close());
  const failures: BrowserObservationError[] = [];
  const failure = new Promise<BrowserObservationError>((resolve) => {
    connection.onProtocolFailure((error) => {
      failures.push(error);
      resolve(error);
    });
  });
  browser.emitRawMessage("{not-json");
  browser.emitRawMessage(JSON.stringify({ method: 42 }));
  expect(await failure).toMatchObject({ reason: "protocol_error" });
  let lateFailure: BrowserObservationError | undefined;
  connection.onProtocolFailure((error) => {
    lateFailure = error;
  });
  expect(lateFailure).toMatchObject({ reason: "protocol_error" });
  await expect(connection.send("Page.getFrameTree")).rejects.toMatchObject({
    reason: "protocol_error",
  });
  expect(failures).toHaveLength(1);
  expect(browser.commands).toEqual([]);
});
