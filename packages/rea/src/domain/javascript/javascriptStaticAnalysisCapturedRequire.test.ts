import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  ['const load = module.require; load.call(module, "../shared.cjs");', true],
  ['const load = module.require; load.apply(module, ["../shared.cjs"]);', true],
  ['const load = module.require; load("../shared.cjs");', true],
  [
    'const load = module.require; const alias = load; alias.call(module, "../shared.cjs");',
    true,
  ],
  [
    'const { require: load } = module; load.call(module, "../shared.cjs");',
    true,
  ],
  [
    'const holder = { load: module.require }; holder.load.call(module, "../shared.cjs");',
    true,
  ],
  ['const holder = [module.require]; holder[0]("../shared.cjs");', true],
  [
    'let load = () => {}; if (flag) load = module.require; load("../shared.cjs");',
    true,
  ],
  [
    'let load = module.require; load = () => {}; load.call(module, "../shared.cjs");',
    false,
  ],
  [
    'const api = { require() {} }; const load = api.require; load.call(api, "../shared.cjs");',
    false,
  ],
  [
    'const load = module.exports.require; load.call(module.exports, "../shared.cjs");',
    false,
  ],
])(
  "retains captured CommonJS delegates by source identity: %s",
  (source, expected) => {
    const analysis = analyzeJavaScriptStaticSource(source);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.references).toEqual(
      expected
        ? [expect.objectContaining({ kind: "require", specifier: null })]
        : [],
    );
  },
);
