import { describe, expect, it } from "vitest";

import {
  getNavigationContext,
  inspectAddressContext,
} from "./AnalysisContextQueries.js";
import {
  createAnalysisExecution,
  type AnalysisOperationPort,
} from "./AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
  AnalysisProtocolError,
} from "../domain/analysisErrorCore.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { err, ok } from "../domain/result.js";

const provider = { id: "fixture", name: "Fixture", version: "1" };

const registerNavigationSelectionValidationTests = (): void => {
  it.each([
    [null, "0x401000", "current_document"],
    ["fixture", null, "current_address"],
  ] as const)(
    "rejects malformed %s / %s provider selection before returning success",
    async (document, address, operation) => {
      const analysis: AnalysisOperationPort = {
        execute: async (name) =>
          ok(
            createAnalysisExecution(
              name === "current_document" ? document : address,
              provider,
            ),
          ),
      };
      const result = await getNavigationContext(analysis, {});
      expect(result).toEqual(
        err(
          new AnalysisOutputError(
            operation,
            operation === "current_document"
              ? "expected a document identity string"
              : "expected an address string",
          ),
        ),
      );
    },
  );
};

describe("analysis context queries: navigation", () => {
  registerNavigationSelectionValidationTests();

  it("aggregates volatile navigation and treats a missing procedure as null", async () => {
    const calls: {
      operation: string;
      parameters: Readonly<Record<string, unknown>>;
    }[] = [];
    const analysis: AnalysisOperationPort = {
      execute: (operation, parameters) => {
        calls.push({ operation, parameters });
        if (operation === "current_document")
          return Promise.resolve(
            ok(createAnalysisExecution("fixture", provider)),
          );
        if (operation === "current_address")
          return Promise.resolve(
            ok(createAnalysisExecution("0x401000", provider)),
          );
        if (operation === "resolve_containing_procedure")
          return Promise.resolve(
            ok(
              createAnalysisExecution(
                {
                  query_address: "0x401000",
                  found: false,
                  procedure: null,
                  reason: "not_in_procedure",
                },
                provider,
              ),
            ),
          );
        return Promise.resolve(
          err(new AnalysisProtocolError(`unexpected ${operation}`)),
        );
      },
    };

    await expect(getNavigationContext(analysis, {})).resolves.toEqual(
      ok({
        document: "fixture",
        address: "0x401000",
        procedure: null,
      }),
    );
    expect(calls).toContainEqual({
      operation: "current_document",
      parameters: {},
    });
    expect(calls).toContainEqual({
      operation: "resolve_containing_procedure",
      parameters: { document: "fixture", address: "0x401000" },
    });
  });

  it("preserves empty string selections accepted by the output contract", async () => {
    const analysis: AnalysisOperationPort = {
      execute: async (operation) =>
        ok(
          createAnalysisExecution(
            operation === "resolve_containing_procedure"
              ? {
                  query_address: "",
                  found: false,
                  procedure: null,
                  reason: "not_in_procedure",
                }
              : "",
            provider,
          ),
        ),
    };
    await expect(getNavigationContext(analysis, {})).resolves.toEqual(
      ok({ document: "", address: "", procedure: null }),
    );
  });

  it.each<JsonValue>([
    null,
    {},
    { found: false, procedure: null },
    { query_address: "0x401000", found: true, procedure: null },
  ])(
    "keeps malformed containing-procedure output unknown: %j",
    async (value) => {
      const analysis: AnalysisOperationPort = {
        execute: async (operation) =>
          ok(
            createAnalysisExecution(
              operation === "resolve_containing_procedure"
                ? value
                : operation === "current_document"
                  ? "fixture"
                  : "0x401000",
              provider,
            ),
          ),
      };
      expect(await getNavigationContext(analysis, {})).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisOutputError",
          operation: "resolve_containing_procedure",
        },
      });
    },
  );

  it("does not infer procedure absence from a provider error message", async () => {
    const failure = new AnalysisProtocolError(
      "not in a procedure: malformed reply",
    );
    const analysis: AnalysisOperationPort = {
      execute: async (operation) =>
        operation === "resolve_containing_procedure"
          ? err(failure)
          : ok(createAnalysisExecution("0x401000", provider)),
    };
    expect(
      await getNavigationContext(analysis, { document: "fixture" }),
    ).toEqual(err(failure));
  });

  it("uses an explicit document without passing it to current_document and preserves procedure failures", async () => {
    const calls: string[] = [];
    const failure = new AnalysisProtocolError("provider response malformed");
    const analysis: AnalysisOperationPort = {
      execute: (operation) => {
        calls.push(operation);
        if (operation === "current_address")
          return Promise.resolve(
            ok(createAnalysisExecution("0x401000", provider)),
          );
        return Promise.resolve(err(failure));
      },
    };

    await expect(
      getNavigationContext(analysis, { document: "fixture" }),
    ).resolves.toEqual(err(failure));
    expect(calls).not.toContain("current_document");
    expect(calls).toContain("resolve_containing_procedure");
  });
});

describe("navigation procedure admission", () => {
  it.each([
    { condition: "missing result", value: null },
    { condition: "missing discriminator", value: {} },
    {
      condition: "missing query identity",
      value: { found: false, procedure: null, reason: "not_in_procedure" },
    },
    {
      condition: "missing procedure facts",
      value: {
        query_address: "0x401000",
        found: true,
        procedure: { address: "0x401000", name: "main" },
      },
    },
  ])(
    "rejects $condition instead of reporting no procedure",
    async ({ value }) => {
      const result = await getNavigationContext(
        {
          execute: async (operation) =>
            ok(
              createAnalysisExecution(
                operation === "current_address" ? "0x401000" : value,
                provider,
              ),
            ),
        },
        { document: "fixture" },
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisOutputError",
          operation: "resolve_containing_procedure",
        },
      });
    },
  );

  it.each(["no procedure exists", "not in a procedure"])(
    "preserves a provider failure containing %s",
    async (message) => {
      const failure = new AnalysisProtocolError(`Provider failed: ${message}`);
      const result = await getNavigationContext(
        {
          execute: async (operation) =>
            operation === "current_address"
              ? ok(createAnalysisExecution("0x401000", provider))
              : err(failure),
        },
        { document: "fixture" },
      );
      expect(result).toEqual(err(failure));
      if (result.ok) throw new Error("expected original provider failure");
      expect(result.error).toBe(failure);
    },
  );

  it("returns a validated containing procedure name", async () => {
    const result = await getNavigationContext(
      {
        execute: async (operation) =>
          ok(
            createAnalysisExecution(
              operation === "current_address"
                ? "0x401000"
                : {
                    query_address: "0x401000",
                    found: true,
                    procedure: {
                      address: "0x401000",
                      name: "main",
                      classification: null,
                      body: {
                        available: false,
                        reason: "Fixture has no body ranges",
                      },
                    },
                  },
              provider,
            ),
          ),
      },
      { document: "fixture" },
    );
    expect(result).toEqual(
      ok({ document: "fixture", address: "0x401000", procedure: "main" }),
    );
  });
});

describe("analysis context queries: address facets", () => {
  it("keeps unsupported address facets local and filters bookmarks", async () => {
    const bookmarkInputs: Readonly<Record<string, unknown>>[] = [];
    const analysis: AnalysisOperationPort = {
      execute: (operation, input) => {
        if (operation === "current_document")
          return Promise.resolve(
            ok(createAnalysisExecution("fixture", provider)),
          );
        if (operation === "comment")
          return Promise.resolve(
            err(new AnalysisProtocolError("comments unavailable")),
          );
        switch (operation) {
          case "address_name":
            return Promise.resolve(
              ok(createAnalysisExecution("entry", provider)),
            );
          case "resolve_containing_procedure":
            return Promise.resolve(
              ok(
                createAnalysisExecution(
                  {
                    query_address: "0x401000",
                    found: true,
                    procedure: {
                      address: "0x401000",
                      name: "main",
                      classification: null,
                      body: {
                        available: false,
                        reason: "Fixture omits body ranges.",
                      },
                    },
                  },
                  provider,
                ),
              ),
            );
          case "inline_comment":
            return Promise.resolve(ok(createAnalysisExecution(null, provider)));
          case "list_bookmarks":
            bookmarkInputs.push(input);
            return Promise.resolve(
              ok(
                createAnalysisExecution(
                  [
                    { address: "0x401000", name: "review" },
                    { address: "0x402000", name: "other" },
                  ],
                  provider,
                ),
              ),
            );
          default:
            return Promise.resolve(
              err(new AnalysisProtocolError(`unexpected ${operation}`)),
            );
        }
      },
    };

    const result = await inspectAddressContext(analysis, {
      address: "401000",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        document: "fixture",
        name: { state: "available", value: "entry" },
        comment: {
          state: "unavailable",
          reason: "comments unavailable",
        },
        bookmarks: {
          state: "available",
          value: [{ address: "0x401000", name: "review" }],
        },
      },
    });
    expect(bookmarkInputs).toEqual([{ document: "fixture" }]);
  });

  it("propagates cancellation instead of degrading it to an unavailable facet", async () => {
    const cancelled = new AnalysisCancelledError("comment");
    const analysis: AnalysisOperationPort = {
      execute: (operation) =>
        Promise.resolve(
          operation === "comment"
            ? err(cancelled)
            : ok(createAnalysisExecution(null, provider)),
        ),
    };

    await expect(
      inspectAddressContext(analysis, {
        address: "0x401000",
        document: "fixture",
      }),
    ).resolves.toEqual(err(cancelled));
  });

  it("reports malformed bookmark output as unavailable instead of empty", async () => {
    const analysis: AnalysisOperationPort = {
      execute: (operation) =>
        Promise.resolve(
          operation === "list_bookmarks"
            ? ok(createAnalysisExecution({ malformed: true }, provider))
            : ok(createAnalysisExecution(null, provider)),
        ),
    };

    await expect(
      inspectAddressContext(analysis, {
        address: "0x401000",
        document: "fixture",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        bookmarks: {
          state: "unavailable",
          reason: expect.stringContaining("malformed"),
        },
      },
    });
  });
});

it("does not start address facets after document selection completes under cancellation", async () => {
  const controller = new AbortController();
  const reason = { request: "cancelled after document selection" };
  const calls: string[] = [];
  const result = await inspectAddressContext(
    {
      execute: async (operation) => {
        calls.push(operation);
        controller.abort(reason);
        return ok(createAnalysisExecution("fixture", provider));
      },
    },
    { address: "0x401000" },
    controller.signal,
  );
  if (result.ok) throw new Error("expected cancelled selection");
  expect(result.error).toBeInstanceOf(AnalysisCancelledError);
  expect(result.error.cause).toBe(reason);
  expect(calls).toEqual(["current_document"]);
});
