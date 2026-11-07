import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
  timedCaptureEvidence,
  type TimedCaptureRow,
} from "../../fixtures/analysisView.js";
import { environmentStateServeFixture } from "../../fixtures/environmentServe.js";
import {
  BOOKMARK_ROWS,
  bookmark,
  TAG_ROWS,
} from "../../fixtures/environmentStateDerivedValues.js";
import {
  BOOK_NOT_FOUND,
  BOOK_ROWS,
  FIRST_BOOK,
  SECOND_BOOK,
  THIRD_BOOK,
  book,
  numberedUuid,
  renamedBook,
} from "../../fixtures/environmentStateWrites.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

/** The books environment and a probe of the application re-seeded under other ids, written as Evidence files. */
const writeCompareFiles = async (root: string) => {
  const fixture = environmentStateServeFixture(timedCaptureEvidence(BOOK_ROWS));
  const first = book(101, "First Book", "2026-10-20T09:00:00Z");
  const second = book(102, "Second Book", "2026-10-20T10:00:00Z");
  const probe = timedCaptureEvidence([
    ["GET", "/api/books", [first, second]],
    ["DELETE", "/api/books/102", "", 204],
    ["GET", "/api/books/102", BOOK_NOT_FOUND, 404],
  ]);
  const paths = {
    manifest: join(root, "manifest.json"),
    capture: join(root, "capture.json"),
    probe: join(root, "probe.json"),
  };
  await writeFile(paths.manifest, JSON.stringify(fixture.manifest));
  await writeFile(paths.capture, JSON.stringify(fixture.capture));
  await writeFile(paths.probe, JSON.stringify(probe));
  return paths;
};

/** The exact chronology and clock-format probes share one unchanged source capture. */
const writeExactClockFiles = async (
  root: string,
): Promise<Map<string, string>> => {
  const capture = timedCaptureEvidence([
    ["GET", "/api/books", [FIRST_BOOK]],
    ["GET", "/api/books/1", FIRST_BOOK],
    ["DELETE", "/api/books/1", "", 204],
    ["GET", "/api/books/1", BOOK_NOT_FOUND, 404],
  ]);
  const fixture = environmentStateServeFixture(capture);
  const chronologyProbe = (later: string, earlier: string) =>
    analysisViewCaptureEvidence(
      environmentManifestCaptureFixture([
        {
          startedDateTime: later,
          request: { method: "GET", url: "http://app.example/api/books/1" },
          response: {
            status: 404,
            content: {
              mimeType: "application/json",
              text: JSON.stringify(BOOK_NOT_FOUND),
            },
          },
        },
        {
          startedDateTime: earlier,
          request: {
            method: "DELETE",
            url: "http://app.example/api/books/1",
          },
          response: {
            status: 204,
            content: { mimeType: "application/json", text: "" },
          },
        },
      ]),
    );
  const ordered = chronologyProbe(
    "0001-01-01T00:00:00.0000000002Z",
    "0001-01-01T01:00:00.0000000001+01:00",
  );
  const legacyOrdered = chronologyProbe(
    "2026-10-20 10:00:00.0002+0100",
    "2026-10-20 09:00:00.0001+0000",
  );
  const clocks = timedCaptureEvidence([
    [
      "GET",
      "/api/books/1",
      { ...FIRST_BOOK, created_at: "0001-01-01 00:00:00.000Z" },
    ],
  ]);
  const originals = new Map<string, string>();
  for (const [name, value] of [
    ["manifest.json", fixture.manifest],
    ["capture.json", capture],
    ["order.json", ordered],
    ["legacy-order.json", legacyOrdered],
    ["clocks.json", clocks],
  ] as const) {
    const path = join(root, name);
    const text = JSON.stringify(value);
    originals.set(path, text);
    await writeFile(path, text);
  }
  return originals;
};

/** Capture-confirmed generated writes and literal/clock probes, retained as unchanged Evidence files. */
const writeValueContextFiles = async (
  root: string,
): Promise<Map<string, string>> => {
  const recorded = {
    samples: [1700000000],
    nested_samples: [[1700000000]],
    scalar_samples: 1700000000,
    sku: "product1",
    catalog: ["product1"],
    serial: numberedUuid(1),
    updated_at: [1700000000],
    nested: { updated_at: 1700000000 },
    fixed_samples: [1700000000],
  };
  const clocks = {
    ...recorded,
    updated_at: [1800000000],
    nested: { updated_at: 1800000000 },
  };
  const changed = {
    ...clocks,
    samples: [1800000000],
    nested_samples: [[1800000000]],
    scalar_samples: 1800000000,
    sku: "product2",
    catalog: ["product2"],
    serial: numberedUuid(2),
  };
  const first = { ...FIRST_BOOK, ref: numberedUuid(1) };
  const second = { ...SECOND_BOOK, ref: numberedUuid(2) };
  const third = { ...THIRD_BOOK, ref: numberedUuid(3) };
  const renamed = {
    ...renamedBook(first, "Renamed Book", 6),
    ref: numberedUuid(4),
  };
  const missing = { error: "missing", ref: numberedUuid(99) };
  const rows: TimedCaptureRow[] = [
    ["GET", "/api/config", recorded],
    ["GET", "/api/books", [first, second]],
    ["GET", "/api/books/1", first],
    ["GET", "/api/books/2", second],
    ["POST", "/api/books", third, 201, { name: "Third Book" }],
    ["GET", "/api/books/3", third],
    ["PATCH", "/api/books/1", renamed, 200, { name: "Renamed Book" }],
    ["GET", "/api/books/1", renamed],
    ["GET", "/api/books/99", missing, 404],
  ];
  const capture = timedCaptureEvidence(rows);
  const fixture = environmentStateServeFixture(capture);
  expect(fixture.state.normalized_result).toMatchObject({
    writes: expect.arrayContaining([
      expect.objectContaining({
        tool: "post_books",
        served: true,
        response: { ordinal: 4, shape: "entity", pointer: "" },
        rules: expect.arrayContaining([{ field: "ref", rule: "unique" }]),
      }),
      expect.objectContaining({
        tool: "patch_books_by_id",
        served: true,
        response: { ordinal: 6, shape: "entity", pointer: "" },
        rules: expect.arrayContaining([{ field: "ref", rule: "unique" }]),
      }),
    ]),
  });
  const generated = {
    ...book(101, "Third Book", "2026-11-01T12:00:00Z"),
    ref: numberedUuid(101),
  };
  const originals = new Map<string, string>();
  for (const [name, value] of [
    ["manifest.json", fixture.manifest],
    ["capture.json", capture],
    ["changed.json", timedCaptureEvidence([["GET", "/api/config", changed]])],
    ["clocks.json", timedCaptureEvidence([["GET", "/api/config", clocks]])],
    [
      "generated.json",
      timedCaptureEvidence([
        ["POST", "/api/books", generated, 201, { name: "Third Book" }],
        [
          "PATCH",
          "/api/books/1",
          { ...renamed, ref: numberedUuid(102) },
          200,
          { name: "Renamed Book" },
        ],
      ]),
    ],
    [
      "missing.json",
      timedCaptureEvidence([
        [
          "PATCH",
          "/api/books/99",
          { ...missing, ref: numberedUuid(100) },
          404,
          { name: "Ghost" },
        ],
      ]),
    ],
  ] as const) {
    const path = join(root, name);
    const text = JSON.stringify(value);
    originals.set(path, text);
    await writeFile(path, text);
  }
  return originals;
};

describe("rea environment-compare value context", () => {
  cliTest(
    "keeps business values and numeric measurements literal while normalizing confirmed generation and clocks",
    async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-environment-value-context-",
      );
      const originals = await writeValueContextFiles(root);
      const result = await cli.run({
        arguments: [
          "environment-compare",
          join(root, "manifest.json"),
          "--evidence",
          join(root, "capture.json"),
          "--probe",
          join(root, "changed.json"),
          "--probe",
          join(root, "clocks.json"),
          "--probe",
          join(root, "generated.json"),
          "--probe",
          join(root, "missing.json"),
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        status: "complete",
        summary: {
          probes: 4,
          steps: 5,
          equal: 3,
          agreement: 0.6,
          normalised: { generated: 2 },
        },
        probes: [
          {
            label: "changed.json",
            normalised: { generated: 0, clocks: 2, ids: 0 },
            results: [
              {
                equal: false,
                categories: ["value"],
                differences: [
                  {
                    category: "value",
                    pointer: "/samples/0",
                    live: "1800000000",
                    env: "1700000000",
                  },
                  {
                    category: "value",
                    pointer: "/nested_samples/0/0",
                    live: "1800000000",
                    env: "1700000000",
                  },
                  {
                    category: "value",
                    pointer: "/scalar_samples",
                    live: "1800000000",
                    env: "1700000000",
                  },
                  {
                    category: "value",
                    pointer: "/sku",
                    live: '"product2"',
                    env: '"product1"',
                  },
                  {
                    category: "value",
                    pointer: "/catalog/0",
                    live: '"product2"',
                    env: '"product1"',
                  },
                  {
                    category: "value",
                    pointer: "/serial",
                    live: JSON.stringify(numberedUuid(2)),
                    env: JSON.stringify(numberedUuid(1)),
                  },
                ],
              },
            ],
          },
          {
            label: "clocks.json",
            normalised: { clocks: 2, generated: 0 },
            results: [{ equal: true, differences: [] }],
          },
          {
            label: "generated.json",
            normalised: { generated: 2, ids: 1 },
            results: [
              { equal: true, differences: [] },
              { equal: true, differences: [] },
            ],
          },
          {
            label: "missing.json",
            normalised: { generated: 0 },
            results: [
              {
                tool: "patch_books_by_id",
                live_status: 404,
                env_status: 404,
                equal: false,
                differences: [
                  {
                    category: "value",
                    pointer: "/ref",
                    live: JSON.stringify(numberedUuid(100)),
                    env: JSON.stringify(numberedUuid(99)),
                  },
                ],
              },
            ],
          },
        ],
      });
      for (const [path, text] of originals)
        expect(await readFile(path, "utf8")).toBe(text);
    },
  );
});

describe("rea environment-compare recorded clock spelling", () => {
  for (const scenario of [
    {
      name: "variable fractional widths under a confirmed trimmed write plan",
      rows: TAG_ROWS,
      probe: [
        [
          "POST",
          "/api/tags",
          {
            id: numberedUuid(20),
            name: "Spare",
            createdAt: "2026-10-20T10:00:00.12345678Z",
            updatedAt: "2026-10-20T10:00:00.12345678Z",
          },
          201,
          { name: "Spare" },
        ],
      ] as const,
      generated: 0,
    },
    {
      name: "a composed bookmark URL through its creation clock",
      rows: BOOKMARK_ROWS,
      probe: [
        [
          "POST",
          "/api/bookmarks",
          bookmark(
            20,
            "https://pier.example.test/inspection",
            "Pier",
            "2026-10-20T10:00:00Z",
          ),
          201,
          { url: "https://pier.example.test/inspection", title: "Pier" },
        ],
      ] as const,
      generated: 1,
    },
  ]) {
    cliTest(`accepts ${scenario.name}`, async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-environment-derived-compare-",
      );
      const capture = timedCaptureEvidence(scenario.rows);
      const fixture = environmentStateServeFixture(capture);
      const probe = timedCaptureEvidence(scenario.probe);
      const originals = new Map<string, string>();
      for (const [name, value] of [
        ["manifest.json", fixture.manifest],
        ["capture.json", capture],
        ["probe.json", probe],
      ] as const) {
        const path = join(root, name);
        const text = JSON.stringify(value);
        originals.set(path, text);
        await writeFile(path, text);
      }
      const result = await cli.run({
        arguments: [
          "environment-compare",
          join(root, "manifest.json"),
          "--evidence",
          join(root, "capture.json"),
          "--probe",
          join(root, "probe.json"),
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        status: "complete",
        summary: { probes: 1, steps: 1, equal: 1, agreement: 1 },
        probes: [
          {
            normalised: { clocks: 2, generated: scenario.generated },
            results: [{ method: "POST", equal: true, differences: [] }],
          },
        ],
      });
      for (const [path, text] of originals)
        expect(await readFile(path, "utf8")).toBe(text);
    });
  }

  cliTest(
    "replays compact-offset submillisecond probe timestamps in exact order",
    async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-environment-legacy-chronology-",
      );
      const originals = await writeExactClockFiles(root);
      const result = await cli.run({
        arguments: [
          "environment-compare",
          join(root, "manifest.json"),
          "--evidence",
          join(root, "capture.json"),
          "--probe",
          join(root, "legacy-order.json"),
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        status: "complete",
        environment: { state: "served" },
        summary: { probes: 1, steps: 2, equal: 2, agreement: 1 },
        probes: [
          {
            label: "legacy-order.json",
            results: [
              {
                ordinal: 1,
                method: "DELETE",
                live_status: 204,
                env_status: 204,
                equal: true,
              },
              {
                ordinal: 0,
                method: "GET",
                live_status: 404,
                env_status: 404,
                equal: true,
              },
            ],
          },
        ],
      });
      for (const [path, text] of originals)
        expect(await readFile(path, "utf8")).toBe(text);
    },
  );
});

describe("rea environment-compare replay and chronology", () => {
  cliTest(
    "preserves exact probe chronology and first-century clock-format differences",
    async ({ cli }) => {
      const root = await createTestTempDirectory(
        "rea-environment-exact-clock-",
      );
      const originals = await writeExactClockFiles(root);
      const result = await cli.run({
        arguments: [
          "environment-compare",
          join(root, "manifest.json"),
          "--evidence",
          join(root, "capture.json"),
          "--probe",
          join(root, "order.json"),
          "--probe",
          join(root, "clocks.json"),
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        status: "complete",
        environment: { state: "served" },
        summary: { probes: 2, steps: 3, equal: 2 },
        probes: [
          {
            label: "order.json",
            results: [
              {
                ordinal: 1,
                method: "DELETE",
                live_status: 204,
                env_status: 204,
                equal: true,
              },
              {
                ordinal: 0,
                method: "GET",
                live_status: 404,
                env_status: 404,
                equal: true,
              },
            ],
          },
          {
            label: "clocks.json",
            results: [
              {
                categories: ["clock-format"],
                differences: [
                  {
                    category: "clock-format",
                    pointer: "/created_at",
                    live: '"0001-01-01 00:00:00.000Z"',
                  },
                ],
              },
            ],
          },
        ],
      });
      for (const [path, text] of originals)
        expect(await readFile(path, "utf8")).toBe(text);
    },
  );

  cliTest(
    "compares the served environment with a probe of the re-seeded application and prints the report",
    async ({ cli }) => {
      const files = await writeCompareFiles(
        await createTestTempDirectory("rea-environment-compare-cli-"),
      );
      const result = await cli.run({
        arguments: [
          "environment-compare",
          files.manifest,
          "--evidence",
          files.capture,
          "--probe",
          files.probe,
          "--json",
        ],
        timeoutMs: 30_000,
      });
      expect(result.exitCode).toBe(0);
      expect(result.json).toMatchObject({
        status: "complete",
        environment: { state: "served" },
        summary: { probes: 1, steps: 3, equal: 3, agreement: 1 },
        probes: [{ label: "probe.json", ids_mapped: 2 }],
      });
    },
  );

  cliTest(
    "refuses a probe that is not capture Evidence and names it",
    async ({ cli }) => {
      const files = await writeCompareFiles(
        await createTestTempDirectory("rea-environment-compare-refusal-cli-"),
      );
      const result = await cli.run({
        arguments: [
          "environment-compare",
          files.manifest,
          "--evidence",
          files.capture,
          "--probe",
          files.manifest,
          "--json",
        ],
        timeoutMs: 30_000,
      });
      expect(result.exitCode).toBe(1);
      expect(result.json).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "environment-compare",
          issues: [{ path: ["probe", 0] }],
        },
      });
    },
  );
});
