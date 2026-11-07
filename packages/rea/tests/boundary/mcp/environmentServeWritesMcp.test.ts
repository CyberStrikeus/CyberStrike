import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { describe, expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../fixtures/analysisView.js";
import {
  environmentStateServeFixture,
  writeEnvironmentServeFiles,
} from "../../fixtures/environmentServe.js";
import {
  BOOK_NOT_FOUND,
  BOTH_BOOKS_RENAMED_ROWS,
  BOOK_ROWS,
  book,
  bookClock,
  FIRST_BOOK,
  SECOND_BOOK,
  renamedBook,
} from "../../fixtures/environmentStateWrites.js";
import { referencedCreateRows } from "../../fixtures/environmentStateDerivedValues.js";
import {
  READ_BACK_TAG_ROWS,
  slugOnlySaveRows,
} from "../../fixtures/environmentStateWriteViews.js";
import { unsupportedInputLiteralSchemaError } from "../../fixtures/mcpClientSchemaConstraints.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { startListeningProcess } from "../../support/mcp/streamableHttpProcess.js";
import { processTest } from "../../support/process/processFixture.js";
import {
  jsonObjectSchema,
  type JsonValue,
} from "../../../src/domain/jsonValue.js";

const HTTP_BOUNDARY_TIMEOUT_MS = 90_000;

/** The book the first served create of "Boundary Book" makes: one second past the served clock's start. */
const BOUNDARY_BOOK = book(3, "Boundary Book", bookClock(13));

processTest(
  "preserves own JSON keys through capture, state reload and computed writes",
  async ({ processes }) => {
    const nested = JSON.parse(
      '{"__proto__":{"recorded":true},"constructor":null,"values":[false,0,""]}',
    ) as JsonValue;
    const captured = (id: number, name: string, updated = bookClock(id)) => {
      const { slug, ...fields } = book(id, name, bookClock(id), updated);
      if (typeof slug !== "string") throw new Error("Fixture book has no slug");
      return { ...fields, ["__proto__"]: slug, nested };
    };
    const first = captured(1, "First Book");
    const second = captured(2, "Second Book");
    const third = captured(3, "Third Book", bookClock(3));
    const renamed = captured(1, "Renamed Book", bookClock(5));
    const rows: readonly TimedCaptureRow[] = [
      ["GET", "/api/books", [first, second]],
      ["GET", "/api/books/1", first],
      ["GET", "/api/books/2", second],
      ["POST", "/api/books", third, 201, { name: "Third Book" }],
      ["GET", "/api/books/3", third],
      ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed Book" }],
      ["GET", "/api/books/1", renamed],
    ];
    const fixture = environmentStateServeFixture(timedCaptureEvidence(rows));
    expect(fixture.state.normalized_result).toMatchObject({
      entities: expect.arrayContaining([
        expect.objectContaining({ id: "1", fields: { ...first } }),
      ]),
    });
    const root = await createTestTempDirectory("rea-own-keys-state-mcp-");
    const files = await writeEnvironmentServeFiles(root, fixture);
    const started = await startListeningProcess(processes, [
      "environment-serve",
      files.manifestPath,
      "--evidence",
      files.capturePath,
      "--port",
      "0",
    ]);
    type StateDocument = {
      rea_state: {
        entities: Array<{ id: string; fields: Record<string, JsonValue> }>;
        [key: string]: unknown;
      };
    };
    const rpc = async (method: string, params?: unknown) =>
      (
        await fetch(new URL("/agentenv", started.url.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        })
      ).json() as Promise<{
        result?: { parts?: Array<{ data: StateDocument }> };
        error?: { code: number };
      }>;
    const document = (await rpc("data/get")).result?.parts?.[0]?.data;
    if (document === undefined)
      throw new Error("Missing served state document");
    const held = document.rea_state.entities.find(({ id }) => id === "1");
    if (held === undefined) throw new Error("Missing initial book");
    expect(Object.hasOwn(held.fields, "__proto__")).toBe(true);
    expect(held.fields.nested).toEqual(nested);
    expect(Object.hasOwn(held.fields, "constructor")).toBe(false);
    await expect(
      rpc("data/add", { parts: [{ kind: "data", data: document }] }),
    ).resolves.toMatchObject({ result: {} });
    const reloaded = (await rpc("data/get")).result?.parts?.[0]?.data;
    expect(reloaded).toEqual(document);
    const invalid = {
      rea_state: {
        ...document.rea_state,
        ["__proto__"]: "unexpected structural field",
      },
    };
    await expect(
      rpc("data/add", { parts: [{ kind: "data", data: invalid }] }),
    ).resolves.toMatchObject({ error: { code: -32602 } });
    delete held.fields["__proto__"];
    await expect(
      rpc("data/add", { parts: [{ kind: "data", data: document }] }),
    ).resolves.toMatchObject({ result: {} });
    const client = new Client({ name: "own-keys-writes", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(started.url));
    try {
      for (const [tool, args, name, id] of [
        [
          "patch_books_by_id",
          { id: "1", body: { name: "Updated Book" } },
          "Updated Book",
          "1",
        ],
        ["post_books", { body: { name: "Created Book" } }, "Created Book", "3"],
      ] as const) {
        const written = await client.callTool({ name: tool, arguments: args });
        expect(written.isError).toBeFalsy();
        const expected = {
          name,
          ["__proto__"]: name.toLowerCase().replaceAll(" ", "-"),
          nested,
        };
        expect(written.structuredContent).toMatchObject({ body: expected });
        const read = await client.callTool({
          name: "get_books_by_id",
          arguments: { id },
        });
        expect(read.structuredContent).toMatchObject({ body: expected });
        const body = jsonObjectSchema.parse(
          jsonObjectSchema.parse(read.structuredContent).body,
        );
        expect(Object.hasOwn(body, "__proto__")).toBe(true);
        expect(Object.hasOwn(body, "constructor")).toBe(false);
      }
    } finally {
      await client.close();
    }
  },
  HTTP_BOUNDARY_TIMEOUT_MS,
);

processTest(
  "keeps create response clocks separate from enriched item reads through the SDK",
  async ({ processes }) => {
    const rows = READ_BACK_TAG_ROWS;
    const root = await createTestTempDirectory("rea-write-views-sdk-");
    const files = await writeEnvironmentServeFiles(
      root,
      environmentStateServeFixture(timedCaptureEvidence(rows)),
    );
    const started = await startListeningProcess(processes, [
      "environment-serve",
      files.manifestPath,
      "--evidence",
      files.capturePath,
      "--port",
      "0",
    ]);
    const client = new Client({ name: "write-views", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(started.url));
    try {
      const { tools } = await client.listTools();
      expect(tools.map(({ name }) => name)).toEqual(
        expect.arrayContaining(["post_tags", "get_tags_by_id"]),
      );
      const created = await client.callTool({
        name: "post_tags",
        arguments: { body: { name: "Boundary Tag" } },
      });
      expect(created.isError).toBeFalsy();
      const clock = bookClock(rows.length + 1);
      expect(created.structuredContent).toMatchObject({
        body: {
          id: 3,
          name: "Boundary Tag",
          created: clock.replace("Z", ".000000000Z"),
        },
        state: { source: "state" },
      });
      expect(created.structuredContent).not.toHaveProperty(
        "body.document_count",
      );
      const read = await client.callTool({
        name: "get_tags_by_id",
        arguments: { id: "3" },
      });
      expect(read.structuredContent).toMatchObject({
        body: {
          id: 3,
          name: "Boundary Tag",
          created: clock,
          document_count: 0,
        },
      });
    } finally {
      await client.close();
    }
  },
  HTTP_BOUNDARY_TIMEOUT_MS,
);

processTest(
  "discovers empty fixed values and applies omitted recorded queries through the SDK before enforcing writes",
  async ({ processes }) => {
    const edition = (entry: typeof FIRST_BOOK) => ({
      ...entry,
      format: "HC",
    });
    const renamed = edition(renamedBook(FIRST_BOOK, "Recorded edit", 3));
    const third = edition(book(3, "Recorded third", bookClock(5)));
    const rows: TimedCaptureRow[] = [
      ["GET", "/api/books", [edition(FIRST_BOOK), edition(SECOND_BOOK)]],
      ["GET", "/api/books/1", edition(FIRST_BOOK)],
      ["GET", "/api/books/2", edition(SECOND_BOOK)],
      [
        "PATCH",
        "/api/books/1?notify=",
        renamed,
        200,
        { name: "Recorded edit" },
      ],
      ["GET", "/api/books/1", renamed],
      [
        "POST",
        "/api/books?notify=quiet",
        third,
        201,
        { name: "Recorded third", format: "" },
      ],
      ["GET", "/api/books/3", third],
    ];
    const root = await createTestTempDirectory("rea-write-schema-defaults-");
    const files = await writeEnvironmentServeFiles(
      root,
      environmentStateServeFixture(timedCaptureEvidence(rows)),
    );
    const started = await startListeningProcess(processes, [
      "environment-serve",
      files.manifestPath,
      "--evidence",
      files.capturePath,
      "--port",
      "0",
    ]);
    const client = new Client({
      name: "write-schema-defaults",
      version: "1",
    });
    await client.connect(new StreamableHTTPClientTransport(started.url));
    try {
      const { tools } = await client.listTools();
      const ajv = new Ajv2020({ strict: false, validateFormats: false });
      for (const tool of tools) {
        expect(ajv.validateSchema(tool.inputSchema)).toBe(true);
        expect(
          unsupportedInputLiteralSchemaError(tool.inputSchema, tool.name),
        ).toBeUndefined();
      }
      const update = tools.find((tool) => tool.name === "patch_books_by_id")!;
      const create = tools.find((tool) => tool.name === "post_books")!;
      expect(update.inputSchema.required).not.toContain("notify");
      expect(create.inputSchema.required).not.toContain("notify");
      expect(update.inputSchema.properties?.["notify"]).not.toHaveProperty(
        "enum",
      );
      expect(create.inputSchema.properties?.["notify"]).toMatchObject({
        enum: ["quiet"],
      });
      const omitted = await client.callTool(
        {
          name: update.name,
          arguments: { id: "2", body: { name: "Omitted query" } },
        },
        { toolDefinition: update },
      );
      expect(omitted.isError).toBeFalsy();
      expect(omitted.structuredContent).toMatchObject({
        body: { id: 2, name: "Omitted query" },
        state: { source: "state" },
      });
      const explicit = await client.callTool(
        {
          name: update.name,
          arguments: {
            id: "2",
            notify: "",
            body: { name: "Explicit empty" },
          },
        },
        { toolDefinition: update },
      );
      expect(explicit.isError).toBeFalsy();
      const refused = await client.callTool(
        {
          name: update.name,
          arguments: {
            id: "2",
            notify: "yes",
            body: { name: "Must not apply" },
          },
        },
        { toolDefinition: update },
      );
      expect(refused.isError).toBe(true);
      const read = await client.callTool({
        name: "get_books_by_id",
        arguments: { id: "2" },
      });
      expect(read.structuredContent).toMatchObject({
        body: { id: 2, name: "Explicit empty" },
      });
      const badCreate = await client.callTool(
        {
          name: create.name,
          arguments: { body: { name: "Must not create", format: "other" } },
        },
        { toolDefinition: create },
      );
      expect(badCreate.isError).toBe(true);
      const created = await client.callTool(
        {
          name: create.name,
          arguments: { body: { name: "SDK created", format: "" } },
        },
        { toolDefinition: create },
      );
      expect(created.isError).toBeFalsy();
      expect(created.structuredContent).toMatchObject({
        body: { id: 3, name: "SDK created", format: "HC" },
        state: { source: "state" },
      });
    } finally {
      await client.close();
    }
  },
  HTTP_BOUNDARY_TIMEOUT_MS,
);

describe("rea environment-serve write tools", () => {
  processTest(
    "applies a served create to the state the next read answers from, until data/reset",
    async ({ processes }) => {
      const root = await createTestTempDirectory("rea-environment-writes-mcp-");
      const files = await writeEnvironmentServeFiles(
        root,
        environmentStateServeFixture(timedCaptureEvidence(BOOK_ROWS)),
      );
      const serve = [files.manifestPath, "--evidence", files.capturePath];
      const started = await startListeningProcess(processes, [
        "environment-serve",
        ...serve,
        "--port",
        "0",
      ]);
      const client = new Client({ name: "environment-writes", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(started.url));
      try {
        const { tools } = await client.listTools();
        const names = tools.map(({ name }) => name);
        expect(names).toEqual(
          expect.arrayContaining(["post_books", "patch_books_by_id"]),
        );
        // The capture's export write targets no state type, so only confirmed writes are listed.
        expect(names).not.toContain("post_exports");
        expect(
          tools.find(({ name }) => name === "post_books")?.annotations,
        ).toMatchObject({
          readOnlyHint: false,
        });
        const created = await client.callTool({
          name: "post_books",
          arguments: { body: { name: "Boundary Book" } },
        });
        expect(created.isError).toBeFalsy();
        expect(created.structuredContent).toMatchObject({
          status: 201,
          body: BOUNDARY_BOOK,
          state: { source: "state", view: "create", id: "3" },
        });
        const read = () =>
          client.callTool({ name: "get_books_by_id", arguments: { id: "3" } });
        expect((await read()).structuredContent).toMatchObject({
          status: 200,
          body: BOUNDARY_BOOK,
          state: { source: "state", view: "item", id: "3" },
        });
        const reset = await fetch(new URL("/agentenv", started.url.origin), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "reset",
            method: "data/reset",
          }),
        });
        await expect(reset.json()).resolves.toMatchObject({ result: {} });
        // The initial state holds no third book, so the read answers the recorded absence.
        expect((await read()).structuredContent).toMatchObject({
          status: 404,
          body: BOOK_NOT_FOUND,
          state: { source: "state", view: "missing", id: "3" },
        });
      } finally {
        await client.close();
      }
    },
    HTTP_BOUNDARY_TIMEOUT_MS,
  );

  processTest(
    "rebuilds ids beside unpaired surrogates while preserving raw UTF-16 through creates and reads",
    async ({ processes }) => {
      const captured = (id: number, name: string) => ({
        ...book(id, name, bookClock(id)),
        low: `A\uDC00${String(id)}`,
        high: `A\uD800${String(id)}`,
        right: `${String(id)}\uDC00A`,
        word: "𐐀3𐐁",
        emoji: `😀${String(id)}😀`,
      });
      const first = captured(1, "First Book");
      const second = captured(2, "Second Book");
      const recorded = captured(3, "Third Book");
      const rows: readonly TimedCaptureRow[] = [
        ["GET", "/api/books", [first, second]],
        ["GET", "/api/books/1", first],
        ["GET", "/api/books/2", second],
        ["POST", "/api/books", recorded, 201, { name: "Third Book" }],
        ["GET", "/api/books/3", recorded],
      ];
      const root = await createTestTempDirectory("rea-raw-utf16-writes-mcp-");
      const files = await writeEnvironmentServeFiles(
        root,
        environmentStateServeFixture(timedCaptureEvidence(rows)),
      );
      const started = await startListeningProcess(processes, [
        "environment-serve",
        files.manifestPath,
        "--evidence",
        files.capturePath,
        "--port",
        "0",
      ]);
      const client = new Client({ name: "raw-utf16-writes", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(started.url));
      try {
        for (const id of [3, 4]) {
          const name = `Created Book ${String(id)}`;
          const expected = {
            id,
            name,
            low: `A\uDC00${String(id)}`,
            high: `A\uD800${String(id)}`,
            right: `${String(id)}\uDC00A`,
            word: "𐐀3𐐁",
            emoji: `😀${String(id)}😀`,
          };
          const created = await client.callTool({
            name: "post_books",
            arguments: { body: { name } },
          });
          expect(created.isError).toBeFalsy();
          expect(created.structuredContent).toMatchObject({
            status: 201,
            body: expected,
            state: { source: "state", view: "create", id: String(id) },
          });
          const read = await client.callTool({
            name: "get_books_by_id",
            arguments: { id: String(id) },
          });
          expect(read.isError).toBeFalsy();
          expect(read.structuredContent).toMatchObject({
            status: 200,
            body: expected,
            state: { source: "state", view: "item", id: String(id) },
          });
        }
      } finally {
        await client.close();
      }
    },
    HTTP_BOUNDARY_TIMEOUT_MS,
  );
});

processTest(
  "serves multi-row bulk responses and refuses absent targets atomically through the SDK",
  async ({ processes }) => {
    const rows: TimedCaptureRow[] = [
      ...BOTH_BOOKS_RENAMED_ROWS,
      ["DELETE", "/api/books", [{ id: 1 }, { id: 2 }], 200, { ids: [1, 2] }],
      ["GET", "/api/books/1", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books/2", BOOK_NOT_FOUND, 404],
      ["GET", "/api/books", []],
    ];
    const root = await createTestTempDirectory("rea-write-bulk-sdk-");
    const files = await writeEnvironmentServeFiles(
      root,
      environmentStateServeFixture(timedCaptureEvidence(rows)),
    );
    const started = await startListeningProcess(processes, [
      "environment-serve",
      files.manifestPath,
      "--evidence",
      files.capturePath,
      "--port",
      "0",
    ]);
    const client = new Client({
      name: "bulk-response-verification",
      version: "1",
    });
    await client.connect(new StreamableHTTPClientTransport(started.url));
    try {
      const { tools } = await client.listTools();
      const update = tools.find((tool) => tool.name === "patch_books")!;
      const deletion = tools.find((tool) => tool.name === "delete_books")!;
      const changed = await client.callTool(
        {
          name: update.name,
          arguments: { body: { ids: [2], name: "Subset" } },
        },
        { toolDefinition: update },
      );
      expect(changed.isError).toBeFalsy();
      expect(changed.structuredContent).toMatchObject({
        body: [{ id: 2, name: "Subset", created_at: SECOND_BOOK.created_at }],
      });
      const refused = await client.callTool(
        {
          name: update.name,
          arguments: { body: { ids: [2, 999], name: "Refused" } },
        },
        { toolDefinition: update },
      );
      expect(refused.isError).toBe(true);
      const unchanged = await client.callTool({
        name: "get_books_by_id",
        arguments: { id: "2" },
      });
      expect(unchanged.structuredContent).toMatchObject({
        body: { id: 2, name: "Subset" },
      });
      const both = await client.callTool(
        {
          name: update.name,
          arguments: { body: { ids: [1, 2], name: "Both" } },
        },
        { toolDefinition: update },
      );
      expect(both.isError).toBeFalsy();
      expect(both.structuredContent).toMatchObject({
        body: [
          { id: 1, name: "Both", created_at: FIRST_BOOK.created_at },
          { id: 2, name: "Both", created_at: SECOND_BOOK.created_at },
        ],
      });
      const deleted = await client.callTool(
        {
          name: deletion.name,
          arguments: { body: { ids: [2, 1] } },
        },
        { toolDefinition: deletion },
      );
      expect(deleted.isError).toBeFalsy();
      expect(deleted.structuredContent).toMatchObject({
        body: [{ id: 2 }, { id: 1 }],
      });
      const empty = await client.callTool({ name: "get_books", arguments: {} });
      expect(empty.structuredContent).toMatchObject({ body: [] });
    } finally {
      await client.close();
    }
  },
  HTTP_BOUNDARY_TIMEOUT_MS,
);

processTest.for([
  {
    label: "a create whose sent reference contradicts its response",
    rows: referencedCreateRows({
      id: 1,
      name: "Different Hall",
      floor: "ground",
    }),
    read: "get_books",
    write: "post_books",
  },
  ...[true, false].map((derivedFirst) => ({
    label: `a slug-only edit incompatible with a derived save (derived first: ${String(derivedFirst)})`,
    rows: slugOnlySaveRows(derivedFirst, true),
    read: "get_tags",
    write: "patch_tags_by_id",
  })),
])(
  "withholds $label from public tools",
  { timeout: HTTP_BOUNDARY_TIMEOUT_MS },
  async ({ rows, read, write }, { processes }) => {
    const root = await createTestTempDirectory("rea-create-reference-mcp-");
    const files = await writeEnvironmentServeFiles(
      root,
      environmentStateServeFixture(timedCaptureEvidence(rows)),
    );
    const started = await startListeningProcess(processes, [
      "environment-serve",
      files.manifestPath,
      "--evidence",
      files.capturePath,
      "--port",
      "0",
    ]);
    const client = new Client({
      name: "contradictory-reference",
      version: "1",
    });
    await client.connect(new StreamableHTTPClientTransport(started.url));
    try {
      const { tools } = await client.listTools();
      expect(tools.map(({ name }) => name)).toContain(read);
      expect(tools.map(({ name }) => name)).not.toContain(write);
    } finally {
      await client.close();
    }
  },
);
