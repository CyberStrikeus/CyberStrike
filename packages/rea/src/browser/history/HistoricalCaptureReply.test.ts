import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { historicalHar } from "../../../tests/fixtures/historicalHar.js";
import { decodeHarCapture } from "./HarCapture.js";
import { readHistoricalCaptureReply } from "./HistoricalCaptureReply.js";

const replyFile = async (bytes: Uint8Array) => {
  const root = await createTestTempDirectory("rea-capture-reply-utf8-");
  const path = join(root, "reply.json");
  await writeFile(path, bytes);
  const resources = new ArtifactResourceScope();
  onTestFinished(() => resources.close());
  return { path, resources };
};

const replyText = (kind: "error" | "output", text: string) => {
  if (kind === "error")
    return JSON.stringify({
      ok: false,
      reason: "format",
      message: text,
      pointer: "",
    });
  const capture = historicalHar();
  capture.log.entries[0]!.response.content.text = text;
  return JSON.stringify({
    ok: true,
    value: decodeHarCapture(JSON.stringify(capture), []),
  });
};

it.each(["error", "output"] as const)(
  "rejects malformed bytes inside an otherwise schema-valid %s reply",
  async (kind) => {
    const text = replyText(kind, "WIRE_MARKER");
    const offset = text.indexOf("WIRE_MARKER");
    expect(offset).toBeGreaterThan(0);
    const bytes = Buffer.concat([
      Buffer.from(text.slice(0, offset)),
      Buffer.from([0xff]),
      Buffer.from(text.slice(offset + "WIRE_MARKER".length)),
    ]);
    const file = await replyFile(bytes);
    await expect(
      readHistoricalCaptureReply(file.path, "/capture.har", file.resources),
    ).rejects.toMatchObject({
      _tag: "AnalysisOutputError",
      reason: expect.stringContaining("Reply is not valid UTF-8."),
      cause: { code: "ERR_ENCODING_INVALID_ENCODED_DATA" },
    });
  },
);

it.each(["error", "output"] as const)(
  "preserves valid replacement-character text and exact byte counts in %s replies",
  async (kind) => {
    const text = replyText(kind, "valid � 雪");
    const bytes = Buffer.from(text);
    const file = await replyFile(bytes);
    const result = await readHistoricalCaptureReply(
      file.path,
      "/capture.har",
      file.resources,
    );
    expect(result.bytes).toBe(bytes.length);
    expect(result.finalization).toBeUndefined();
    expect(result.value).toEqual(JSON.parse(text));
  },
);

it.each(["{broken", "\uFEFF{}"])(
  "retains malformed JSON handling for %j",
  async (text) => {
    const file = await replyFile(Buffer.from(text));
    await expect(
      readHistoricalCaptureReply(file.path, "/capture.har", file.resources),
    ).rejects.toMatchObject({
      _tag: "AnalysisOutputError",
      reason: expect.stringContaining("Reply is malformed JSON."),
      cause: expect.any(SyntaxError),
    });
  },
);

// Python's wire spelling differs from the JavaScript number retained in Evidence.
const nativeNumericReply = (literal: string) => {
  const payload = decodeHarCapture(JSON.stringify(historicalHar()), []);
  payload.records[0]!.reported = {
    metadata: {
      ["__proto__"]: { ["ratio/~"]: [Number(literal)] },
      ordinary: 42,
    },
  };
  payload.records[0]!.numeric_literals = [
    {
      pointer: "/metadata/__proto__/ratio~1~0/0",
      producer_type: "float",
      literal,
    },
  ];
  return JSON.stringify({ ok: true, value: payload });
};

it.each([
  ["1e-07", "1e-7"],
  ["1e+20", "000000"],
] as const)(
  "excludes the public spelling of native number %s and its numeric sidecar",
  async (literal, sensitive) => {
    const bytes = Buffer.from(nativeNumericReply(literal));
    const file = await replyFile(bytes);
    const result = await readHistoricalCaptureReply(
      file.path,
      "/capture.mitm",
      file.resources,
      undefined,
      [sensitive],
    );
    if (!result.value.ok) throw new Error("Expected a capture reply");
    const record = result.value.value.records[0]!;
    expect(record.reported).toEqual({
      metadata: { ["__proto__"]: { ["ratio/~"]: [null] }, ordinary: 42 },
    });
    expect(record.numeric_literals).toEqual([]);
    expect(record.redactions).toContainEqual({
      pointer: "/metadata/__proto__/ratio~1~0/0",
      reason: "explicit-sensitive-value",
    });
    expect(JSON.stringify(record)).not.toContain(sensitive);
    expect(result.bytes).toBe(bytes.length);
    expect(Reflect.get(Object.prototype, "ratio/~")).toBeUndefined();
  },
);

it("preserves unmarked native numbers and exact producer literals", async () => {
  const text = nativeNumericReply("1e-07");
  const file = await replyFile(Buffer.from(text));
  const result = await readHistoricalCaptureReply(
    file.path,
    "/capture.mitm",
    file.resources,
    undefined,
    ["unrelated"],
  );
  expect(result.value).toEqual(JSON.parse(text));
});

it.each(["container", "record"] as const)(
  "excludes a normalized number at the %s root",
  async (kind) => {
    const payload = decodeHarCapture(JSON.stringify(historicalHar()), []);
    const projection =
      kind === "container" ? payload.container : payload.records[0]!;
    projection.reported = 1e-7;
    projection.numeric_literals = [
      { pointer: "", producer_type: "float", literal: "1e-07" },
    ];
    projection.redactions = [];
    const file = await replyFile(
      Buffer.from(JSON.stringify({ ok: true, value: payload })),
    );
    const result = await readHistoricalCaptureReply(
      file.path,
      "/capture.mitm",
      file.resources,
      undefined,
      ["1e-7"],
    );
    if (!result.value.ok) throw new Error("Expected a capture reply");
    const retained =
      kind === "container"
        ? result.value.value.container
        : result.value.value.records[0]!;
    expect(retained.reported).toBeNull();
    expect(retained.numeric_literals).toEqual([]);
    expect(retained.redactions).toEqual([
      { pointer: "", reason: "explicit-sensitive-value" },
    ]);
  },
);
