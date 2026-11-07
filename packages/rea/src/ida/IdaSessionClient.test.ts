import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createIdaTarget,
  RecordingIdaMcp,
} from "../../tests/fixtures/idaMcp.js";
import { nativeTools } from "./IdaNativeProtocol.js";
import { IdaSessionClient } from "./IdaSessionClient.js";
import {
  DEFAULT_REGEX_MATCHING_DEADLINE,
  REGEX_MATCHING_DEADLINE_SETTING,
} from "../config/regexMatchingDeadline.js";
import { functionDossierSchema } from "../domain/native/functionDossier.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import {
  AnalysisProtocolError,
  AnalysisResourceConstraintError,
  AnalysisCancelledError,
  AnalysisTimeoutError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { WindowsPrivateRuntime } from "../windows/WindowsPrivateRuntime.js";

const roots: string[] = [];
const windowsRuntimes = new Set<WindowsPrivateRuntime>();
beforeEach(() => {
  if (process.platform !== "win32") return;
  const create = WindowsPrivateRuntime.create;
  vi.spyOn(WindowsPrivateRuntime, "create").mockImplementation(
    (parent, prefix) => {
      const runtime = create(parent, prefix);
      windowsRuntimes.add(runtime);
      return runtime;
    },
  );
});
afterEach(async () => {
  try {
    // These pure producer fixtures spawn no IDA worker. After the retention
    // assertions, release only the actual native owners this test created.
    for (const runtime of windowsRuntimes) {
      await runtime.close();
      windowsRuntimes.delete(runtime);
    }
    for (const root of roots.splice(0))
      await rm(root, { recursive: true, force: true });
  } finally {
    vi.restoreAllMocks();
  }
});
/** A failed close whose diagnostic names exactly these unverified sessions. */
const reportsSessions = (...sessions: readonly object[]) => ({
  error: {
    diagnostics: { upstream_sessions: { state: "unverified", sessions } },
  },
});
const LIVE_PEER = {
  session_id: "unrelated-live-peer",
  backend: "worker",
  owned: false,
} as const;

const fixture = async (
  mode: "attached" | "headless" = "attached",
  timeoutMs = 1000,
  protocol?: "native",
) => {
  const { root, target } = await createIdaTarget();
  roots.push(root);
  const producer = new RecordingIdaMcp(target, mode);
  const client = new IdaSessionClient(
    {
      command: "fixture",
      args: [],
      env: {},
      mode,
      ...(protocol === undefined ? {} : { protocol }),
      timeoutMs,
      workspaceRoot: root,
    },
    target,
    producer,
  );
  return { root, target, producer, client };
};

it.each([
  new Error("HTTP 404: fixture response"),
  new ProviderAdapterError("ida", "transport", {
    diagnostics: { reason: "fixture response" },
  }),
  new AnalysisTimeoutError("ida_mcp_connect", 1000),
  new AnalysisProtocolError("Malformed MCP response"),
  new AnalysisResourceConstraintError(
    "ida_mcp_connect",
    "transport",
    "fixture limit",
    { max_response_bytes: 1 },
  ),
])(
  "retains the selected HTTP endpoint on a connection failure",
  async (cause) => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const producer = new RecordingIdaMcp(target, "attached");
    vi.spyOn(producer, "connect").mockRejectedValue(cause);
    const selected = "HTTP://LOCALHOST:01234/mcp?cursor=kept";
    const client = new IdaSessionClient(
      {
        url: selected,
        headers: { Authorization: "Bearer fixture-secret" },
        mode: "attached",
        timeoutMs: 1000,
      },
      target,
      producer,
    );
    const result = await client.execute("list_procedures", {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected connection failure");
    expect(result.error.diagnostics).toMatchObject({ endpoint: selected });
    expect(JSON.stringify(projectAnalysisError(result.error))).not.toContain(
      "fixture-secret",
    );
    await client.close();
  },
);

it.each([
  "fixture-secret",
  "fixture%2Dsecret",
  "fixture%2dsecret",
  "%66%69%78%74%75%72%65-secret",
])(
  "redacts a known transport credential in the selected endpoint: %s",
  async (encoded) => {
    const { root, target } = await createIdaTarget();
    roots.push(root);
    const producer = new RecordingIdaMcp(target, "attached");
    vi.spyOn(producer, "connect").mockRejectedValue(
      new Error("fixture failure"),
    );
    const client = new IdaSessionClient(
      {
        url: `http://localhost:1234/mcp?token=${encoded}&cursor=keep`,
        headers: { Authorization: "Bearer fixture-secret" },
        mode: "attached",
        timeoutMs: 1000,
      },
      target,
      producer,
    );
    const result = await client.execute("list_procedures", {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected connection failure");
    const output = JSON.stringify(projectAnalysisError(result.error));
    expect(output).not.toContain("fixture-secret");
    expect(output).not.toContain(encoded);
    expect(output).toContain("http://localhost:1234/mcp?token=");
    expect(output).toContain("&cursor=keep");
    await client.close();
  },
);

it.each(["initialize", "transport"])(
  "preserves producer outcome facts when attributing a cached %s failure",
  async (operation) => {
    const { producer, client } = await fixture();
    const primary = new AnalysisCancelledError("provider_startup");
    const source = new ProviderAdapterError("ida", operation, {
      cleanupPrimary: primary,
      limit: {
        setting: "regex.matching_deadline_ms",
        effective_value: 100,
        unit: "ms",
        minimum: 1,
        maximum: 1000,
        applies_at: "next_operation",
        agent_editable: true,
        scope: "rea-runtime",
        rea_restart_required: false,
      },
      diagnostics: { producer_fact: "retained" },
    });
    const connect = vi.spyOn(producer, "connect").mockRejectedValue(source);
    for (const requested of ["list_procedures", "list_strings"] as const) {
      const result = await client.execute(requested, {});
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected startup failure");
      expect(result.error).toBeInstanceOf(ProviderAdapterError);
      expect(result.error).toMatchObject({
        operation: requested,
        limit: source.limit,
        cleanupPrimary: { operation: requested },
        diagnostics: { producer_fact: "retained" },
      });
      expect(result.error.cleanupPrimary).toBeInstanceOf(
        AnalysisCancelledError,
      );
    }
    expect(connect).toHaveBeenCalledTimes(1);
    expect(source.operation).toBe(operation);
    expect(source.cleanupPrimary).toBe(primary);
    await client.close();
  },
);

describe("headless IDA producer pagination", () => {
  it("follows reported cursors for modern inventories, pseudocode, and bare-hex assembly without losing pages", async () => {
    const { producer, client } = await fixture("headless");
    producer.overrideCall = (name, args) => {
      const first = args.offset === 0;
      const cursor = first ? { next: 1 } : { done: true };
      if (name === "decompile")
        return { code: first ? "first line" : "second line", cursor };
      if (name === "disasm")
        return {
          asm: {
            name: "main",
            start_ea: "0x1000",
            lines: [
              {
                addr: first ? "1000" : "1001",
                instruction: first ? "push rbp" : "ret",
              },
            ],
          },
          cursor,
        };
      if (name === "find_regex")
        return {
          matches: [
            {
              addr: first ? "0x3000" : "0x3002",
              string: first ? "a.b" : "a+b",
            },
          ],
          cursor,
        };
      if (name === "list_funcs") {
        const page = z
          .object({ offset: z.number() })
          .parse(args.queries).offset;
        return [
          {
            data: [
              {
                addr: page === 0 ? "0x1000" : "0x2000",
                name: page === 0 ? "main" : "other",
                size: "0x20",
              },
            ],
            next_offset: page === 0 ? 1 : null,
          },
        ];
      }
      return undefined;
    };
    const inventory = await client.execute("list_procedures", {});
    expect(inventory.ok && inventory.value.result).toHaveLength(2);
    const strings = await client.execute("list_strings", {});
    expect(strings.ok && strings.value.result).toHaveLength(2);
    const result = await client.execute("analyze_function", {
      procedure: "main",
    });
    if (!result.ok) throw result.error;
    const dossier = functionDossierSchema.parse(result.value.result);
    expect(dossier.pseudocode).toBe("first line\nsecond line");
    expect(dossier.assembly).toEqual(["0x1000: push rbp", "0x1001: ret"]);
    expect(dossier).toMatchObject({
      procedure: {
        classification: null,
        body: {
          available: false,
          reason: "IDA MCP does not report complete function body ranges.",
        },
      },
      native_api: null,
      native_value_flow: null,
    });
    await client.close();
  });
});

describe("headless IDA modern string search failures", () => {
  it("rejects a producer error before returning page matches and retains both replies as partial evidence", async () => {
    const { producer, client } = await fixture("headless");
    producer.overrideCall = (name, args) => {
      if (name !== "find_regex") return undefined;
      if (args.offset === 0)
        return {
          matches: [{ addr: "0x3000", string: "complete page" }],
          cursor: { next: 1 },
          error: null,
        };
      return {
        matches: [{ addr: "0x3001", string: "untrusted partial page" }],
        cursor: { done: true },
        error: "Search fixture failed",
      };
    };
    try {
      const failed = await client.execute("search_strings", {
        pattern: "needle",
      });
      expect(failed.ok).toBe(false);
      if (!failed.ok) {
        expect(failed.error).toBeInstanceOf(AnalysisProtocolError);
        expect(failed.error.message).toContain("Search fixture failed");
        expect(failed.error.partialObservation).toMatchObject({
          normalized_result: {
            status: "partial",
            failed_operation: "search_strings",
            observations: expect.arrayContaining([
              expect.objectContaining({
                tool: "find_regex",
                result: expect.objectContaining({
                  matches: [{ addr: "0x3000", string: "complete page" }],
                  error: null,
                }),
              }),
              expect.objectContaining({
                tool: "find_regex",
                result: expect.objectContaining({
                  matches: [
                    { addr: "0x3001", string: "untrusted partial page" },
                  ],
                  error: "Search fixture failed",
                }),
              }),
            ]),
          },
        });
      }
      expect(
        producer.calls
          .filter(({ name }) => name === "find_regex")
          .map(({ args }) => args.offset),
      ).toEqual([0, 1]);

      producer.overrideCall = (name) =>
        name === "find_regex"
          ? { matches: [], cursor: { done: true }, error: null }
          : undefined;
      const empty = await client.execute("search_strings", {
        pattern: "needle",
      });
      expect(empty.ok && empty.value.result).toEqual([]);
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  });
});

describe("attached IDA readiness and queued cancellation", () => {
  it("allows ready-only work after an attached provider has initialized", async () => {
    const { producer, client } = await fixture("attached");
    await expect(client.executeIfReady("list_procedures", {})).resolves.toBe(
      undefined,
    );

    const startup = await client.execute("list_procedures", {});
    if (!startup.ok) throw startup.error;
    const result = await client.executeIfReady("list_procedures", {});
    if (result === undefined)
      throw new Error("expected ready attached IDA dispatch");
    if (!result.ok) throw result.error;
    expect(result.value.result).toEqual([
      expect.objectContaining({ address: "0x1000", value: "main" }),
    ]);
    expect(
      producer.calls.filter(({ name }) => name === "idb_open"),
    ).toHaveLength(0);
    await client.close();
  });

  it("returns cold and pending startup calls immediately, then cancels queued work before dispatch", async () => {
    const { producer, client } = await fixture("headless");
    await expect(client.executeIfReady("list_procedures", {})).resolves.toBe(
      undefined,
    );
    expect(producer.connects).toBe(0);

    let enterOpen: (() => void) | undefined;
    let finishOpen: (() => void) | undefined;
    const openEntered = new Promise<void>((resolve) => {
      enterOpen = resolve;
    });
    const openGate = new Promise<void>((resolve) => {
      finishOpen = resolve;
    });
    producer.beforeCall = async (name) => {
      if (name === "idb_open") {
        enterOpen?.();
        await openGate;
      }
    };
    const startup = client.execute("list_procedures", {});
    await openEntered;
    await expect(client.executeIfReady("list_strings", {})).resolves.toBe(
      undefined,
    );
    expect(
      producer.calls.filter(({ name }) => name === "idb_open"),
    ).toHaveLength(1);
    finishOpen?.();
    const started = await startup;
    if (!started.ok) throw started.error;
    const warm = await client.executeIfReady("list_procedures", {});
    if (warm === undefined) throw new Error("expected ready IDA dispatch");
    if (!warm.ok) throw warm.error;
    expect(warm.value.result).toEqual([
      expect.objectContaining({ address: "0x1000", value: "main" }),
    ]);

    let enterRead: (() => void) | undefined;
    let finishRead: (() => void) | undefined;
    const readEntered = new Promise<void>((resolve) => {
      enterRead = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    producer.beforeCall = async (name) => {
      if (name === "list_funcs") {
        enterRead?.();
        await readGate;
      }
    };
    const active = client.execute("list_procedures", {});
    await readEntered;
    const controller = new AbortController();
    const queued = client.executeIfReady(
      "list_strings",
      {},
      {
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(queued).resolves.toMatchObject({
      ok: false,
      error: { _tag: "AnalysisCancelledError" },
    });
    finishRead?.();
    const activeResult = await active;
    if (!activeResult.ok) throw activeResult.error;
    expect(
      producer.calls.filter(({ name }) => name === "list_funcs"),
    ).toHaveLength(3);
    expect(producer.calls.some(({ name }) => name === "find_regex")).toBe(
      false,
    );
    await client.close();
  });
});

describe("attached IDA input identity and validation", () => {
  it("accepts a normalized spelling of the bound document path", async () => {
    const { target, producer, client } = await fixture();
    const equivalent =
      process.platform === "win32"
        ? target.path.toLowerCase().replaceAll("\\", "/")
        : target.path.split(sep).join(`${sep}.${sep}`);

    const result = await client.execute("list_procedures", {
      document: equivalent,
    });

    expect(result.ok).toBe(true);
    expect(producer.calls.some(({ name }) => name === "list_functions")).toBe(
      true,
    );
    await client.close();
  });

  it.skipIf(process.platform === "win32")(
    "rejects a document whose symlink traversal names a different input",
    async () => {
      const { root, target, producer, client } = await fixture();
      await mkdir(join(root, "foreign", "inner"), { recursive: true });
      await writeFile(
        join(root, "foreign", basename(target.path)),
        "foreign input",
      );
      await symlink(join(root, "foreign", "inner"), join(root, "link"));
      const document = `${root}/link/../${basename(target.path)}`;
      expect(await realpath(document)).not.toBe(await realpath(target.path));

      const result = await client.execute("list_procedures", { document });

      expect(result).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisInputError" },
      });
      expect(producer.connects).toBe(0);
      await client.close();
    },
  );

  it.skipIf(process.platform === "win32")(
    "refuses an opened worker whose input only matches after lexical parent collapse",
    async () => {
      const { root, producer, client } = await fixture("headless");
      await mkdir(join(root, "foreign", "inner"), { recursive: true });
      let privateInput = "";
      producer.beforeCall = async (name, args) => {
        if (name !== "idb_open") return;
        privateInput = z.string().parse(args.input_path);
        await writeFile(
          join(root, "foreign", basename(privateInput)),
          "foreign input",
        );
        await symlink(
          join(root, "foreign", "inner"),
          join(dirname(privateInput), "link"),
        );
      };
      producer.overrideCall = (name, args) => {
        if (name !== "idb_open") return undefined;
        producer.database = z.string().parse(args.preferred_session_id);
        producer.inputPath = `${dirname(privateInput)}/link/../${basename(privateInput)}`;
        return {
          success: true,
          session: {
            session_id: producer.database,
            input_path: producer.inputPath,
          },
        };
      };

      const result = await client.execute("list_procedures", {});

      expect(await realpath(producer.inputPath)).not.toBe(
        await realpath(privateInput),
      );
      expect(result.ok).toBe(false);
      expect(producer.calls.some(({ name }) => name === "list_funcs")).toBe(
        false,
      );
      producer.inputPath = privateInput;
      await client.close();
    },
  );

  it("rejects an unrelated document before connecting or opening a provider", async () => {
    const { producer, client } = await fixture();
    const result = await client.execute("list_procedures", {
      document: "/unrelated/input",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error._tag).toBe("AnalysisInputError");
      expect(result.error.message).toContain("list_procedures");
    }
    expect(producer.connects).toBe(0);
    expect(producer.calls).toEqual([]);
    await client.close();
  });
  it("preserves hexadecimal-looking function names as names unless the caller uses an explicit 0x address", async () => {
    const { producer, client } = await fixture();
    producer.overrideCall = (name, args) =>
      name === "get_function_by_name" && args.name === "f"
        ? { address: "0x1000", name: "f", size: "0x20" }
        : undefined;
    const found = await client.execute("procedure_address", { procedure: "f" });
    expect(found.ok && found.value.result).toBe("0x1000");
    expect(
      producer.calls.some(({ name }) => name === "get_function_by_address"),
    ).toBe(false);
    await client.close();
  });
  it("preserves omitted optional arguments and rejects explicit null before connecting", async () => {
    const { producer, client } = await fixture();
    for (const [operation, parameters] of [
      ["list_procedures", { document: null }],
      ["list_strings", { address: null }],
      ["procedure_pseudo_code", { procedure: null }],
    ] as const) {
      const result = await client.execute(operation, parameters);
      expect(result.ok).toBe(false);
      if (!result.ok)
        expect(result.error).toMatchObject({
          _tag: "AnalysisInputError",
          operation,
          issues: [{ path: Object.keys(parameters), reason: "invalid_type" }],
        });
    }
    expect(producer.connects).toBe(0);
    expect(producer.calls).toEqual([]);
    expect((await client.execute("list_procedures", {})).ok).toBe(true);
    expect((await client.execute("list_strings", {})).ok).toBe(true);
    expect(
      (await client.execute("procedure_pseudo_code", { procedure: "main" })).ok,
    ).toBe(true);
    expect(
      producer.calls.filter(({ name }) => name === "decompile_function"),
    ).toHaveLength(1);
    await client.close();
  });
});

describe("attached IDA function observations", () => {
  it("resolves interior addresses and call sites to canonical entries, preserves externals, and reports unknown body evidence", async () => {
    const { producer, client } = await fixture();
    const result = await client.execute("analyze_function", {
      procedure: "0x1004",
    });
    if (!result.ok) throw result.error;
    const dossier = functionDossierSchema.parse(result.value.result);
    expect(dossier.procedure.address).toBe("0x1000");
    expect(dossier.callers.map((caller) => caller.address)).toEqual(["0x1000"]);
    expect(dossier.callees.map((callee) => callee.address)).toEqual(["0x2000"]);
    expect(dossier.procedure.body.available).toBe(false);
    expect(dossier.comments).toEqual([]);
    expect(result.value.rawResult).toMatchObject({
      observations: expect.arrayContaining([
        expect.objectContaining({ tool: "get_callers" }),
      ]),
    });
    expect(result.value.provider.version).toBe("1");
    expect(producer.serverInfo()).toMatchObject({
      version: "sdk-version-is-not-ida",
    });
    await client.close();
    expect(producer.calls.some(({ name }) => name.startsWith("idb_"))).toBe(
      false,
    );
  });
  it("returns complete paged inventory and distinguishes literal from regex search", async () => {
    const { producer, client } = await fixture();
    producer.overrideCall = (name, args) =>
      name === "list_functions"
        ? {
            data: [
              {
                address: args.offset === 0 ? "0x1000" : "0x2000",
                name: "main",
                size: "0x10",
              },
            ],
            next_offset: args.offset === 0 ? 100 : null,
          }
        : undefined;
    const inventory = await client.execute("list_procedures", {});
    expect(inventory.ok && inventory.value.result).toHaveLength(2);
    for (const [pattern, mode, count] of [
      ["a.b", "literal", 1],
      ["a+b", "literal", 0],
      ["a.b", "regex", 1],
    ] as const) {
      const found = await client.execute("search_strings", { pattern, mode });
      expect(found.ok && found.value.result).toHaveLength(count);
    }
    expect(
      (await client.execute("search_strings", { pattern: "[", mode: "regex" }))
        .ok,
    ).toBe(false);
    await client.close();
  });
});

describe("attached IDA regex supervision", () => {
  it.each(["search_procedures", "search_strings"] as const)(
    "preserves Unicode case semantics and inventory order in %s",
    async (operation) => {
      const { producer, client } = await fixture();
      const values = ["skip", "ÄPFEL", "äpfel"];
      producer.overrideCall = (name) =>
        name === "list_functions"
          ? {
              data: values.map((name, index) => ({
                address: `0x${String(1000 + index)}`,
                name,
                size: "0x10",
              })),
              next_offset: null,
            }
          : name === "list_strings"
            ? {
                data: values.map((string, index) => ({
                  address: `0x${String(3000 + index)}`,
                  length: string.length,
                  string,
                })),
                next_offset: null,
              }
            : undefined;
      try {
        for (const case_sensitive of [false, true]) {
          const found = await client.execute(operation, {
            pattern: "^ä",
            mode: "regex",
            case_sensitive,
          });
          expect(found.ok && found.value.result).toEqual(
            values.flatMap((value, index) =>
              index === 0 || (case_sensitive && index === 1)
                ? []
                : [
                    {
                      address: `0x${String((operation === "search_strings" ? 3000 : 1000) + index)}`,
                      value,
                    },
                  ],
            ),
          );
        }
      } finally {
        await client.close();
      }
    },
  );
  it.each(["search_procedures", "search_strings"] as const)(
    "cancels CPU-bound %s matching and keeps the session usable",
    async (operation) => {
      const { producer, client } = await fixture();
      const value = "a".repeat(26) + "!";
      producer.overrideCall = (name) =>
        name === "list_functions"
          ? {
              data: [{ address: "0x1000", name: value, size: "0x10" }],
              next_offset: null,
            }
          : name === "list_strings"
            ? {
                data: [
                  { address: "0x3000", length: value.length, string: value },
                ],
                next_offset: null,
              }
            : undefined;
      await client.execute("health", {});
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 50);
      try {
        const result = await client.execute(
          operation,
          { pattern: "^(a+)+$", mode: "regex" },
          { signal: controller.signal },
        );
        expect(result.ok).toBe(false);
        if (!result.ok)
          expect(result.error._tag).toBe("AnalysisCancelledError");
        const recovered = await client.execute(operation, {
          pattern: "!",
          mode: "literal",
        });
        expect(recovered.ok && recovered.value.result).toHaveLength(1);
      } finally {
        clearTimeout(timer);
        await client.close();
      }
    },
    15_000,
  );
  it("bounds regex matching without caller cancellation and preserves subsequent searches", async () => {
    const { producer, client } = await fixture();
    const value = "a".repeat(40) + "!";
    producer.overrideCall = (name) =>
      name === "list_strings"
        ? {
            data: [{ address: "0x3000", length: value.length, string: value }],
            next_offset: null,
          }
        : undefined;
    try {
      const result = await client.execute("search_strings", {
        pattern: "^(a+)+$",
        mode: "regex",
      });
      expect(result.ok).toBe(false);
      if (
        result.ok ||
        !(result.error instanceof AnalysisResourceConstraintError)
      )
        throw new Error("Expected a supervised regex deadline");
      expect(result.error).toMatchObject({
        operation: "search_strings",
        resource: "cpu",
        reportedLimits: {
          matching_deadline_ms: DEFAULT_REGEX_MATCHING_DEADLINE.deadlineMs,
          matching_deadline_source: DEFAULT_REGEX_MATCHING_DEADLINE.source,
        },
      });
      expect(result.error.message).toContain(REGEX_MATCHING_DEADLINE_SETTING);
      const recovered = await client.execute("search_strings", {
        pattern: "!$",
        mode: "regex",
      });
      expect(recovered.ok && recovered.value.result).toEqual([
        expect.objectContaining({ address: "0x3000", value }),
      ]);
      if (recovered.ok)
        expect(recovered.value.limitations.join("\n")).toContain(
          REGEX_MATCHING_DEADLINE_SETTING,
        );
    } finally {
      await client.close();
    }
  }, 15_000);
});

describe("attached IDA function failure handling", () => {
  it("rejects mismatched identities and target switches rather than returning a successful observation", async () => {
    const { producer, client, target } = await fixture();
    producer.inputSha256 = "a".repeat(64);
    const mismatch = await client.execute("health", {});
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(projectAnalysisError(mismatch.error)).toMatchObject({
        code: "unreadable_output",
        retryable: false,
        message: expect.stringContaining("SHA-256"),
        remediation: { action: expect.stringContaining("headless mode") },
        details: {
          operation: "health",
          diagnostics: {
            identity_check: "attached_sha256",
            reason: expect.stringContaining(target.path),
          },
        },
      });
    }
    expect(producer.calls.map(({ name }) => name)).toEqual(["get_metadata"]);
    producer.inputSha256 = target.sha256;
    producer.beforeCall = async (name) => {
      if (name === "decompile_function") producer.imageBase = "0x2000";
    };
    const changed = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.error.message).toContain("changed");
    await client.close();
  });
  it("rejects malformed producer data, non-advancing cursors, unsupported mutation, and missing explicit addresses", async () => {
    const { producer, client } = await fixture();
    expect(
      (
        await client.execute("set_address_name", {
          address: "0x1000",
          name: "changed",
        })
      ).ok,
    ).toBe(false);
    expect(producer.connects).toBe(0);
    expect((await client.execute("xrefs", {})).ok).toBe(false);
    const invalidAddress = await client.execute("xrefs", {
      address: "not-an-address",
    });
    expect(invalidAddress.ok).toBe(false);
    if (!invalidAddress.ok)
      expect(invalidAddress.error._tag).toBe("AnalysisInputError");
    expect(producer.connects).toBe(0);
    producer.overrideCall = (name) =>
      name === "list_functions" ? { data: [], next_offset: 0 } : undefined;
    expect((await client.execute("list_procedures", {})).ok).toBe(false);
    producer.overrideCall = (name) =>
      name === "decompile_function" ? { unexpected: true } : undefined;
    const malformed = await client.execute("procedure_pseudo_code", {
      procedure: "main",
    });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error._tag).toBe("AnalysisOutputError");
    await client.close();
  });
  it("drains in-flight read-only work on cancellation before closing its proxy", async () => {
    const { producer, client } = await fixture();
    await client.execute("health", {});
    let release: (() => void) | undefined;
    let notify: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notify = resolve;
    });
    producer.beforeCall = async (name) => {
      if (name === "decompile_function") {
        notify?.();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    };
    const controller = new AbortController();
    const call = client.execute(
      "procedure_pseudo_code",
      { procedure: "main" },
      { signal: controller.signal },
    );
    await started;
    controller.abort();
    const close = client.close();
    expect(producer.closes).toBe(0);
    release?.();
    const result = await call;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error._tag).toBe("AnalysisCancelledError");
    expect((await close).ok).toBe(true);
    expect(producer.closes).toBe(1);
  });
});

const busyHealth = (busyTool?: JsonValue): JsonValue => ({
  status: "busy",
  uptime_sec: 1.041,
  ...(busyTool === undefined ? {} : { busy_tool: busyTool }),
  busy_sec: 0,
  queued_calls: 0,
});
const healthCalls = (producer: { calls: { name: string }[] }) =>
  producer.calls.filter(({ name }) => name === "server_health").length;

const expectCleanClose = async (
  producer: { closes: number },
  client: { close: () => Promise<{ ok: boolean }> },
): Promise<void> => {
  expect((await client.close()).ok, "the owned worker is released").toBe(true);
  expect(producer.closes, "the upstream connection is closed once").toBe(1);
};

describe("headless IDA transient busy health", () => {
  it("re-reads server_health until the worker reports ok", async () => {
    const { producer, client } = await fixture("headless");
    let busyReads = 2;
    producer.overrideCall = (name) =>
      name === "server_health" && busyReads-- > 0
        ? busyHealth("config_json_get")
        : undefined;

    const result = await client.execute("health", {});

    expect(result.ok, "a transient busy worker is waited out").toBe(true);
    expect(
      healthCalls(producer),
      "two busy reads and the ok read that settles the identity",
    ).toBe(3);
    await expectCleanClose(producer, client);
  });

  it("returns a retryable timeout naming the busy tool at the registration deadline", async () => {
    const { producer, client } = await fixture("headless", 300);
    const busy = busyHealth("config_json_get");
    producer.overrideCall = (name) =>
      name === "server_health" ? busy : undefined;
    const started = Date.now();

    const result = await client.execute("health", {});
    const elapsed = Date.now() - started;

    if (result.ok) throw new Error("expected a busy timeout");
    expect(result.error._tag, "the neutral timeout class is used").toBe(
      "AnalysisTimeoutError",
    );
    const projected = projectAnalysisError(result.error);
    expect(projected.code, "the outcome is a provider timeout").toBe(
      "provider_timeout",
    );
    expect(projected.retryable, "the caller may retry").toBe(true);
    expect(
      projected.details,
      "the timeout is attributed to the requested operation",
    ).toMatchObject({
      operation: "health",
      timeout_ms: 300,
    });
    expect(
      projected.message,
      "the public error message names the busy tool",
    ).toContain("config_json_get");
    expect(
      `${result.error.message} ${projected.message}`,
      "no Hopper wording leaks in",
    ).not.toContain("Hopper");
    expect(
      result.error.cause,
      "reattribution preserves the producing timeout",
    ).toMatchObject({
      _tag: "AnalysisTimeoutError",
      operation: "server_health",
      cause: busy,
      diagnostics: { busy_tool: "config_json_get" },
    });
    expect(
      elapsed,
      "the wait runs to the deadline, not less",
    ).toBeGreaterThanOrEqual(290);
    expect(
      healthCalls(producer),
      "reads are spaced by the retry delay, not a tight loop",
    ).toBeLessThanOrEqual(6);
    await expectCleanClose(producer, client);
  });

  it("never invents a busy tool the worker did not report", async () => {
    const { producer, client } = await fixture("headless", 300);
    producer.overrideCall = (name) =>
      name === "server_health" ? busyHealth() : undefined;

    const result = await client.execute("health", {});

    if (result.ok) throw new Error("expected a busy timeout");
    expect(
      projectAnalysisError(result.error).details,
      "the public operation stays independent of an omitted busy tool",
    ).toMatchObject({
      operation: "health",
    });
    expect(result.error.diagnostics).toMatchObject({ busy_tool: "unknown" });
    expect(projectAnalysisError(result.error).message).toContain(
      "busy tool was unknown",
    );
    await expectCleanClose(producer, client);
  });

  it.each([
    ["free-form text", "token=abc123 /private<home> secret"],
    ["an over-long name", "x".repeat(200)],
  ])(
    "reports %s from the worker as unknown instead of echoing it",
    async (_label, tool) => {
      const { producer, client } = await fixture("headless", 300);
      producer.overrideCall = (name) =>
        name === "server_health" ? busyHealth(tool) : undefined;

      const result = await client.execute("health", {});

      if (result.ok) throw new Error("expected a busy timeout");
      expect(
        projectAnalysisError(result.error).details,
        "only a tool-name-shaped value is repeated",
      ).toMatchObject({
        operation: "health",
      });
      expect(result.error.diagnostics).toMatchObject({ busy_tool: "unknown" });
      expect(
        projectAnalysisError(result.error).message,
        "the producer text never reaches the public error message",
      ).not.toContain(tool);
      await expectCleanClose(producer, client);
    },
  );

  it("ends the wait at once when the caller aborts", async () => {
    const { producer, client } = await fixture("headless", 30_000);
    producer.overrideCall = (name) =>
      name === "server_health" ? busyHealth("config_json_get") : undefined;
    const controller = new AbortController();
    const started = Date.now();
    const call = client.execute("health", {}, { signal: controller.signal });
    while (healthCalls(producer) < 2) {
      if (Date.now() - started > 5_000) throw new Error("never polled");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    controller.abort();
    const result = await call;

    if (result.ok) throw new Error("expected cancellation");
    expect(result.error._tag, "cancellation keeps today's outcome").toBe(
      "AnalysisCancelledError",
    );
    expect(
      Date.now() - started,
      "the wait does not run to the registration deadline",
    ).toBeLessThan(5_000);
    await expectCleanClose(producer, client);
  });
});

describe("headless IDA busy health after an operation", () => {
  const withInventory = (
    producer: RecordingIdaMcp,
    afterObservation: (read: number) => JsonValue | undefined,
  ) => {
    let health = 0;
    producer.overrideCall = (name) => {
      if (name === "list_funcs")
        return [
          {
            data: [{ addr: "0x1000", name: "main", size: "0x20" }],
            next_offset: null,
          },
        ];
      if (name !== "server_health") return undefined;
      health += 1;
      return health < 2 ? undefined : afterObservation(health);
    };
  };

  it("waits out a busy observation taken after the operation", async () => {
    const { producer, client } = await fixture("headless");
    withInventory(producer, (read) =>
      read === 2 ? busyHealth("config_json_get") : undefined,
    );

    const result = await client.execute("list_procedures", {});

    expect(result.ok, "the operation succeeds once the worker settles").toBe(
      true,
    );
    expect(healthCalls(producer), "before, busy after, ok after").toBe(3);
    await expectCleanClose(producer, client);
  });

  it("maps a cancellation during that wait to cancelled", async () => {
    const { producer, client } = await fixture("headless", 30_000);
    withInventory(producer, () => busyHealth("config_json_get"));
    const controller = new AbortController();
    const call = client.execute(
      "list_procedures",
      {},
      { signal: controller.signal },
    );
    const started = Date.now();
    while (healthCalls(producer) < 3) {
      if (Date.now() - started > 5_000) throw new Error("never polled");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    controller.abort();
    const result = await call;

    if (result.ok) throw new Error("expected cancellation");
    expect(result.error._tag, "the after-observation wait is cancellable").toBe(
      "AnalysisCancelledError",
    );
    await expectCleanClose(producer, client);
  });
});

describe("headless IDA non-busy health payloads", () => {
  it.each([
    ["an unknown status", { status: "starting" }],
    ["a non-string busy_tool", busyHealth(5)],
    ["a payload without a status", { uptime_sec: 1 }],
  ])(
    "keeps %s as unreadable output without waiting",
    async (_label, payload) => {
      const { producer, client } = await fixture("headless");
      producer.overrideCall = (name) =>
        name === "server_health" ? jsonValueSchema.parse(payload) : undefined;

      const result = await client.execute("health", {});

      if (result.ok) throw new Error("expected unreadable output");
      expect(
        projectAnalysisError(result.error).code,
        "only the narrow busy shape enters the wait",
      ).toBe("unreadable_output");
      expect(healthCalls(producer), "no re-read happened").toBe(1);
      await expectCleanClose(producer, client);
    },
  );

  it("keeps the busy-shape reason when a busy payload is invalid", async () => {
    const { producer, client } = await fixture("headless");
    producer.overrideCall = (name) =>
      name === "server_health" ? busyHealth(5) : undefined;

    const result = await client.execute("health", {});

    if (result.ok) throw new Error("expected unreadable output");
    expect(
      projectAnalysisError(result.error).details,
      "the diagnostic names the invalid busy_tool, not the ok-schema fields",
    ).toMatchObject({ reason: expect.stringContaining("busy_tool") });
    expect(
      JSON.stringify(projectAnalysisError(result.error).details),
      "the generic ok-schema field errors are not reported for a busy payload",
    ).not.toContain("input_path");
    await expectCleanClose(producer, client);
  });

  it("stops waiting as soon as a later read is malformed", async () => {
    const { producer, client } = await fixture("headless");
    let reads = 0;
    producer.overrideCall = (name) =>
      name === "server_health"
        ? reads++ === 0
          ? busyHealth("config_json_get")
          : busyHealth(5)
        : undefined;

    const result = await client.execute("health", {});

    if (result.ok) throw new Error("expected unreadable output");
    expect(
      projectAnalysisError(result.error).code,
      "a malformed re-read is not treated as busy",
    ).toBe("unreadable_output");
    expect(
      healthCalls(producer),
      "exactly the busy read and the bad read",
    ).toBe(2);
    await expectCleanClose(producer, client);
  });
});

describe("IDA compatibility profile mismatch", () => {
  it("reports the native profile for an incompatible catalog", async () => {
    const { producer, client } = await fixture("attached", 1000, "native");
    producer.tools = [];
    const result = await client.execute("health", {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected incompatible native catalog");
    expect(projectAnalysisError(result.error).details).toMatchObject({
      diagnostics: {
        mode: "attached",
        expected_profile: "native",
        missing_tools: expect.arrayContaining(["decompile"]),
      },
    });
    expect(producer.calls).toEqual([]);
    expect((await client.close()).ok).toBe(true);
  });

  it("names every missing tool so the caller can identify the upstream profile", async () => {
    const { producer, client } = await fixture("headless");
    producer.tools = [
      "idb_open",
      "idb_list",
      "server_health",
      "list_funcs",
      "lookup_funcs",
      "find_regex",
      "decompile",
      "disasm",
      "callees",
      "xrefs_to",
    ];
    const result = await client.execute("health", {});
    expect(result.ok, "an incomplete profile cannot serve analysis").toBe(
      false,
    );
    if (result.ok) return;
    const projected = projectAnalysisError(result.error);
    expect(
      projected.details,
      "the absent tool and the expected profile are both reported",
    ).toMatchObject({
      provider_id: "ida",
      diagnostics: {
        mode: "headless",
        expected_profile: "database-supervisor",
        missing_tools: ["idb_close"],
      },
    });
  });

  it("reports the legacy profile when an attached producer serves modern tools", async () => {
    const { producer, client } = await fixture("attached");
    producer.tools = ["server_health", "lookup_funcs", "decompile", "disasm"];
    const result = await client.execute("health", {});
    expect(result.ok, "an incomplete profile cannot serve analysis").toBe(
      false,
    );
    if (result.ok) return;
    expect(
      projectAnalysisError(result.error).details,
      "attached mode names the legacy profile it expected",
    ).toMatchObject({
      diagnostics: { mode: "attached", expected_profile: "legacy-1.4" },
    });
  });
});

describe("headless IDA lifecycle boundaries", () => {
  it("never closes an unowned worker even when open echoes the requested private identity", async () => {
    const { producer, client } = await fixture("headless");
    producer.owned = false;
    expect((await client.execute("health", {})).ok).toBe(false);
    const closed = await client.close();
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error.cleanupIncomplete).toBe(true);
    expect(producer.calls.some(({ name }) => name === "idb_close")).toBe(false);
  });
});

describe("headless IDA session ownership and cleanup", () => {
  it("shares an in-flight close across concurrent cleanup callers", async () => {
    const { producer, client } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);

    let release: (() => void) | undefined;
    let notify: (() => void) | undefined;
    const closeStarted = new Promise<void>((resolve) => {
      notify = resolve;
    });
    producer.beforeCall = async (name) => {
      if (name !== "idb_close") return;
      notify?.();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };

    const first = client.close();
    await closeStarted;
    const second = client.close();
    release?.();
    const results = await Promise.all([first, second]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      producer.calls.filter(({ name }) => name === "idb_close"),
    ).toHaveLength(1);
    expect(producer.closes).toBe(1);
  });

  it("retains the workspace after an unconfirmed open, even when inventory is empty, and never retries startup implicitly", async () => {
    const { producer, client, root } = await fixture("headless");
    producer.beforeCall = async (name) => {
      if (name === "idb_open")
        throw new Error("Timed out while the worker may still be opening");
    };
    expect((await client.execute("health", {})).ok).toBe(false);
    expect((await client.execute("health", {})).ok).toBe(false);
    expect(
      producer.calls.filter(({ name }) => name === "idb_open"),
    ).toHaveLength(1);
    const closed = await client.close();
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.error.cleanupIncomplete).toBe(true);
    expect(
      (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
    ).toBe(true);
    expect(producer.closes).toBe(0);
  });
  it("opens a private digest-verified copy, scopes requests, closes without saving, and removes only its workspace", async () => {
    const { producer, client, root, target } = await fixture("headless");
    const original = await readFile(target.path);
    const result = await client.execute("analyze_function", {
      procedure: "main",
    });
    if (!result.ok) throw result.error;
    expect(producer.inputPath).not.toBe(target.path);
    expect(Buffer.compare(await readFile(producer.inputPath), original)).toBe(
      0,
    );
    expect(
      functionDossierSchema
        .parse(result.value.result)
        .limitations.some((value) => value.includes("Direct callers")),
    ).toBe(true);
    const open = producer.calls.find(({ name }) => name === "idb_open");
    expect(open?.args).toMatchObject({
      mode: "force_headless",
      run_auto_analysis: true,
    });
    for (const call of producer.calls.filter(
      ({ name }) => !["idb_open", "idb_list"].includes(name),
    ))
      expect(call.args.database).toBe(producer.database);
    expect((await client.close()).ok).toBe(true);
    expect(
      producer.calls.find(({ name }) => name === "idb_close")?.args.save,
    ).toBe(false);
    expect(await readdir(root)).toEqual(["target.elf"]);
    expect(Buffer.compare(await readFile(target.path), original)).toBe(0);
  });
  it("retains the private workspace and reports cleanup failure when worker release is unverified", async () => {
    const { producer, client, root } = await fixture("headless");
    await client.execute("health", {});
    const sessionId = producer.database;
    producer.failClose = true;
    const result = await client.close();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.cleanupIncomplete).toBe(true);
    expect(result).toMatchObject(
      reportsSessions({
        session_id: sessionId,
        backend: "worker",
        owned: true,
        input_path: producer.inputPath,
      }),
    );
    expect(
      (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
    ).toBe(true);
  });
});

describe("headless IDA blanked-identity inventory rows", () => {
  it("releases cleanly when the closed worker lingers in inventory without an identity", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    let released = false;
    producer.beforeCall = async (name) => {
      if (name === "idb_close") released = true;
    };
    // A worker observed mid-teardown: identity cleared, private input retained.
    producer.overrideCall = (name) =>
      name === "idb_list" && released
        ? {
            sessions: [
              {
                session_id: "",
                input_path: producer.inputPath,
                owned: false,
                backend: "worker",
                is_active: false,
              },
            ],
            count: 1,
          }
        : undefined;

    expect((await client.close()).ok).toBe(true);
    expect(await readdir(root)).toEqual(["target.elf"]);
  });

  it("still reports a same-input gui row whose identity is blank", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    let released = false;
    producer.beforeCall = async (name) => {
      if (name === "idb_close") released = true;
    };
    // A gui binding belongs to an IDA instance REA does not control, so the
    // blanked-identity exception must not reach it.
    producer.overrideCall = (name) =>
      name === "idb_list" && released
        ? {
            sessions: [
              {
                session_id: "",
                input_path: producer.inputPath,
                owned: false,
                backend: "gui",
                is_active: false,
              },
            ],
            count: 1,
          }
        : undefined;

    const result = await client.close();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.cleanupIncomplete).toBe(true);
    expect(
      (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
    ).toBe(true);
  });

  it("still reports a same-input peer that keeps a session identity", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    let released = false;
    producer.beforeCall = async (name) => {
      if (name === "idb_close") released = true;
    };
    producer.overrideCall = (name) =>
      name === "idb_list" && released
        ? {
            sessions: [
              {
                session_id: "unrelated-live-peer",
                input_path: producer.inputPath,
                owned: false,
                backend: "worker",
                is_active: false,
              },
            ],
            count: 1,
          }
        : undefined;

    const result = await client.close();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.cleanupIncomplete).toBe(true);
    expect(
      (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
    ).toBe(true);
  });
});

describe("headless IDA reaped worker cleanup", () => {
  it("recovers a reaped worker only after inventory confirms its session and private input are absent", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    const sessionId = producer.database;
    producer.beforeCall = async (name) => {
      if (name === "idb_close") producer.database = undefined;
    };
    producer.overrideCall = (name) =>
      name === "idb_close"
        ? { error: `Session not found: ${sessionId}` }
        : undefined;

    expect((await client.close()).ok).toBe(true);
    expect(producer.calls.map(({ name }) => name).slice(-2)).toEqual([
      "idb_close",
      "idb_list",
    ]);
    expect(producer.closes).toBe(1);
    expect(await readdir(root)).toEqual(["target.elf"]);
  });

  it("retains resources when an absent-session close is followed by a live private-input peer", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    const sessionId = producer.database;
    producer.beforeCall = async (name) => {
      if (name === "idb_close") producer.database = undefined;
      if (name === "idb_list" && producer.database === undefined) {
        producer.database = "unrelated-live-peer";
        producer.owned = false;
      }
    };
    producer.overrideCall = (name) =>
      name === "idb_close"
        ? { error: `Session not found: ${sessionId}` }
        : undefined;

    const result = await client.close();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.cleanupIncomplete).toBe(true);
    // The released session must not be named as the remaining worker.
    expect(result).toMatchObject(reportsSessions(LIVE_PEER));
    expect(producer.closes).toBe(0);
    expect(
      (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
    ).toBe(true);

    // A retry whose inventory is unavailable keeps the observed blocker.
    producer.beforeCall = async (name) => {
      if (name === "idb_list") throw new Error("inventory unavailable");
    };
    const retried = await client.close();
    expect(retried.ok).toBe(false);
    expect(retried).toMatchObject(reportsSessions(LIVE_PEER));
  });

  it("retries independent inventory verification after an absent-session response", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    const sessionId = producer.database;
    let inventoryUnavailable = true;
    producer.beforeCall = async (name) => {
      if (name === "idb_close") producer.database = undefined;
      if (name === "idb_list" && inventoryUnavailable) {
        inventoryUnavailable = false;
        throw new Error("Inventory temporarily unavailable");
      }
    };
    producer.overrideCall = (name) =>
      name === "idb_close"
        ? { error: `Session not found: ${sessionId}` }
        : undefined;

    expect((await client.close()).ok).toBe(false);
    expect(producer.closes).toBe(0);
    expect((await client.close()).ok).toBe(true);
    expect(
      producer.calls.filter(({ name }) => name === "idb_close"),
    ).toHaveLength(1);
    expect(producer.closes).toBe(1);
    expect(await readdir(root)).toEqual(["target.elf"]);
  });

  it("does not treat a different missing session identity as proof of release", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    producer.beforeCall = async (name) => {
      if (name === "idb_close") producer.database = undefined;
    };
    producer.overrideCall = (name) =>
      name === "idb_close"
        ? { error: "Session not found: another-session" }
        : undefined;

    const result = await client.close();
    expect(result.ok).toBe(false);
    expect(
      producer.calls.filter(({ name }) => name === "idb_list"),
    ).toHaveLength(1);
    expect(producer.closes).toBe(0);
    expect(
      (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
    ).toBe(true);
  });
});

/** A rejected open response, with helpers for separately inventoried workers. */
const rejectedOpenFixture = async () => {
  const { producer, client } = await fixture("headless");
  producer.overrideCall = (name) =>
    name === "idb_open" ? { error: "open did not complete" } : undefined;
  expect((await client.execute("health", {})).ok).toBe(false);
  const open = producer.calls.find(({ name }) => name === "idb_open")?.args;
  const entry = (session_id: string, owned: boolean) => ({
    session_id,
    input_path: String(open?.input_path),
    owned,
    backend: "worker",
    is_active: true,
  });
  return {
    producer,
    client,
    requested: String(open?.preferred_session_id),
    entry,
  };
};

describe("headless IDA cleanup diagnostics", () => {
  it("does not name a worker whose close was confirmed when inventory then fails", async () => {
    const { producer, client } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    producer.beforeCall = async (name) => {
      if (name === "idb_list") throw new Error("inventory unavailable");
    };

    const result = await client.close();
    expect(result.ok).toBe(false);
    expect(producer.calls.map(({ name }) => name)).toContain("idb_close");
    expect(result).toMatchObject(reportsSessions());
  });

  it("retains peers and confirmed ownership from successful startup when close fails", async () => {
    const { producer, client } = await fixture("headless");
    producer.overrideCall = (name) => {
      if (name === "idb_list")
        return {
          sessions: [
            {
              session_id: String(producer.database),
              input_path: producer.inputPath,
              owned: true,
              backend: "worker",
              is_active: true,
            },
            {
              session_id: "startup-peer",
              input_path: producer.inputPath,
              owned: false,
              backend: "worker",
              is_active: false,
            },
          ],
        };
      if (name === "idb_close") return { error: "close rejected" };
      return undefined;
    };
    expect((await client.execute("health", {})).ok).toBe(true);
    const result = await client.close();
    expect(result).toMatchObject(
      reportsSessions(
        {
          session_id: producer.database,
          backend: "worker",
          owned: true,
          input_path: producer.inputPath,
        },
        {
          session_id: "startup-peer",
          backend: "worker",
          owned: false,
          input_path: producer.inputPath,
          is_active: false,
        },
      ),
    );
  });

  it("preserves an observed conflicting input binding after close", async () => {
    const { producer, client } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    const requested = String(producer.database);
    producer.overrideCall = (name) =>
      name === "idb_list"
        ? {
            sessions: [
              {
                session_id: requested,
                input_path: "/different/input",
                owned: false,
                backend: "worker",
                is_active: true,
              },
            ],
          }
        : undefined;
    const result = await client.close();
    expect(result).toMatchObject(
      reportsSessions({
        session_id: requested,
        backend: "worker",
        owned: false,
        input_path: "/different/input",
      }),
    );
  });

  it("keeps peers seen beside the requested worker when its close fails", async () => {
    const { producer, client, requested, entry } = await rejectedOpenFixture();
    producer.overrideCall = (name) => {
      if (name === "idb_list")
        return {
          sessions: [
            entry(requested, true),
            entry("unrelated-live-peer", false),
          ],
        };
      if (name === "idb_close") return { error: "close rejected" };
      return undefined;
    };

    const result = await client.close();
    expect(result.ok).toBe(false);
    expect(result).toMatchObject(
      reportsSessions(
        { session_id: requested, backend: "worker", owned: true },
        LIVE_PEER,
      ),
    );
  });
});

describe("headless IDA cleanup diagnostics for observed peers", () => {
  it("drops the requested worker from blockers once its close is confirmed", async () => {
    const { producer, client, requested, entry } = await rejectedOpenFixture();
    let inventories = 0;
    producer.beforeCall = async (name) => {
      if (name === "idb_list" && ++inventories > 1)
        throw new Error("inventory unavailable");
    };
    producer.overrideCall = (name) => {
      if (name === "idb_list")
        return {
          sessions: [
            entry(requested, true),
            entry("unrelated-live-peer", false),
          ],
        };
      if (name === "idb_close")
        return {
          success: true,
          session_id: requested,
          saved: false,
          owned: true,
          backend: "worker",
        };
      return undefined;
    };

    const result = await client.close();
    expect(result.ok).toBe(false);
    expect(result).toMatchObject(reportsSessions(LIVE_PEER));
  });

  it("reports a blocking GUI session by its backend", async () => {
    const { producer, client } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    const sessionId = producer.database;
    producer.overrideCall = (name) => {
      if (name === "idb_close")
        return { error: `Session not found: ${sessionId}` };
      if (name === "idb_list")
        return {
          sessions: [
            {
              session_id: "",
              input_path: producer.inputPath,
              owned: false,
              backend: "gui",
              is_active: true,
            },
          ],
        };
      return undefined;
    };

    const result = await client.close();
    expect(result.ok).toBe(false);
    expect(result).toMatchObject(
      reportsSessions({ session_id: "", backend: "gui", owned: false }),
    );
  });
});

/** A completed open response is not proof that its private Worker was ever released. */
describe("headless IDA unresolved successful-open ownership", () => {
  it.each(["matching", "foreign-input", "malformed"] as const)(
    "retains the private input after %s success with incomplete initial discovery",
    async (kind) => {
      const { producer, client, root } = await fixture("headless");
      let hidden = true;
      let ownedId: string | undefined;
      let privateInput: string | undefined;
      producer.beforeCall = async (name, args) => {
        if (name !== "idb_open") return;
        ownedId = z.string().parse(args.preferred_session_id);
        privateInput = z.string().parse(args.input_path);
        producer.database = ownedId;
        producer.inputPath = privateInput;
      };
      producer.overrideCall = (name) => {
        if (name === "idb_open") {
          const originalId = z.string().parse(ownedId);
          const originalInput = z.string().parse(privateInput);
          if (kind === "foreign-input")
            return {
              success: true,
              session: {
                session_id: "foreign-session",
                input_path: "/foreign/input",
              },
            };
          if (kind === "malformed")
            return { success: true, session: { session_id: originalId } };
          return {
            success: true,
            session: { session_id: originalId, input_path: originalInput },
          };
        }
        if (name === "idb_list" && hidden) return { sessions: [] };
        return undefined;
      };

      expect((await client.execute("health", {})).ok).toBe(false);
      const incomplete = await client.close();
      expect(incomplete.ok).toBe(false);
      if (!incomplete.ok) expect(incomplete.error.cleanupIncomplete).toBe(true);
      expect(producer.closes).toBe(0);
      expect(producer.database).toBe(ownedId);
      expect(
        (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
      ).toBe(true);
      expect(producer.calls.some(({ name }) => name === "idb_close")).toBe(
        false,
      );

      // A later positive private ownership record permits ordinary save=false
      // cleanup, without ever adopting the foreign open-response identity.
      hidden = false;
      expect((await client.close()).ok).toBe(true);
      expect(producer.calls.filter(({ name }) => name === "idb_close")).toEqual(
        [{ name: "idb_close", args: { database: ownedId, save: false } }],
      );
      expect(producer.closes).toBe(1);
      expect(await readdir(root)).toEqual(["target.elf"]);
    },
  );

  it("preserves cleanup after a completed, explicit idb_open rejection", async () => {
    const { producer, client, root } = await fixture("headless");
    producer.overrideCall = (name) =>
      name === "idb_open"
        ? { error: "Input was rejected before creating a session" }
        : undefined;

    expect((await client.execute("health", {})).ok).toBe(false);
    expect((await client.close()).ok).toBe(true);
    expect(producer.calls.some(({ name }) => name === "idb_close")).toBe(false);
    expect(producer.closes).toBe(1);
    expect(await readdir(root)).toEqual(["target.elf"]);
  });

  it("retains cleanup when a rejected open leaves the requested ID on another input", async () => {
    const { producer, client, requested } = await rejectedOpenFixture();
    producer.overrideCall = (name) =>
      name === "idb_list"
        ? {
            sessions: [
              {
                session_id: requested,
                input_path: "/different/input",
                owned: false,
                backend: "worker",
                is_active: true,
              },
            ],
          }
        : undefined;

    const result = await client.close();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.cleanupIncomplete).toBe(true);
    expect(producer.closes).toBe(0);
  });
});

describe("headless IDA cleanup verification", () => {
  it("retries failed worker release through the retained connection before removing its workspace", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    producer.failClose = true;
    expect((await client.close()).ok).toBe(false);
    expect(producer.closes).toBe(0);
    expect(
      (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
    ).toBe(true);
    producer.failClose = false;
    expect((await client.close()).ok).toBe(true);
    expect(
      producer.calls.filter(({ name }) => name === "idb_close"),
    ).toHaveLength(2);
    expect(producer.closes).toBe(1);
    expect(await readdir(root)).toEqual(["target.elf"]);
  });
  it("retries post-close inventory verification without closing an already released database again", async () => {
    const { producer, client, root } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    let inventoryFails = true;
    producer.beforeCall = async (name) => {
      if (
        name === "idb_list" &&
        producer.database === undefined &&
        inventoryFails
      )
        throw new Error(
          "Worker inventory unavailable after acknowledged close",
        );
    };
    expect((await client.close()).ok).toBe(false);
    expect(producer.closes).toBe(0);
    expect(
      (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
    ).toBe(true);
    inventoryFails = false;
    expect((await client.close()).ok).toBe(true);
    expect(
      producer.calls.filter(({ name }) => name === "idb_close"),
    ).toHaveLength(1);
    expect(await readdir(root)).toEqual(["target.elf"]);
  });
  it("releases a privately owned worker after malformed open output using verified session inventory", async () => {
    const { producer, client, root } = await fixture("headless");
    let ownedId: string | undefined;
    producer.beforeCall = async (name, args) => {
      if (name === "idb_open") {
        ownedId = z.string().parse(args.preferred_session_id);
        producer.database = ownedId;
        producer.inputPath = z.string().parse(args.input_path);
      }
    };
    producer.overrideCall = (name) =>
      name === "idb_open"
        ? jsonValueSchema.parse({
            success: true,
            session: { session_id: producer.database },
          })
        : undefined;
    expect((await client.execute("health", {})).ok).toBe(false);
    expect((await client.close()).ok).toBe(true);
    expect(ownedId).toEqual(expect.any(String));
    expect(
      producer.calls.find(({ name }) => name === "idb_close")?.args.database,
    ).toBe(ownedId);
    expect(await readdir(root)).toEqual(["target.elf"]);
  });
});

it("retains a conflicting requested session ID during pre-close recovery", async () => {
  const { producer, client, root } = await fixture("headless");
  producer.overrideCall = (name) =>
    name === "idb_list"
      ? {
          sessions: [
            {
              session_id: String(producer.database),
              input_path: "/conflicting/input",
              owned: true,
              backend: "worker",
              is_active: false,
            },
          ],
        }
      : undefined;
  expect((await client.execute("health", {})).ok).toBe(false);
  const requested = String(producer.database);
  const result = await client.close();
  expect(result).toMatchObject(
    reportsSessions({
      session_id: requested,
      input_path: "/conflicting/input",
      owned: true,
      backend: "worker",
      is_active: false,
    }),
  );
  expect(producer.calls.some(({ name }) => name === "idb_close")).toBe(false);
  expect(
    (await readdir(root)).some((name) => name.startsWith("rea-ida-")),
  ).toBe(true);
});

it.each(["unavailable", "malformed"] as const)(
  "does not invent a worker after explicit rejection and %s inventory",
  async (kind) => {
    const { producer, client } = await fixture("headless");
    producer.overrideCall = (name) =>
      name === "idb_open"
        ? { error: "rejected before worker creation" }
        : name === "idb_list" && kind === "malformed"
          ? {}
          : undefined;
    expect((await client.execute("health", {})).ok).toBe(false);
    producer.beforeCall = async (name) => {
      if (name === "idb_list" && kind === "unavailable")
        throw new Error("inventory unavailable");
    };
    const result = await client.close();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected retained cleanup");
    expect(result.error).not.toHaveProperty("diagnostics.upstream_sessions");
  },
);

it.each(["idb_close", "idb_list", "connection_close"])(
  "preserves transport stderr through cleanup at %s",
  async (stage) => {
    const { producer, client } = await fixture("headless");
    expect((await client.execute("health", {})).ok).toBe(true);
    const failure = new ProviderAdapterError("ida", "transport", {
      diagnostics: {
        reason: "upstream transport closed",
      },
      capturedOutput: {
        stdout: "",
        stderr: "IDA shutdown diagnostic",
        truncated: false,
      },
    });
    const originalClose = producer.close.bind(producer);
    producer.beforeCall = async (name) => {
      if (name === stage) throw failure;
    };
    if (stage === "connection_close")
      producer.close = async () => {
        throw failure;
      };
    try {
      const result = await client.close();
      if (result.ok) throw new Error("expected cleanup failure");
      expect(result.error.capturedOutput?.stderr).toBe(
        "IDA shutdown diagnostic",
      );
      expect(result.error.diagnostics).toMatchObject({
        failure_reason: "upstream transport closed",
      });
      expect(result.error.cleanupIncomplete).toBe(true);
    } finally {
      delete producer.beforeCall;
      producer.close = originalClose;
      await client.close();
    }
  },
);

it("binds retained transport diagnostics to the requested operation and recovery", async () => {
  const { producer, client } = await fixture("attached");
  await client.execute("health", {});
  producer.beforeCall = async (name) => {
    if (name === "list_functions")
      throw new ProviderAdapterError("ida", "transport", {
        diagnostics: { reason: "upstream closed" },
        capturedOutput: {
          stdout: "",
          stderr: "IDA diagnostic",
          truncated: false,
        },
      });
  };
  const result = await client.execute("list_procedures", {});
  if (result.ok) throw new Error("expected upstream failure");
  expect(projectAnalysisError(result.error)).toMatchObject({
    details: {
      operation: "list_procedures",
      diagnostics: {
        reason: "upstream closed",
        recovery: expect.stringContaining("docs/ida-provider.md"),
      },
      captured_output: { stderr: "IDA diagnostic" },
    },
  });
  await client.close();
});

describe("attached IDA legacy string inventory", () => {
  it("fetches legacy strings and literal searches in single upstream calls", async () => {
    const { producer, client } = await fixture();
    const all = Array.from({ length: 250 }, (_, i) => ({
      address: `0x${(0x3000 + i).toString(16)}`,
      length: 5,
      string: `hello-${i}`,
    }));
    producer.overrideCall = (name, args) => {
      if (name !== "list_strings") return undefined;
      const offset = Number(args.offset ?? 0);
      const count = Number(args.count ?? 100);
      const data = count === 0 ? all : all.slice(offset, offset + count);
      return {
        data,
        next_offset:
          count === 0 || offset + count >= all.length ? null : offset + count,
      };
    };
    const listed = await client.execute("list_strings", {});
    expect(listed.ok && listed.value.result).toHaveLength(250);
    expect(
      producer.calls.filter(({ name }) => name === "list_strings")[0]?.args
        .count,
    ).toBe(0);
    expect(
      producer.calls.filter(({ name }) => name === "list_strings"),
    ).toHaveLength(1);
    await client.close();
  });
});

it("retains transport diagnostics on a cancellation regardless of stderr", async () => {
  const { producer, client } = await fixture("attached");
  await client.execute("health", {});
  const controller = new AbortController();
  producer.beforeCall = async (name) => {
    if (name === "list_functions") {
      controller.abort();
      throw new AnalysisCancelledError("list_functions", {
        cause: controller.signal.reason,
        diagnostics: { reason: "upstream closed after cancellation" },
        capturedOutput: {
          stdout: "",
          stderr: "shutdown diagnostic",
          truncated: false,
        },
      });
    }
  };
  const result = await client.execute(
    "list_procedures",
    {},
    { signal: controller.signal },
  );
  if (result.ok) throw new Error("expected cancellation");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "cancelled",
    details: {
      diagnostics: { reason: "upstream closed after cancellation" },
      captured_output: { stderr: "shutdown diagnostic" },
    },
  });
  await client.close();
});

it.each([false, null] as const)(
  "keeps valid headless readiness %s distinct from malformed output",
  async (ready) => {
    const { producer, client } = await fixture("headless");
    producer.overrideCall = (name) =>
      name === "server_health"
        ? {
            status: "ok",
            input_path: producer.inputPath,
            idb_path: `${producer.inputPath}.i64`,
            module: "target.elf",
            imagebase: "0x1000",
            auto_analysis_ready: ready,
          }
        : undefined;
    const result = await client.execute("health", {});
    if (result.ok) throw new Error("Expected an unready worker refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "capability_unavailable",
      retryable: ready === false,
      details: { diagnostics: { auto_analysis_ready: ready } },
    });
    delete producer.overrideCall;
    expect((await client.execute("health", {})).ok).toBe(true);
    await expectCleanClose(producer, client);
  },
);

it.each([false, true])(
  "preserves an established IDA provider failure with late abort=%s",
  async (lateAbort) => {
    const { producer, client } = await fixture("attached");
    expect((await client.execute("health", {})).ok).toBe(true);
    const controller = new AbortController();
    const failure = new ProviderAdapterError("ida", "transport", {
      diagnostics: { reason: "upstream closed before cancellation" },
    });
    producer.beforeCall = async (name) => {
      if (name !== "list_functions") return;
      if (lateAbort) queueMicrotask(() => controller.abort({ caller: "late" }));
      throw failure;
    };
    const result = await client.execute(
      "list_procedures",
      {},
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected provider failure");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "execution_failure",
      details: {
        operation: "list_procedures",
        diagnostics: { reason: "upstream closed before cancellation" },
      },
    });
    expect(result.error.cause).toBe(failure);
    await expectCleanClose(producer, client);
  },
);

it.each(["before", "during"] as const)(
  "preserves the exact caller abort reason %s an IDA operation",
  async (phase) => {
    const { producer, client } = await fixture(
      phase === "before" ? "attached" : "headless",
    );
    const controller = new AbortController();
    const reason = { caller: "selected opaque cancellation" };
    if (phase === "before") controller.abort(reason);
    else
      producer.beforeCall = async (name) => {
        if (name === "list_funcs") controller.abort(reason);
      };
    const result = await client.execute(
      "list_procedures",
      {},
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error).toBeInstanceOf(AnalysisCancelledError);
    expect(result.error.cause).toBe(reason);
    if (phase === "before") expect(producer.connects).toBe(0);
    else
      expect(result.error.partialObservation).toMatchObject({
        operation: "list_procedures",
      });
    await expectCleanClose(producer, client);
  },
);

it("attributes native IDA metadata timeout to the requested analysis operation", async () => {
  const { producer, client } = await fixture("attached", 1000, "native");
  producer.tools = [...nativeTools];
  const timeout = new AnalysisTimeoutError("ida_mcp_read_resource", 40, {
    diagnostics: { uri: "ida://idb/metadata" },
  });
  producer.readResource = async () => {
    throw timeout;
  };
  const result = await client.execute("procedure_pseudo_code", {
    procedure: "main",
  });
  if (result.ok) throw new Error("Expected metadata timeout");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "provider_timeout",
    details: {
      operation: "procedure_pseudo_code",
      timeout_ms: 40,
      diagnostics: { uri: "ida://idb/metadata" },
    },
    recovery: { operation: "procedure_pseudo_code" },
  });
  expect(result.error.cause).toBe(timeout);
  await expectCleanClose(producer, client);
});
