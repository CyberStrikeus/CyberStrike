import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import noBufferDeepEquality from "../../../scripts/lint/no-buffer-deep-equality.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
  languageOptions: { sourceType: "module", env: { node: true } },
}).run("no-buffer-deep-equality", noBufferDeepEquality, {
  valid: [
    `import { readFile } from "node:fs/promises";
       import { expect } from "vitest";
       expect(await readFile(path, "utf8")).toEqual(text);`,
    `import { readFile } from "node:fs/promises";
       import { expect } from "vitest";
       expect(await readFile(path, { encoding: "utf8" })).toEqual(text);`,
    `import { readFile } from "node:fs/promises";
       import { expect } from "vitest";
       expect(await readFile(path, options)).toEqual(value);`,
    `import { readFile } from "node:fs/promises";
       import { expect } from "vitest";
       const pending = readFile(path);
       expect(pending).toEqual(promise);`,
    `import { readFile } from "node:fs/promises";
       import { expect } from "vitest";
       expect(readFile(path, "utf8")).resolves.toEqual(text);`,
    `import { readFile } from "node:fs/promises";
       import { expect } from "vitest";
       expect((await readFile(path)).equals(before)).toBe(true);`,
    `import { expect } from "vitest";
       const Buffer = { from: () => ({}) };
       expect(Buffer.from("x")).toEqual(value);`,
    `import { expect } from "vitest";
       function check(Buffer) { expect(Buffer.alloc(4)).toEqual(value); }`,
    `import { expect } from "vitest";
       function check(Buffer) {
         const Bytes = Buffer;
         expect(Bytes.from("x")).toEqual(value);
       }`,
    `import { readFile } from "node:fs/promises";
       function check(expect) { expect(readFile(path)).toEqual(value); }`,
    `import { expect } from "vitest";
       function check(readFile) { expect(readFile(path)).toEqual(value); }`,
    `import { expect } from "other-assertions";
       expect(Buffer.from("x")).toEqual(value);`,
    `expect(Buffer.from("x")).toEqual(value);`,
    `import { readFile } from "other-fs";
       import { expect } from "vitest";
       expect(readFile(path)).toEqual(value);`,
    `import { readFile } from "node:fs/promises";
       import { expect } from "vitest";
       expect(await readFile(...args)).toEqual(value);`,
    `import { readFile } from "node:fs/promises";
       import { expect } from "vitest";
       const data = await readFile(path, "utf8");
       expect(data).toEqual(text);`,
    `import { expect } from "vitest";
       expect([1, 2]).toEqual([1, 2]);`,
    `import { expect } from "vitest";
       let bytes = Buffer.from("x");
       expect(bytes).toEqual(value);`,
  ],
  invalid: [
    {
      // Exact pre-fix ELF test shape: readFile without an encoding returns Buffer.
      code: `import { readFile } from "node:fs/promises";
               import { expect } from "vitest";
               const before = await readFile(path);
               expect(await readFile(path)).toEqual(before);`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { readFileSync as read } from "node:fs";
               import { expect } from "vitest";
               const before = read(path);
               expect(value).toStrictEqual(before);`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { readFile as sourceRead } from "node:fs/promises";
               import { expect } from "vitest";
               const read = sourceRead;
               const bytes = await read(path);
               expect(bytes).not.toEqual(value);`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import * as fs from "node:fs/promises";
               import { expect } from "vitest";
               expect(await fs.readFile(path)).toEqual(value);`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { Buffer as NodeBuffer } from "node:buffer";
               import { expect } from "vitest";
               expect(value).toEqual(NodeBuffer.from("x"));`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { expect } from "vitest";
               const Bytes = Buffer;
               const bytes = Bytes.allocUnsafe(16);
               expect(bytes).toEqual(value);`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { readFile } from "node:fs/promises";
               import { expect } from "vitest";
               expect(await readFile(path), "bytes unchanged").toEqual(before);`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { readFile } from "node:fs/promises";
               import { expect } from "vitest";
               expect(readFile(path)).resolves.toEqual(Buffer.from("x"));`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { readFile } from "node:fs/promises";
               import { expect } from "vitest";
               expect(readFile(path)).resolves.not.toEqual(value);`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { expect } from "vitest";
               expect(Promise.reject(Buffer.from("x"))).rejects.toStrictEqual(Buffer.from("x"));`,
      errors: [{ messageId: "nativeBytes" }],
    },
    {
      code: `import { expect as check } from "vitest";
               check(Buffer.alloc(4)).toEqual(value);`,
      errors: [{ messageId: "nativeBytes" }],
    },
  ],
});
