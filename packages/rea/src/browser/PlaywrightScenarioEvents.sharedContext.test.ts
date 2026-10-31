import { EventEmitter } from "node:events";
import type { Page } from "playwright-core";
import { expect, it } from "vitest";

import { browserScenarioSchema } from "../domain/browserScenario.js";
import { resolveScenarioSecrets } from "../../tests/fixtures/browserScenarioSecrets.js";
import { PlaywrightScenarioEvents } from "./PlaywrightScenarioEvents.js";

it("reports opaque request redirects as a network coverage gap only when network was selected", () => {
  const page = new EventEmitter() as unknown as Page;
  const context = new EventEmitter();
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
  });
  const secrets = resolveScenarioSecrets(scenario, {});
  const create = (enabled: Set<"network">) =>
    new PlaywrightScenarioEvents({
      page,
      context: context as never,
      ownsContext: true,
      enabled,
      secrets,
    });
  const network = create(new Set(["network"]));
  const none = create(new Set());
  expect(network.limitations()).toEqual([]);
  network.opaqueRequestRedirect();
  none.opaqueRequestRedirect();
  expect(network.limitations()).toEqual([
    expect.stringContaining("response status and Location may be unavailable"),
  ]);
  expect(none.limitations()).toEqual([]);
});

it("omits a request without a frame in a shared context", () => {
  const context = new EventEmitter();
  const page = new EventEmitter() as unknown as Page;
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
    capture: { events: ["network"] },
  });
  const secrets = resolveScenarioSecrets(scenario, {});
  const events = new PlaywrightScenarioEvents({
    page,
    context: context as never,
    ownsContext: false,
    enabled: new Set(["network"]),
    secrets,
  });
  const unknownRequest = {
    frame: () => {
      throw new Error("Frame for this navigation request is unavailable");
    },
    url: () => "https://unrelated.example.test/private",
  };
  context.emit("request", unknownRequest);
  expect(events.result().items).toEqual([]);
  const limitations = events.limitations().join("\n");
  expect(limitations).toContain("Shared-context network capture");
  expect(limitations).toContain("excludes requests");
  expect(limitations).toContain("without a known root or descendant");
});

it("detaches root and popup listeners when a scenario finishes", async () => {
  const context = new EventEmitter();
  const page = new EventEmitter() as unknown as Page;
  const popup = Object.assign(new EventEmitter(), {
    url: () => "https://app.example.test/popup",
  });
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
    capture: { events: ["console", "popups"] },
  });
  const secrets = resolveScenarioSecrets(scenario, {});
  const events = new PlaywrightScenarioEvents({
    page,
    context: context as never,
    ownsContext: false,
    enabled: new Set(["console", "popups"]),
    secrets,
  });
  (page as unknown as EventEmitter).emit("popup", popup);
  expect((page as unknown as EventEmitter).listenerCount("console")).toBe(1);
  expect(popup.listenerCount("console")).toBe(1);
  // Popup closure is recorded, then its page-owned listeners are released.
  expect(popup.listenerCount("close")).toBe(2);
  await events.finish();
  expect((page as unknown as EventEmitter).listenerCount("console")).toBe(0);
  expect((page as unknown as EventEmitter).listenerCount("popup")).toBe(0);
  expect(popup.listenerCount("console")).toBe(0);
  expect(popup.listenerCount("popup")).toBe(0);
  expect(popup.listenerCount("close")).toBe(0);
});

it("detaches worker and websocket listeners when a scenario finishes", async () => {
  const context = new EventEmitter();
  const page = new EventEmitter() as unknown as Page;
  const socket = Object.assign(new EventEmitter(), {
    url: () => "wss://app.example.test/socket",
  });
  const worker = Object.assign(new EventEmitter(), {
    url: () => "https://app.example.test/worker.js",
  });
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
    capture: { events: ["websockets", "workers"] },
  });
  const secrets = resolveScenarioSecrets(scenario, {});
  const events = new PlaywrightScenarioEvents({
    page,
    context: context as never,
    ownsContext: false,
    enabled: new Set(["websockets", "workers"]),
    secrets,
  });
  (page as unknown as EventEmitter).emit("websocket", socket);
  (page as unknown as EventEmitter).emit("worker", worker);
  expect(socket.listenerCount("framesent")).toBe(1);
  expect(worker.listenerCount("close")).toBe(1);
  await events.finish();
  expect(socket.listenerCount("framesent")).toBe(0);
  expect(socket.listenerCount("framereceived")).toBe(0);
  expect(socket.listenerCount("close")).toBe(0);
  expect(worker.listenerCount("close")).toBe(0);
});

it("detaches owned-context popup discovery when a scenario finishes", async () => {
  const context = new EventEmitter();
  const page = new EventEmitter() as unknown as Page;
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
    capture: { events: ["console"] },
  });
  const secrets = resolveScenarioSecrets(scenario, {});
  const events = new PlaywrightScenarioEvents({
    page,
    context: context as never,
    ownsContext: true,
    enabled: new Set(["console"]),
    secrets,
  });
  expect(context.listenerCount("page")).toBe(1);
  await events.finish();
  expect(context.listenerCount("page")).toBe(0);
});
