import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import rule from "../../scripts/lint/rules/no-evidence-json-preadmission.mjs";

const filename = resolve("src/application/RuleFixture.ts");
const imports = `
import { createEvidence, createImmutableEvidenceSteps } from "../domain/evidence.js";
import { jsonValueSchema, jsonObjectSchema } from "../domain/jsonValue.js";
`;
const evidenceSource = new URL("../../src/domain/evidence.js", import.meta.url);
const jsonSource = new URL("../../src/domain/jsonValue.js", import.meta.url);
const fileImports = `
import { createEvidence } from ${JSON.stringify(evidenceSource.href)};
import { jsonValueSchema } from ${JSON.stringify(jsonSource.href)};
`;
const absoluteImports = `
import { createEvidence } from ${JSON.stringify(fileURLToPath(evidenceSource))};
import { jsonValueSchema } from ${JSON.stringify(fileURLToPath(jsonSource))};
`;
const valid = (name: string, code: string) => ({ name, filename, code });
const invalid = (name: string, code: string, field: string) => ({
  name,
  filename,
  code,
  errors: [{ messageId: "redundantJsonAdmission", data: { field } }],
  output: null,
});

RuleTester.describe = describe;
RuleTester.it = it;
new RuleTester({
  languageOptions: { sourceType: "module", parserOptions: { lang: "ts" } },
}).run("no-evidence-json-preadmission", rule, {
  valid: [
    valid(
      "file URL binding still respects lexical shadows",
      `${fileImports}
      function build(createEvidence) { createEvidence(target, provider, {result: jsonValueSchema.parse(input)}); }`,
    ),
    valid(
      "HTTP modules are not filesystem owners",
      `
      import { createEvidence } from "https://example.test/src/domain/evidence.js";
      import { jsonValueSchema } from "https://example.test/src/domain/jsonValue.js";
      createEvidence(target, provider, {result: jsonValueSchema.parse(input)});`,
    ),
    valid(
      "malformed file URLs do not crash owner lookup",
      `
      import {createEvidence} from "file://%";
      import {jsonValueSchema} from ${JSON.stringify(jsonSource.href)};
      createEvidence(target, provider, {result: jsonValueSchema.parse(input)});`,
    ),
    valid(
      "queried file URL does not establish the canonical owner",
      `
      import {createEvidence} from ${JSON.stringify(`${evidenceSource.href}?instance=other`)};
      import {jsonValueSchema} from ${JSON.stringify(jsonSource.href)};
      createEvidence(target, provider, {result: jsonValueSchema.parse(input)});`,
    ),
    valid(
      "fragment file URL does not establish the canonical schema",
      `
      import {createEvidence} from ${JSON.stringify(evidenceSource.href)};
      import {jsonValueSchema} from ${JSON.stringify(`${jsonSource.href}#other`)};
      createEvidence(target, provider, {result: jsonValueSchema.parse(input)});`,
    ),
    valid(
      "post-fix process capture keeps producer facts",
      `${imports}
          createEvidence(undefined, provider, { result: capture });`,
    ),
    valid(
      "semantic format admission remains",
      `${imports}
          createEvidence(target, provider, { result: processCaptureSchema.parse(capture) });`,
    ),
    valid(
      "standalone JSON admission remains",
      `${imports}
          const observation = { result: jsonValueSchema.parse(result) };
          executeAnalysis(observation);`,
    ),
    valid(
      "strong immutable Evidence contract remains",
      `${imports}
          createImmutableEvidenceSteps(target, provider, { result: jsonValueSchema.parse(result) });`,
    ),
    valid(
      "digest helper owns its typed JSON input",
      `${imports}
          const parameters = { ...jsonObjectSchema.parse(scenario), digest: scenarioDigest(scenario) };
          createEvidence(target, provider, { parameters });`,
    ),
    valid(
      "multiuse parsed value retains its separate contract",
      `${imports}
          const result = jsonValueSchema.parse(input);
          consumeJson(result);
          createEvidence(target, provider, { result });`,
    ),
    valid(
      "single-use typed local is outside the direct expression rule",
      `${imports}
          const result: JsonValue = jsonValueSchema.parse(input);
          createEvidence(target, provider, { result });`,
    ),
    valid(
      "local creator shadows imported creator",
      `${imports}
          function build(createEvidence) {
            return createEvidence(target, provider, { result: jsonValueSchema.parse(input) });
          }`,
    ),
    valid(
      "local schema shadows imported schema",
      `${imports}
          function build(jsonValueSchema) {
            return createEvidence(target, provider, { result: jsonValueSchema.parse(input) });
          }`,
    ),
    valid(
      "namespace shadowing is respected",
      `
          import * as evidence from "../domain/evidence.js";
          import * as json from "../domain/jsonValue.js";
          function build(json) {
            return evidence.createEvidence(target, provider, { result: json.jsonValueSchema.parse(input) });
          }`,
    ),
    valid(
      "creator namespace shadowing is respected",
      `
          import * as evidence from "../domain/evidence.js";
          import * as json from "../domain/jsonValue.js";
          function build(evidence) {
            return evidence.createEvidence(target, provider, { result: json.jsonValueSchema.parse(input) });
          }`,
    ),
    valid(
      "same-named exports from another module are unrelated",
      `
          import { createEvidence } from "../other/evidence.js";
          import { jsonValueSchema } from "../domain/jsonValue.js";
          createEvidence(target, provider, { result: jsonValueSchema.parse(input) });`,
    ),
    valid(
      "same-named schema from another module is unrelated",
      `
          import { createEvidence } from "../domain/evidence.js";
          import { jsonValueSchema } from "../other/jsonValue.js";
          createEvidence(target, provider, { result: jsonValueSchema.parse(input) });`,
    ),
    valid(
      "safeParse is a separate Result boundary",
      `${imports}
          createEvidence(target, provider, { result: jsonValueSchema.safeParse(input) });`,
    ),
    valid(
      "nested parsing is not an immediate payload admission",
      `${imports}
          createEvidence(target, provider, { parameters: { trace_spec: jsonValueSchema.parse(specification) } });`,
    ),
    valid(
      "later spread may replace the parsed field",
      `${imports}
          createEvidence(target, provider, { result: jsonValueSchema.parse(input), ...overrides });`,
    ),
    valid(
      "later duplicate field replaces the parsed field",
      `${imports}
          createEvidence(target, provider, { result: jsonValueSchema.parse(input), result: replacement });`,
    ),
    valid(
      "unknown computed field may replace the parsed field",
      `${imports}
          createEvidence(target, provider, { result: jsonValueSchema.parse(input), [field]: replacement });`,
    ),
    valid(
      "explicit parse options are outside the direct admission rule",
      `${imports}
          createEvidence(target, provider, { result: jsonValueSchema.parse(input, options) });`,
    ),
  ],
  invalid: [
    invalid(
      "file URLs preserve canonical JSON ownership",
      `${fileImports}
      createEvidence(target, provider, {result: jsonValueSchema.parse(input)});`,
      "result",
    ),
    invalid(
      "absolute paths preserve canonical JSON ownership",
      `${absoluteImports}
      createEvidence(target, provider, {result: jsonValueSchema.parse(input)});`,
      "result",
    ),
    invalid(
      "pre-fix process capture repeats JSON admission",
      `${imports}
          createEvidence(undefined, PROCESS_PROVIDER, { result: jsonValueSchema.parse(capture) });`,
      "result",
    ),
    invalid(
      "object parameters repeat generic admission",
      `${imports}
          createEvidence(target, provider, { parameters: jsonObjectSchema.parse(parameters) });`,
      "parameters",
    ),
    invalid(
      "raw payload admission belongs to Evidence",
      `${imports}
          createEvidence(target, provider, { rawResult: jsonValueSchema.parse(raw) });`,
      "rawResult",
    ),
    invalid(
      "aliased imports retain their owner",
      `
          import { createEvidence as record } from "../domain/evidence.js";
          import { jsonValueSchema as json } from "../domain/jsonValue.js";
          record(target, provider, { result: json.parse(input) });`,
      "result",
    ),
    invalid(
      "namespace members retain their owner",
      `
          import * as evidence from "../domain/evidence.js";
          import * as json from "../domain/jsonValue.js";
          evidence.createEvidence(target, provider, { result: json.jsonValueSchema.parse(input) });`,
      "result",
    ),
    invalid(
      "static computed members retain their owner",
      `
          import * as evidence from "../domain/evidence.js";
          import * as json from "../domain/jsonValue.js";
          evidence["createEvidence"](target, provider, { ["result"]: json["jsonValueSchema"]["parse"](input) });`,
      "result",
    ),
    invalid(
      "TypeScript source specifiers resolve to the same owner",
      `
          import { createEvidence } from "../domain/evidence.ts";
          import { jsonObjectSchema } from "../domain/jsonValue.ts";
          createEvidence(target, provider, { parameters: jsonObjectSchema.parse(input) });`,
      "parameters",
    ),
    invalid(
      "an earlier spread does not replace the final payload",
      `${imports}
          createEvidence(target, provider, { ...base, result: jsonValueSchema.parse(input) });`,
      "result",
    ),
    invalid(
      "unrelated local scopes do not hide the import",
      `${imports}
          function unrelated(jsonValueSchema) { return jsonValueSchema.parse(input); }
          createEvidence(target, provider, { result: jsonValueSchema.parse(input) });`,
      "result",
    ),
  ],
});
