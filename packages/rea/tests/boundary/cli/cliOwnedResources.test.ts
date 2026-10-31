import { afterEach, expect, it, vi } from "vitest";

import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { CliGuidanceResources } from "../../../src/cli/guidanceCommands.js";
import { CliJavaScriptAnalysisHost } from "../../../src/cli/javascriptApplicationAnalysis.js";

const originalClose = ArtifactResourceScope.prototype.close;

afterEach(() => {
  ArtifactResourceScope.prototype.close = originalClose;
  vi.restoreAllMocks();
});

it("keeps guidance descriptors on the host that created them", () => {
  const first = new CliGuidanceResources();
  const second = new CliGuidanceResources();
  expect(first.resources()).toBe(first.resources());
  expect(second.resources()).toBe(second.resources());
  expect(first.resources()).not.toBe(second.resources());
});

it("does not share a JavaScript worker scope or its in-flight close", async () => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  ArtifactResourceScope.prototype.close = function (
    this: ArtifactResourceScope,
  ) {
    return gate.then(() => originalClose.call(this));
  };
  const first = new CliJavaScriptAnalysisHost();
  const second = new CliJavaScriptAnalysisHost();
  let firstClose: Promise<void> | undefined;
  let secondClose: Promise<void> | undefined;
  const firstScope = first.scope();
  const secondScope = second.scope();
  try {
    expect(firstScope).not.toBe(secondScope);
    firstClose = first.close();
    expect(first.close()).toBe(firstClose);
    secondClose = second.close();
    expect(secondClose).not.toBe(firstClose);
  } finally {
    release();
    await Promise.allSettled([firstClose, secondClose]);
  }
  expect(first.scope()).not.toBe(firstScope);
  expect(second.scope()).not.toBe(secondScope);
});
