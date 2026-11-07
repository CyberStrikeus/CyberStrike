import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonFile } from "../../../src/application/JsonFiles.js";
import { parseCliJsonInput } from "../../../src/cliJsonInput.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
describe("JSON file UTF-8 byte integrity", () => {
  it("rejects invalid UTF-8 through both file input boundaries", async () => {
    const root = await createTestTempDirectory("rea-json-utf8-");
    const path = join(root, "input.json");
    await writeFile(
      path,
      Buffer.concat([
        Buffer.from('{"message":"'),
        Buffer.from([0x80]),
        Buffer.from('"}'),
      ]),
    );
    const fileInput = await readJsonFile(path);
    const cliInput = await parseCliJsonInput(path, "compare_web_captures");
    expect(fileInput).toMatchObject({
      ok: false,
      error: { reason: "invalid-json" },
    });
    expect(cliInput).toMatchObject({
      ok: false,
      error: { input_reason: "invalid-json" },
    });
  });
  it("preserves a legitimate UTF-8 replacement character", async () => {
    const root = await createTestTempDirectory("rea-json-utf8-control-");
    const path = join(root, "input.json");
    const value = { message: "valid � and é and 😀" };
    await writeFile(path, JSON.stringify(value), "utf8");
    const fileInput = await readJsonFile(path);
    const cliInput = await parseCliJsonInput(path, "compare_web_captures");
    expect(fileInput).toMatchObject({ ok: true, value });
    expect(cliInput).toMatchObject({ ok: true, value });
  });
});
