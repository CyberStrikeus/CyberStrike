import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Selected entry sources with unrelated malformed text and source-map inputs. */
export const writeJavaScriptSourceSelectionFixture = async (root: string) => {
  const sources = new Map<string, Buffer>([
    [
      "main.mjs",
      Buffer.from(
        'import "./vendor.js"; export function selected(value) { return value + 1; } throw new Error("must never execute");\n',
      ),
    ],
    [
      "package.json",
      Buffer.from('{"name":"rea-selected-source-fixture","main":"main.mjs"}\n'),
    ],
    ["vendor.js", Buffer.from("export const unrelated = ;\n")],
    ["invalid.mjs", Buffer.from([0xff, 0xfe, 0x80])],
    ["broken.json", Buffer.from("{")],
    ["main.mjs.map", Buffer.from("{")],
  ]);
  for (const [path, bytes] of sources) await writeFile(join(root, path), bytes);
  return sources;
};
