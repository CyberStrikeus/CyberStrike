import { expect, it } from "vitest";
import { normalizeWorkflowRun } from "../../../scripts/ci/workflow-run.mjs";

it.each([
  [".github/workflows/ci.yml", ".github/workflows/ci.yml", null],
  [".github/workflows/ci.yml@main", ".github/workflows/ci.yml", "main"],
  [
    ".github/workflows/ci.yml@refs/heads/release/v1",
    ".github/workflows/ci.yml",
    "refs/heads/release/v1",
  ],
  [
    ".github/workflows/ci.yml@feature@v1",
    ".github/workflows/ci.yml",
    "feature@v1",
  ],
  [
    ".github/workflows/release.yaml@main",
    ".github/workflows/release.yaml",
    "main",
  ],
])(
  "preserves API path %s while separating its file identity and ref",
  (path, file, ref) => {
    const raw = { id: 10, path, head_sha: "a".repeat(40) };
    const parsed = normalizeWorkflowRun(raw);
    expect(parsed).toEqual({ ...raw, workflowPath: { file, ref } });
    expect(raw).not.toHaveProperty("workflowPath");
  },
);

it.each([
  undefined,
  null,
  42,
  "",
  ".github/workflows/ci.yml@",
  ".github/workflows/ci.yml@main\n",
  ".github/workflows/ci.yml@main\0",
  "../.github/workflows/ci.yml",
  ".github/workflows/../ci.yml@main",
  ".github/workflows/ci.yml-extra@main",
  "https://example.test/ci.yml@main",
])(
  "keeps malformed workflow path %s unknown instead of inventing a file identity",
  (path) => {
    const parsed = normalizeWorkflowRun({
      path,
      workflowPath: { file: ".github/workflows/ci.yml", ref: "main" },
    });
    expect(parsed.path).toBe(path);
    expect(parsed.workflowPath).toBeNull();
  },
);
