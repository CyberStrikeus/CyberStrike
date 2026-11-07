import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { CdpConnection } from "../../dist/browser/CdpConnection.js";
import { discoverCdpEndpoint } from "../../dist/browser/CdpEndpoint.js";
import { captureCdpScreenshot } from "../../dist/browser/CdpScreenshot.js";
import { comparePngScreenshots } from "../../dist/browser/PngVisualDiff.js";
import { createWebScreenshotArtifact } from "../../dist/domain/webScreenshot.js";

/** Exercise the production capture boundary on a real, undersized surface. */
export async function verifyViewportScreenshotE2e(endpoint, origin) {
  const browser = await chromium.connectOverCDP(endpoint);
  const context = await browser.newContext({
    viewport: { width: 800, height: 400 },
    deviceScaleFactor: 1,
  });
  let connection;
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/screenshot-viewport`);
    const discovery = await discoverCdpEndpoint(
      endpoint,
      "capture_web_screenshot",
    );
    const target = discovery.targets.find(({ url }) => url === page.url());
    assert.ok(
      target?.webSocket,
      "Owned viewport fixture needs a page CDP endpoint",
    );
    connection = await CdpConnection.connect(
      target.webSocket.url,
      "capture_web_screenshot",
    );
    const emulation = await context.newCDPSession(page);
    const cases = [];
    for (const scale of [1, 2]) {
      await connection.send("Emulation.setDeviceMetricsOverride", {
        width: 800,
        height: 400,
        deviceScaleFactor: 0,
        mobile: false,
      });
      // A capture on another CDP session can restore its own device metrics.
      // Establish the fixture independently for each page-scale case.
      await emulation.send("Emulation.clearDeviceMetricsOverride");
      await emulation.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
        dontSetVisibleSize: true,
      });
      await emulation.send("Emulation.setPageScaleFactor", {
        pageScaleFactor: scale,
      });
      const { visualViewport, cssVisualViewport } = await connection.send(
        "Page.getLayoutMetrics",
      );
      assert.equal(
        cssVisualViewport.clientWidth * cssVisualViewport.scale,
        1280,
        JSON.stringify({ scale, visualViewport }),
      );
      assert.equal(
        cssVisualViewport.clientHeight * cssVisualViewport.scale,
        720,
        JSON.stringify({ scale, visualViewport }),
      );
      const captures = [];
      const send = connection.send.bind(connection);
      connection.send = (...args) => {
        const result = send(...args);
        if (args[0] !== "Page.captureScreenshot") return result;
        return result.then((reply) => {
          captures.push({ params: args[1], data: reply.data });
          return reply;
        });
      };
      try {
        await assert.rejects(
          captureCdpScreenshot({
            connection,
            discovery,
            target,
            input: {
              cdp_endpoint: endpoint,
              target_id: target.id,
              allowed_origins: [origin],
            },
          }),
          (error) => error.reason === "target_changed",
          "Recovery must reject a viewport changed by another session",
        );
      } finally {
        connection.send = send;
      }
      assert.equal(
        captures.length,
        2,
        "Fixture must exercise cropped recovery",
      );
      assert.equal(captures[0].params.captureBeyondViewport, false);
      assert.equal(captures[0].params.clip, undefined);
      assert.equal(captures[1].params.captureBeyondViewport, true);
      assert.ok(captures[1].params.clip, "Recovery must use an explicit clip");
      const expectedViewport = {
        width: Math.round(visualViewport.clientWidth * visualViewport.scale),
        height: Math.round(visualViewport.clientHeight * visualViewport.scale),
      };
      const initialBytes = Buffer.from(captures[0].data, "base64");
      assert.ok(
        initialBytes.readUInt32BE(16) < expectedViewport.width ||
          initialBytes.readUInt32BE(20) < expectedViewport.height,
        "First production capture must actually be undersized",
      );
      const recovered = createWebScreenshotArtifact(
        Buffer.from(captures[1].data, "base64"),
      );
      const control = await connection.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: cssVisualViewport.pageX,
          y: cssVisualViewport.pageY,
          width: cssVisualViewport.clientWidth,
          height: cssVisualViewport.clientHeight,
          scale: cssVisualViewport.scale,
        },
      });
      const compared = comparePngScreenshots({
        before: recovered,
        after: createWebScreenshotArtifact(Buffer.from(control.data, "base64")),
        channel_threshold: 0,
      });
      assert.equal(
        compared.status,
        "identical",
        `Viewport capture must retain every control pixel: ${JSON.stringify({ scale, compared })}`,
      );
      // A stable, same-session viewport must still return a normal screenshot.
      await connection.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 720,
        deviceScaleFactor: 0,
        mobile: false,
      });
      await connection.send("Emulation.setPageScaleFactor", {
        pageScaleFactor: scale,
      });
      const screenshot = await captureCdpScreenshot({
        connection,
        discovery,
        target,
        input: {
          cdp_endpoint: endpoint,
          target_id: target.id,
          allowed_origins: [origin],
        },
      });
      assert.deepEqual(screenshot.viewport, expectedViewport);
      assert.equal(
        comparePngScreenshots({
          before: screenshot.artifact,
          after: recovered,
          channel_threshold: 0,
        }).status,
        "identical",
      );
      cases.push({
        page_scale: scale,
        viewport: screenshot.viewport,
        pixel_control: "identical",
        clipped_recovery: true,
        changed_viewport_rejected: true,
        stable_viewport_accepted: true,
      });
    }
    return {
      mocked: false,
      boundary: "captureCdpScreenshot",
      external_session_emulation: true,
      cases,
    };
  } finally {
    try {
      if (connection !== undefined) await connection.close();
    } finally {
      try {
        await context.close();
      } finally {
        await browser.close();
      }
    }
  }
}
