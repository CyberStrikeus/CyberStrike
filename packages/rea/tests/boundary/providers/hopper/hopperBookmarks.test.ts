import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const execute = promisify(execFile);
const bridgePath = fileURLToPath(
  new URL("../../../../bridge/hopper_bridge.py", import.meta.url),
);
const probePath = fileURLToPath(
  new URL("../../../fixtures/hopperBookmarkMutationProbe.py", import.meta.url),
);

const bookmark = z.strictObject({
  address: z.literal("0x401000"),
  name: z.string().nullable(),
});
const bookmarks = z.array(bookmark);
const resultSchema = z.strictObject({
  missing_apis: z.array(
    z.strictObject({
      api: z.string(),
      diagnostic_type: z.literal("capability_unavailable"),
      message: z.string(),
    }),
  ),
  fresh_empty: z.strictObject({
    result: z.boolean(),
    listing: bookmarks,
    raw_name: z.string().nullable(),
  }),
  default_named_omitted: z.strictObject({
    result: z.boolean(),
    listing: bookmarks,
  }),
  fresh_omitted: z.strictObject({ result: z.boolean(), listing: bookmarks }),
  named_creation_result: z.boolean(),
  empty_clear: z.strictObject({ result: z.boolean(), listing: bookmarks }),
  nonempty_replacement: z.strictObject({
    result: z.boolean(),
    listing: bookmarks,
  }),
  omitted_existing: z.strictObject({
    result: z.boolean(),
    setter_calls_before: z.number().int(),
    setter_calls_after: z.number().int(),
    listing: bookmarks,
  }),
  ignored_setter: z.strictObject({ result: z.boolean(), listing: bookmarks }),
  failed_clear: z.strictObject({ result: z.boolean(), listing: bookmarks }),
  missing_rename: z.strictObject({
    type: z.literal("CapabilityUnavailableError"),
    diagnostic_type: z.literal("capability_unavailable"),
  }),
  preserved_after_missing_rename: bookmarks,
  unset: z.strictObject({ result: z.boolean(), listing: bookmarks }),
  rename_calls: z.array(z.tuple([z.string(), z.string()])),
});

describe("Hopper bookmark bridge mutations", () => {
  it("uses exact provider readback and preserves omission semantics", async () => {
    const { stdout } = await execute("python3", [probePath, bridgePath], {
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 1_024 * 1_024,
    });
    const result = resultSchema.parse(JSON.parse(stdout));
    expect(result.missing_apis).toEqual(
      ["getBookmarks", "hasBookmarkAtAddress", "removeBookmarkAtAddress"].map(
        (api) => ({
          api,
          diagnostic_type: "capability_unavailable",
          message: `Hopper's public Python API does not expose ${api}`,
        }),
      ),
    );

    expect(result.fresh_empty).toEqual({
      result: true,
      listing: [{ address: "0x401000", name: "" }],
      raw_name: "",
    });
    expect(result.fresh_omitted).toEqual({
      result: true,
      listing: [{ address: "0x401000", name: null }],
    });
    expect(result.default_named_omitted).toEqual({
      result: false,
      listing: [{ address: "0x401000", name: "provider-default" }],
    });
    expect(result.named_creation_result).toBe(true);
    expect(result.empty_clear).toEqual({
      result: true,
      listing: [{ address: "0x401000", name: null }],
    });
    expect(result.nonempty_replacement).toEqual({
      result: true,
      listing: [{ address: "0x401000", name: "replacement-name" }],
    });
    expect(result.omitted_existing).toMatchObject({
      result: true,
      listing: [{ address: "0x401000", name: "replacement-name" }],
    });
    expect(result.omitted_existing.setter_calls_after).toBe(
      result.omitted_existing.setter_calls_before,
    );
    expect(result.ignored_setter).toEqual({
      result: false,
      listing: [{ address: "0x401000", name: "replacement-name" }],
    });
    expect(result.failed_clear).toEqual({
      result: false,
      listing: [{ address: "0x401000", name: "replacement-name" }],
    });
    expect(result.missing_rename).toEqual({
      type: "CapabilityUnavailableError",
      diagnostic_type: "capability_unavailable",
    });
    expect(result.preserved_after_missing_rename).toEqual([
      { address: "0x401000", name: "replacement-name" },
    ]);
    expect(result.unset).toEqual({ result: true, listing: [] });
    expect(result.rename_calls).toEqual([
      ["0x401000", ""],
      ["0x401000", ""],
    ]);
  });
});
