import { expect, it, vi } from "vitest";

import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { STATE_INTAKE_LIMIT_BYTES } from "../../application/environment/environmentStateDocument.js";
import {
  DEFAULT_STATE_INTAKE,
  fetchStateDocument,
  partDocument,
  STATE_FETCH_TIMEOUT_MS,
} from "./stateIntake.js";

const inlineDocument = async (bytes: string) => {
  const files = new ArtifactResourceScope();
  try {
    return await partDocument(
      { kind: "file", file: { bytes } },
      DEFAULT_STATE_INTAKE,
      new AbortController().signal,
      files,
    );
  } finally {
    await files.close();
  }
};

it("preserves padded syntax without imposing canonical pad bits", async () => {
  await expect(inlineDocument("e31=")).resolves.toEqual({
    ok: true,
    value: {},
  });
});

it("admits an inline JSON document at the decoded-byte budget", async () => {
  const bytes = Buffer.from(
    "{}".padEnd(STATE_INTAKE_LIMIT_BYTES, " "),
  ).toString("base64");
  await expect(inlineDocument(bytes)).resolves.toEqual({ ok: true, value: {} });
});

it.each([0, 1])(
  "refuses decoded-byte overflow before allocating the decoded buffer: %s extra quartets",
  async (extraQuartets) => {
    const bytes = "AAAA".repeat(
      Math.ceil(STATE_INTAKE_LIMIT_BYTES / 3) + extraQuartets,
    );
    const decoded = vi.spyOn(Buffer, "from");
    try {
      await expect(inlineDocument(bytes)).resolves.toMatchObject({
        ok: false,
        error: {
          code: -32602,
          message: expect.stringContaining(String(STATE_INTAKE_LIMIT_BYTES)),
        },
      });
      expect(decoded.mock.calls.length).toBe(0);
    } finally {
      decoded.mockRestore();
    }
  },
);

it("downloads with redirects refused and the 30 s timeout by default", async () => {
  const fetched = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}"));
  try {
    const url = new URL("https://state.example.test/state.json");
    const signal = AbortSignal.timeout(STATE_FETCH_TIMEOUT_MS);
    await fetchStateDocument(url, signal);
    expect(fetched).toHaveBeenCalledExactlyOnceWith(url, {
      signal,
      redirect: "error",
    });
    expect(DEFAULT_STATE_INTAKE).toEqual({
      fetchState: fetchStateDocument,
      timeoutMs: 30_000,
    });
  } finally {
    fetched.mockRestore();
  }
});
