import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { connect } from "node:net";

import { createBrowserScenarioProvider } from "../../dist/composition/browserScenario.js";
import { browserScenarioSchema } from "../../dist/domain/browserScenario.js";
import { PlaywrightScenarioServiceWorkers } from "../../dist/browser/PlaywrightScenarioServiceWorkers.js";

const beforeDeadline = async (promise, label, timeoutMs = 2_000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} did not settle`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

// Real loopback proxy: Playwright's first transport is forwarded to Chrome,
// then only the policy owner's discovery/handshake is deliberately withheld.
const startProxy = async (endpoint, mode, ownerOnly = false) => {
  const upstream = new URL(endpoint);
  const sockets = new Set();
  let versions = 0;
  let upgrades = 0;
  let enabled = true;
  let entered;
  const stalled = new Promise((resolve) => {
    entered = resolve;
  });
  let closed;
  let stalledClose;
  const stall = (socket) => {
    socket.resume();
    socket.once("end", () => socket.end());
    stalledClose = new Promise((resolve) => {
      closed = resolve;
    });
    socket.once("close", () => closed());
    entered();
  };
  const server = createServer((incoming, response) => {
    const versionRequest = incoming.url.replace(/\/$/, "") === "/json/version";
    if (versionRequest) versions += 1;
    if (
      enabled &&
      mode === "http-discovery" &&
      versions === 2 &&
      versionRequest
    ) {
      stall(incoming.socket);
      return;
    }
    const outgoing = request(new URL(incoming.url, upstream), (received) => {
      const chunks = [];
      received.on("data", (chunk) => chunks.push(chunk));
      received.on("end", () => {
        const content = Buffer.concat(chunks).toString("utf8");
        response.writeHead(received.statusCode, {
          "content-type": "application/json",
        });
        response.end(
          content.replaceAll(
            `127.0.0.1:${upstream.port}`,
            `127.0.0.1:${server.address().port}`,
          ),
        );
      });
    });
    outgoing.on("error", () => response.destroy());
    response.on("close", () => outgoing.destroy());
    outgoing.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (incoming, socket, head) => {
    upgrades += 1;
    if (
      enabled &&
      mode !== "http-discovery" &&
      upgrades === (ownerOnly ? 1 : 2)
    ) {
      stall(socket);
      return;
    }
    const outgoing = connect(Number(upstream.port), "127.0.0.1", () => {
      const headers = incoming.rawHeaders.flatMap((value, index, all) =>
        index % 2 === 0 ? [`${value}: ${all[index + 1]}`] : [],
      );
      outgoing.write(
        `${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`,
      );
      if (head.length > 0) outgoing.write(head);
      outgoing.pipe(socket);
      socket.pipe(outgoing);
    });
    outgoing.on("error", () => socket.destroy());
    socket.on("error", () => outgoing.destroy());
    socket.on("close", () => outgoing.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  let proxyEndpoint = origin;
  if (mode === "browser-websocket") {
    const version = await (await fetch(`${endpoint}/json/version`)).json();
    proxyEndpoint = version.webSocketDebuggerUrl.replace(
      `127.0.0.1:${upstream.port}`,
      `127.0.0.1:${server.address().port}`,
    );
  }
  return {
    endpoint: proxyEndpoint,
    stalled,
    waitClosed: () => stalledClose,
    resume: () => {
      enabled = false;
    },
    close: async () => {
      const done = once(server, "close");
      server.close();
      for (const socket of sockets) socket.destroy();
      await done;
    },
  };
};

export const verifyScenarioPolicySetup = async (
  endpoint,
  targetId,
  origin,
  page,
) => {
  const result = {};
  // Exercise a caller-selected handshake deadline within the existing teardown
  // guard; the default command deadline may legitimately outlast that guard.
  const setupCommandTimeoutMs = 2_000;
  for (const mode of ["http-websocket", "http-discovery", "deadline"]) {
    const proxy = await startProxy(endpoint, mode);
    const provider = createBrowserScenarioProvider(process.env);
    const scenario = browserScenarioSchema.parse({
      browser: {
        mode: "connect",
        cdp_endpoint: proxy.endpoint,
        target_id: targetId,
      },
      start_url: { url: origin },
      ...(mode === "deadline"
        ? { command_timeout_ms: setupCommandTimeoutMs }
        : {}),
      environment: { service_workers: "block" },
      actions: [
        { step_id: "settle", action: "wait_for_timeout", duration_ms: 1 },
      ],
      capture: { events: [], after_each_step: ["dom"], at_end: ["dom"] },
    });
    const cancellation = new AbortController();
    let failure;
    try {
      const pending = provider.captureScenario(scenario, {
        signal: cancellation.signal,
      });
      await beforeDeadline(proxy.stalled, `${mode} setup`);
      if (mode !== "deadline") cancellation.abort();
      const cancelled = await beforeDeadline(
        pending,
        `${mode} termination`,
        mode === "deadline" ? 12_000 : 2_000,
      );
      assert.equal(cancelled.ok, false);
      assert.equal(cancelled.error.cleanupIncomplete, false);
      if (mode === "deadline") assert.equal(cancelled.error.reason, "timeout");
      await beforeDeadline(proxy.waitClosed(), `${mode} socket release`);
      assert.equal(
        await page.evaluate(() =>
          navigator.serviceWorker.register.toString().includes("[native code]"),
        ),
        true,
      );
      proxy.resume();
      const next = await beforeDeadline(
        provider.captureScenario(scenario),
        `${mode} target reacquisition`,
      );
      if (!next.ok) throw next.error;
      assert.equal(next.value.browser.cleanup, "disconnected-external");
      result[mode] = {
        ...(mode === "deadline"
          ? { timed_out: true, command_timeout_ms: setupCommandTimeoutMs }
          : { cancelled: true }),
        socket_closed: true,
        target_reused: true,
      };
    } catch (cause) {
      failure = cause;
      throw cause;
    } finally {
      cancellation.abort();
      try {
        await proxy.close();
      } finally {
        try {
          await provider.close();
        } catch (cleanupFailure) {
          if (failure !== undefined)
            throw new AggregateError([failure, cleanupFailure]);
          throw cleanupFailure;
        }
      }
    }
  }
  const proxy = await startProxy(endpoint, "browser-websocket", true);
  const policy = new PlaywrightScenarioServiceWorkers(
    page,
    proxy.endpoint,
    targetId,
  );
  try {
    const rejected = assert.rejects(
      policy.initialize(),
      (error) => error._tag === "AnalysisCancelledError",
    );
    await beforeDeadline(proxy.stalled, "browser websocket approval handshake");
    await beforeDeadline(policy.close(), "browser websocket cleanup");
    await rejected;
    await beforeDeadline(
      proxy.waitClosed(),
      "browser websocket socket release",
    );
    proxy.resume();
    const next = new PlaywrightScenarioServiceWorkers(
      page,
      proxy.endpoint,
      targetId,
    );
    try {
      await beforeDeadline(
        next.initialize(),
        "browser websocket reacquisition",
      );
    } finally {
      await next.close();
    }
    result["browser-websocket"] = {
      cancelled: true,
      socket_closed: true,
      target_reused: true,
      direct_owner: true,
    };
  } finally {
    try {
      await policy.close();
    } finally {
      await proxy.close();
    }
  }
  return result;
};
