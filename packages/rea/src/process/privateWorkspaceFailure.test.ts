import { expect, it } from "vitest";

import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { privateWorkspaceFailure } from "./privateWorkspaceFailure.js";

const failure = (code: string | undefined, path?: string) =>
  Object.assign(new Error(`${code ?? "plain"} failure`), {
    ...(code === undefined ? {} : { code }),
    ...(path === undefined ? {} : { path }),
  });

it("keeps EFBIG as a file-size refusal with the worker file-size recovery", () => {
  const projection = projectAnalysisError(
    privateWorkspaceFailure("p", "op", failure("EFBIG", "/w/f"), "/w"),
  );
  expect(projection).toMatchObject({
    code: "resource_constraint",
    details: {
      resource: "file-size",
      reported_limits: {
        workspace_path: "/w",
        path: "/w/f",
        system_code: "EFBIG",
      },
    },
    remediation: {
      action: expect.stringContaining("worker file-size") as unknown,
    },
  });
});

it.each([
  ["errno without a path", failure("EIO"), "EIO", "/w"],
  ["error without errno", failure(undefined), null, "/w"],
  ["non-Error value", "unexpected", null, "/w"],
])(
  "falls back to the workspace coordinate for %s",
  (_name, cause, code, path) => {
    const projection = projectAnalysisError(
      privateWorkspaceFailure("p", "op", cause, "/w"),
    );
    expect(projection).toMatchObject({
      code: "execution_failure",
      details: {
        provider_id: "p",
        diagnostics: {
          stage: "workspace",
          workspace_path: "/w",
          path,
          system_code: code,
        },
      },
    });
    expect(projection.message).not.toContain("()");
  },
);
