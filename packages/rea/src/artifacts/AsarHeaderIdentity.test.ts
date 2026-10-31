import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { buffer } from "node:stream/consumers";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { AsarArtifactReader } from "./AsarArtifactReader.js";
import { asarHeaderBytes } from "../../tests/fixtures/asarHeader.js";

it("rejects malformed UTF-8 instead of inventing a replacement-character member identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "rea-asar-identity-"));
  const path = join(root, "app.asar");
  const reader = new AsarArtifactReader(path);
  const bytes = asarHeaderBytes('{"files":{"x":{"size":0,"offset":"0"}}}');
  bytes[bytes.indexOf(Buffer.from('"x"')) + 1] = 0xff;
  await writeFile(path, bytes);
  try {
    await expect(collectEntries(reader)).rejects.toMatchObject({
      reason: "format",
      message: expect.stringContaining("UTF-8"),
    });
  } finally {
    await reader.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["�", "é", "日本語", "\uFEFFname"])(
  "preserves valid UTF-8 member identity %j and reads its bytes through padded framing",
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), "rea-asar-identity-"));
    const path = join(root, "app.asar");
    const reader = new AsarArtifactReader(path);
    const content = Buffer.from("member bytes");
    await writeFile(
      path,
      Buffer.concat([
        asarHeaderBytes(
          ` \t\r\n${JSON.stringify({ files: { [name]: { size: content.length, offset: "0" } } })} `,
          { padding: Buffer.from([0xff, 0xfe]) },
        ),
        content,
      ]),
    );
    try {
      const entries = await collectEntries(reader);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.path).toBe(name);
      const output = await reader.open(entries[0]!);
      expect((await buffer(output)).equals(content)).toBe(true);
    } finally {
      await reader.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it.each(['{"files":', '\uFEFF{"files":{}}'])(
  "rejects invalid JSON framing %j as format failure",
  async (json) => {
    const root = await mkdtemp(join(tmpdir(), "rea-asar-identity-"));
    const path = join(root, "app.asar");
    const reader = new AsarArtifactReader(path);
    await writeFile(path, asarHeaderBytes(json));
    try {
      await expect(collectEntries(reader)).rejects.toMatchObject({
        reason: "format",
      });
    } finally {
      await reader.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

async function collectEntries(reader: AsarArtifactReader) {
  const entries = [];
  for await (const entry of reader.entries()) entries.push(entry);
  return entries;
}
