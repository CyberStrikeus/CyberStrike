import { EventEmitter } from "node:events";
import { expect, it } from "vitest";
import {
  withCommandCancellation,
  type CommandCancellationHost,
} from "../../../src/cli/commandCancellation.js";

it.each([
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const)(
  "awaits cleanup after %s and removes its listeners",
  async (event, expectedExit) => {
    const events = new EventEmitter();
    const host: CommandCancellationHost = {
      on: events.on.bind(events),
      off: events.off.bind(events),
    };
    let cleaned = false;
    const operation = withCommandCancellation(async (signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      cleaned = true;
      return "cancelled after cleanup";
    }, host);
    expect(host.exitCode).toBeUndefined();
    events.emit(event);
    expect(await operation).toBe("cancelled after cleanup");
    expect(cleaned).toBe(true);
    expect(host.exitCode).toBe(expectedExit);
    expect(events.listenerCount("SIGINT")).toBe(0);
    expect(events.listenerCount("SIGTERM")).toBe(0);
  },
);

it("leaves the exit code alone on success and removes listeners when execution throws", async () => {
  const events = new EventEmitter();
  const host: CommandCancellationHost = {
    on: events.on.bind(events),
    off: events.off.bind(events),
    exitCode: 0,
  };
  expect(await withCommandCancellation(async () => "success", host)).toBe(
    "success",
  );
  expect(host.exitCode).toBe(0);
  await expect(
    withCommandCancellation(async () => {
      throw new Error("fixture failure");
    }, host),
  ).rejects.toThrow("fixture failure");
  expect(events.listenerCount("SIGINT")).toBe(0);
  expect(events.listenerCount("SIGTERM")).toBe(0);
});
