import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it as test, onTestFinished } from "vitest";
import { AndroidAnalysisService } from "../../../src/application/android/AndroidAnalysisService.js";
import { androidResultSchemas } from "../../../src/domain/android/androidAnalysis.js";
import { EvidenceIntegrityError } from "../../../src/domain/evidenceErrors.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { err } from "../../../src/domain/result.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import {
  createJadxProtocolFixture,
  verifyJadxFixtureCleanup,
} from "../../fixtures/android/jadx.js";

const INVENTORY_CLASS_COUNT = 7096;

interface RawJadxCall {
  readonly operation: string;
  readonly input?: { readonly offset?: number; readonly query?: string };
  readonly response: {
    readonly _meta?: Readonly<Record<string, unknown>>;
    readonly content?: readonly {
      readonly text?: string;
      readonly annotations?: unknown;
      readonly _meta?: Readonly<Record<string, unknown>>;
    }[];
  };
}

const callsOf = (raw: unknown): readonly RawJadxCall[] =>
  (raw as { calls?: readonly RawJadxCall[] }).calls ?? [];

const listClassCalls = (raw: unknown): readonly RawJadxCall[] =>
  callsOf(raw).filter(({ operation }) => operation === "list_classes");

const responsePage = (call: RawJadxCall): Record<string, unknown> => {
  const text = call.response.content?.[0]?.text;
  if (text === undefined) throw new Error("JADX response omitted page text");
  const page: unknown = JSON.parse(text);
  if (page === null || typeof page !== "object" || Array.isArray(page))
    throw new Error("JADX page text was not an object");
  return page as Record<string, unknown>;
};

const callMetadata = (call: RawJadxCall) => ({
  offset: call.input?.offset,
  envelope: call.response._meta,
  content: call.response.content?.[0]?._meta,
  annotations: call.response.content?.[0]?.annotations,
  fixture: responsePage(call).fixture_metadata,
});

/** Count names in complete source pages using the producer's raw JSON. */
const rawInventoryNames = (raw: unknown): number =>
  listClassCalls(raw).reduce((sum, call) => {
    const items = responsePage(call).items;
    if (!Array.isArray(items))
      throw new Error("Complete page omitted class names");
    return sum + items.length;
  }, 0);

test("delivers bounded search_android_classes Evidence while retaining the complete inventory", async () => {
  const { provider, apk, launches } = await createJadxProtocolFixture(
    "search-audit-metadata",
    undefined,
    { classCount: INVENTORY_CLASS_COUNT - 1 },
  );
  const session = createTestBinarySession(() => {
    throw new Error("APK analysis must not acquire a deep binary provider");
  });
  const server = createServer(
    { kind: "session", session },
    { androidAnalysis: provider },
  );
  const client = new Client({
    name: "android-search-inventory-budget",
    version: "1",
  });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const search = async (query: string) =>
    parseEvidence(
      (
        await client.callTool({
          name: "search_android_classes",
          arguments: { path: apk, query },
        })
      ).structuredContent,
    );

  const single = await search("Target");
  expect(
    androidResultSchemas.search_android_classes.parse(single.normalized_result),
  ).toMatchObject({
    query: "Target",
    total_classes: INVENTORY_CLASS_COUNT,
    matches: ["fixture.Target"],
    coverage: "complete",
  });
  // The inline raw record keeps the pagination audit, not the class names.
  const singleRaw = JSON.stringify(single.raw_result);
  expect(singleRaw).not.toContain("fixture.Class");
  const singlePages = listClassCalls(single.raw_result);
  expect(singlePages).toHaveLength(1);
  expect(responsePage(singlePages[0]!)).toMatchObject({ items_omitted: 1 });
  expect(Buffer.byteLength(JSON.stringify(single))).toBeLessThan(32 * 1024);
  // Every matching producer row remains in the retained source record.
  const completeId = single.evidence_links[0];
  expect(completeId).toBeDefined();
  expect(completeId).toBe(
    (single.raw_result as { complete_evidence_id: string })
      .complete_evidence_id,
  );
  const complete = session.evidenceById(completeId as string);
  expect(complete).toBeDefined();
  expect(complete?.operation).toBe("search_android_classes");
  expect(rawInventoryNames(complete?.raw_result)).toBe(1);
  expect(
    listClassCalls(complete?.raw_result).flatMap(
      (call) => responsePage(call).items,
    ),
  ).toEqual(["fixture.Target"]);
  expect(JSON.stringify(complete?.raw_result)).not.toContain("fixture.Class");

  // Selection precedes paging: a match beyond the first unfiltered page is
  // still found, and the complete inventory remains explicitly available.
  const last = await search("Class7094");
  expect(last.normalized_result).toMatchObject({
    total_classes: INVENTORY_CLASS_COUNT,
    matches: ["fixture.Class7094"],
    coverage: "complete",
  });
  const inventory = await search("");
  const inventorySource = session.evidenceById(
    inventory.evidence_links[0] as string,
  );
  expect(rawInventoryNames(inventorySource?.raw_result)).toBe(
    INVENTORY_CLASS_COUNT,
  );
  const summaryPages = listClassCalls(inventory.raw_result);
  const completePages = listClassCalls(inventorySource?.raw_result);
  expect(summaryPages).toHaveLength(2);
  expect(completePages).toHaveLength(2);
  expect(
    summaryPages.map((call) => {
      const page = responsePage(call);
      return {
        offset: page.offset,
        next_offset: page.next_offset,
        total_classes: page.total_classes,
        limit: page.limit,
        items_omitted: page.items_omitted,
      };
    }),
  ).toEqual([
    {
      offset: 0,
      next_offset: 4096,
      total_classes: INVENTORY_CLASS_COUNT,
      limit: 4096,
      items_omitted: 4096,
    },
    {
      offset: 4096,
      next_offset: INVENTORY_CLASS_COUNT,
      total_classes: INVENTORY_CLASS_COUNT,
      limit: 4096,
      items_omitted: INVENTORY_CLASS_COUNT - 4096,
    },
  ]);
  expect(summaryPages.map(callMetadata)).toEqual(
    completePages.map(callMetadata),
  );
  expect(completePages.map(responsePage).map((page) => page.items)).toEqual([
    expect.arrayContaining(["fixture.Target", "fixture.Class0"]),
    expect.arrayContaining(["fixture.Class4095", "fixture.Class7094"]),
  ]);

  const empty = await search("fixture.Missing");
  expect(
    androidResultSchemas.search_android_classes.parse(empty.normalized_result),
  ).toMatchObject({
    query: "fixture.Missing",
    total_classes: INVENTORY_CLASS_COUNT,
    matches: [],
    coverage: "complete",
  });
  expect(JSON.stringify(empty.raw_result)).not.toContain("fixture.Class");
  expect(listClassCalls(empty.raw_result).map(responsePage)).toMatchObject([
    {
      offset: 0,
      next_offset: INVENTORY_CLASS_COUNT,
      total_classes: INVENTORY_CLASS_COUNT,
      limit: 4096,
      items_omitted: 0,
      fixture_metadata: {
        page_offset: 0,
        retained: "unknown page field",
      },
    },
  ]);

  await client.close();
  await server.close();
  await verifyJadxFixtureCleanup(launches);
});

test("keeps the complete paged inventory inline without a retaining session", async () => {
  const { service, apk, launches, provider } = await createJadxProtocolFixture(
    "search-audit-metadata",
    undefined,
    { classCount: INVENTORY_CLASS_COUNT - 1 },
  );
  const result = await service.execute("search_android_classes", {
    path: apk,
    query: "",
  });
  if (!result.ok) throw result.error;
  // No retaining writer means the CLI receives the unmodified source pages.
  expect(rawInventoryNames(result.value.raw_result)).toBe(
    INVENTORY_CLASS_COUNT,
  );
  const fullPages = listClassCalls(result.value.raw_result);
  expect(fullPages).toHaveLength(2);
  expect(fullPages.map(responsePage)).toMatchObject([
    {
      offset: 0,
      next_offset: 4096,
      total_classes: INVENTORY_CLASS_COUNT,
      limit: 4096,
      items: expect.arrayContaining(["fixture.Target", "fixture.Class0"]),
    },
    {
      offset: 4096,
      next_offset: INVENTORY_CLASS_COUNT,
      total_classes: INVENTORY_CLASS_COUNT,
      limit: 4096,
      items: expect.arrayContaining(["fixture.Class4095", "fixture.Class7094"]),
    },
  ]);
  expect(responsePage(fullPages[0]!)).toMatchObject({
    fixture_metadata: {
      page_offset: 0,
      retained: "unknown page field",
    },
  });
  for (const [index, call] of fullPages.entries()) {
    expect(call.response._meta).toEqual({
      fixture_envelope_offset: index * 4096,
    });
    expect(call.response.content?.[0]?._meta).toEqual({
      fixture_content_offset: index * 4096,
    });
    expect(call.response.content?.[0]?.annotations).toEqual({
      audience: ["user"],
      priority: 0.5,
    });
  }
  expect(JSON.stringify(result.value.raw_result)).not.toContain(
    "inventory_elided",
  );
  expect(JSON.stringify(result.value.raw_result)).not.toContain(
    "items_omitted",
  );
  await provider.close();
  await verifyJadxFixtureCleanup(launches);
});

test("withholds inline summary when retaining complete Evidence fails", async () => {
  const { provider, apk, launches } = await createJadxProtocolFixture(
    "search-audit-metadata",
    undefined,
    { classCount: INVENTORY_CLASS_COUNT - 1 },
  );
  const writeFailure = new EvidenceIntegrityError(
    "The complete Android search Evidence could not be retained",
  );
  const retained: Evidence[] = [];
  const service = new AndroidAnalysisService(provider, (evidence) => {
    retained.push(evidence);
    return err(writeFailure);
  });

  const result = await service.execute("search_android_classes", {
    path: apk,
    query: "",
  });

  expect(result).toEqual({ ok: false, error: writeFailure });
  expect(retained).toHaveLength(1);
  expect(retained[0]?.operation).toBe("search_android_classes");
  expect(
    androidResultSchemas.search_android_classes.parse(
      retained[0]?.normalized_result,
    ),
  ).toMatchObject({
    total_classes: INVENTORY_CLASS_COUNT,
    matches: expect.arrayContaining(["fixture.Target", "fixture.Class7094"]),
    coverage: "complete",
  });
  expect(rawInventoryNames(retained[0]?.raw_result)).toBe(
    INVENTORY_CLASS_COUNT,
  );
  expect(JSON.stringify(retained[0]?.raw_result)).not.toContain(
    "items_omitted",
  );

  await provider.close();
  await verifyJadxFixtureCleanup(launches);
});
