import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import * as routeInventory from "../../../../src/domain/javascript/javascriptRouteInventory.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { reconstructJavaScriptArtifact } from "../../../support/javascriptApplicationScope.js";

it("retains completed route Evidence when cancellation arrives during inventory finalization", async () => {
  const root = await createTestTempDirectory("rea-route-finalization-");
  await writeFile(join(root, "routes.js"), "route('/reports');");
  const controller = new AbortController();
  const original = routeInventory.buildJavaScriptRouteInventorySteps;
  let interrupted = false;
  const hook = vi
    .spyOn(routeInventory, "buildJavaScriptRouteInventorySteps")
    .mockImplementation(function* (...args) {
      const steps: Iterator<void, routeInventory.JavaScriptRouteInventory> =
        original(...args);
      try {
        for (;;) {
          const step = steps.next();
          if (step.done) return step.value;
          // Inject cancellation at the real domain finalization boundary,
          // after source analysis and its preceding cancellation checkpoint.
          if (!interrupted) {
            interrupted = true;
            controller.abort();
          }
          yield;
        }
      } finally {
        steps.return?.();
      }
    });
  onTestFinished(() => hook.mockRestore());
  await expect(
    reconstructJavaScriptArtifact({ input_path: root }, controller.signal),
  ).rejects.toMatchObject({
    reason: "cancelled",
    partialObservation: {
      operation: "analyze_javascript_application",
      normalized_result: {
        route_inventory: {
          routes: expect.arrayContaining([
            expect.objectContaining({ path: "/reports" }),
          ]),
        },
      },
    },
  });
  expect(interrupted).toBe(true);
});
