import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it.each([
  ["native main", "require.main.require('node:path');", 1],
  ["captured main", "const main=require.main;main.require('node:path');", 1],
  ["native process main", "process.mainModule.require('node:path');", 1],
  [
    "captured process main",
    "const main=process.mainModule;main.require('node:path');",
    1,
  ],
  [
    "captured process delegate",
    "const main=process.mainModule;const load=main.require;load.call(main,'node:path');",
    1,
  ],
  [
    "shared deep child local write",
    "const old={child:{inner:{make:()=>module}}};const box={...old};old.child={inner:box.child.inner};old.child.inner.make=()=>({require(){}});box.child.inner.make().require('node:path');",
    0,
  ],
  [
    "shared deep child host write",
    "const old={child:{inner:{make:()=>({})}}};const box={...old};old.child={inner:box.child.inner};old.child.inner.make=()=>module;box.child.inner.make().require('node:path');",
    1,
  ],
] as const)(
  "observes real CommonJS Module loading for %s",
  async (_name, source, loads) => {
    const root = await createTestTempDirectory("rea-main-module-source-");
    const entry = join(root, "entry.cjs");
    await writeFile(
      entry,
      `if(process.mainModule!==module||require.main!==module)throw Error('Native main-module identity changed');const original=module.require;let loads=0;module.require=function(...args){loads++;return Reflect.apply(original,this,args)};const out=eval(${JSON.stringify(source)});process.stdout.write(JSON.stringify({loads,native:typeof out?.join==='function'}));`,
    );
    const observed = execFileSync(process.execPath, [entry], {
      encoding: "utf8",
      timeout: 5_000,
    });
    expect(JSON.parse(observed) as unknown).toEqual({
      loads,
      native: loads === 1,
    });
  },
);
