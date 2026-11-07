import { afterEach } from "vitest";

import type {
  FakeCdpBrowser,
  FakeOptions,
} from "../../fixtures/fakeCdpBrowser.js";

const browsers: FakeCdpBrowser[] = [];

afterEach(async () => {
  await Promise.all(browsers.splice(0).map(async (browser) => browser.close()));
});

export const trackBrowser = (browser: FakeCdpBrowser): void => {
  browsers.push(browser);
};

export const frameNavigated = (
  command: Parameters<NonNullable<FakeOptions["commandEvents"]>>[0],
  frame: unknown,
) => ({
  method: "Page.frameNavigated",
  ...(command.sessionId === undefined ? {} : { sessionId: command.sessionId }),
  params: { frame },
});

export const waitFor = async (ready: () => boolean, description: string) => {
  const deadline = Date.now() + 5_000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(description);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
