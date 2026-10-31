import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { verifyJavaScriptReturnShapes } from "../../fixtures/javascriptReturnShapes.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const source = `
export function captured(x) { const saved=x; x=2; return {type:"ok",value:saved}; }
export function assigned(x) { x=2; const saved=x; return {value:saved}; }
export function between(x) { const before=x; x=2; const after=x; return {before,after}; }
export function intermediate(x) { x=1; const saved=x; x=2; return {value:saved}; }
export function nested(x) { let saved; { saved=x; } x=2; return {value:saved}; }
export function alias(x) { const first=x; const saved=first; x=2; return {value:saved}; }
export function defaulted(x=1) { const saved=x; x=2; return {value:saved}; }
export function destructured({x}) { const saved=x; x=2; return {value:saved}; }
export function local() { let value="before"; value="after"; return {value}; }
`;

cliTest(
  "retains cyclic member effects and sibling values through CLI and stdio MCP",
  async ({ cli }) => {
    const branches = Array.from(
      { length: 16 },
      (_, index) => `if (flag === ${index}) node = node.m${index};`,
    ).join(" else ");
    await verifyJavaScriptReturnShapes(
      cli,
      `export function result() {
        const seed = { mode: "initial", m15: { value: 1, keep: 3 } };
        let node = seed;
        while (node) { ${branches} node.value = 2; }
        return { changed: seed.m15.value, mode: seed.mode, kept: seed.m15.keep };
      }
      export function copied() {
        const seed = { mode: "initial", keep: 3, m15: { m15: { child: { value: 1 } } } };
        let node = seed.m15;
        while (node) {
          ${branches}
          const { ignore, ...copy } = node;
          mutate(copy[key]);
        }
        return { changed: seed.m15.m15.child.value, mode: seed.mode, kept: seed.keep };
      }`,
      (fields) => {
        for (const name of ["result", "copied"])
          expect(fields(name)).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ path: "/changed", state: "unknown" }),
              expect.objectContaining({
                path: "/mode",
                state: "literal",
                value: "initial",
              }),
              expect.objectContaining({
                path: "/kept",
                state: "literal",
                value: 3,
              }),
            ]),
          );
      },
    );
  },
  120_000,
);

cliTest(
  "preserves incoming values and proven assignments through CLI and stdio MCP",
  async ({ cli }) => {
    const oracle = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `${source}
console.log(JSON.stringify([captured(5),assigned(5),between(5),intermediate(5),nested(5),alias(5),defaulted(5),destructured({x:5}),local()]));`,
      ],
      { timeout: 10_000 },
    );
    expect(JSON.parse(oracle.stdout)).toEqual([
      { type: "ok", value: 5 },
      { value: 2 },
      { before: 5, after: 2 },
      { value: 1 },
      { value: 5 },
      { value: 5 },
      { value: 5 },
      { value: 5 },
      { value: "after" },
    ]);
    await verifyJavaScriptReturnShapes(cli, source, (fields) => {
      for (const name of [
        "captured",
        "nested",
        "alias",
        "defaulted",
        "destructured",
      ])
        expect(fields(name)).toContainEqual(
          expect.objectContaining({ path: "/value", state: "unknown" }),
        );
      expect(fields("captured")).toContainEqual(
        expect.objectContaining({
          path: "/type",
          state: "literal",
          value: "ok",
        }),
      );
      expect(fields("assigned")).toContainEqual(
        expect.objectContaining({ path: "/value", state: "literal", value: 2 }),
      );
      expect(fields("local")).toContainEqual(
        expect.objectContaining({
          path: "/value",
          state: "literal",
          value: "after",
        }),
      );
      expect(fields("intermediate")).toContainEqual(
        expect.objectContaining({ path: "/value", state: "literal", value: 1 }),
      );
      expect(fields("between")).toContainEqual(
        expect.objectContaining({ path: "/before", state: "unknown" }),
      );
      expect(fields("between")).toContainEqual(
        expect.objectContaining({ path: "/after", state: "literal", value: 2 }),
      );
    });
  },
  120_000,
);

cliTest(
  "distinguishes delayed instance values from immediate static fields and computed keys",
  async ({ cli }) => {
    const fieldsSource = `
export function delayed() { let x=0; class C { field=(x=1) } return {value:x}; }
export function incoming(x) { class C { field=(x=1) } return {value:x}; }
export function delayedPrivate() { let x=0; class C { #field=(x=1) } return {value:x}; }
export function staticField() { let x=0; class C { static field=(x=1) } return {value:x}; }
export function staticPrivate() { let x=0; class C { static #field=(x=1) } return {value:x}; }
export function computedKey() { let x=0; class C { [x=1]=7 } return {value:x}; }
`;
    const oracle = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `${fieldsSource}
console.log(JSON.stringify([delayed(),incoming(5),delayedPrivate(),staticField(),staticPrivate(),computedKey()]));`,
      ],
      { timeout: 10_000 },
    );
    expect(JSON.parse(oracle.stdout)).toEqual([
      { value: 0 },
      { value: 5 },
      { value: 0 },
      { value: 1 },
      { value: 1 },
      { value: 1 },
    ]);
    await verifyJavaScriptReturnShapes(cli, fieldsSource, (fields) => {
      for (const name of ["delayed", "incoming", "delayedPrivate"])
        expect(fields(name)).toContainEqual(
          expect.objectContaining({ path: "/value", state: "unknown" }),
        );
      for (const name of ["staticField", "staticPrivate", "computedKey"])
        expect(fields(name)).toContainEqual(
          expect.objectContaining({
            path: "/value",
            state: "literal",
            value: 1,
          }),
        );
    });
  },
  120_000,
);

cliTest(
  "retains possible aliases through skipped optional-chain and logical assignments",
  async ({ cli }) => {
    const cases = [
      ["optionalCall", "receiver?.method(alias=replacement)"],
      ["optionalCallee", "receiver?.method?.(alias=replacement)"],
      ["optionalKey", "receiver?.[alias=replacement]"],
      ["continuedKey", "receiver?.field[alias=replacement]"],
      ["logicalWrite", "flag ||= (alias=replacement)"],
      ["optionalTypedCall", "receiver?.method!(alias=replacement)"],
      ["optionalTypedKey", "receiver?.field![alias=replacement]"],
      ["groupedCall", "(receiver?.method)(alias=replacement)"],
      ["ordinaryCall", "receiver.method(alias=replacement)"],
      ["groupedTypedCall", "(receiver?.method!)(alias=replacement)"],
      [
        "assertedGroupedCall",
        "(receiver?.method as ((value: unknown) => void))!(alias=replacement)",
      ],
    ] as const;
    const aliasesSource = cases
      .map(
        ([name, expression]) => `export function ${name}(receiver,flag) {
const original={member:1}; let alias=original; const replacement={member:2};
${expression}; alias.member=3; return {value:original.member};
}`,
      )
      .join("\n");
    const oracle = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module-typescript",
        "-e",
        `${aliasesSource}
const receiver={method() {},field:{}};
console.log(JSON.stringify([optionalCall(null),optionalCall(receiver),optionalCallee(null),optionalCallee(receiver),optionalKey(null),optionalKey(receiver),continuedKey(null),continuedKey(receiver),logicalWrite(null,true),logicalWrite(null,false),groupedCall(receiver),ordinaryCall(receiver),optionalTypedCall(null),optionalTypedCall(receiver),optionalTypedKey(null),optionalTypedKey(receiver),groupedTypedCall(receiver),assertedGroupedCall(receiver)]));`,
      ],
      { timeout: 10_000 },
    );
    expect(JSON.parse(oracle.stdout)).toEqual(
      [3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 1, 1, 3, 1, 3, 1, 1, 1].map((value) => ({
        value,
      })),
    );
    await verifyJavaScriptReturnShapes(
      cli,
      aliasesSource,
      (fields) => {
        for (const [name] of cases.slice(0, 7))
          expect(fields(name)).toContainEqual(
            expect.objectContaining({ path: "/value", state: "unknown" }),
          );
        for (const [name] of cases.slice(7))
          expect(fields(name)).toContainEqual(
            expect.objectContaining({
              path: "/value",
              state: "literal",
              value: 1,
            }),
          );
      },
      "app.ts",
    );
  },
  120_000,
);

cliTest(
  "orders object and array reads while keeping unsupported expression order unknown",
  async ({ cli }) => {
    const orderedSource = `
export function objectOrder() { let x=0; return {set:(x=1),value:x}; }
export function bothSides() { let x=0; return {before:x,set:(x=1),after:x}; }
export function arrayOrder() { let x=0; return [x,(x=1),x]; }
export function computedOrder() { let x=0; return {[x=1]:0,value:x}; }
export function templateOrder() { let x=0; return {value:\`\${x=1}\${x}\`}; }
`;
    const oracle = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `${orderedSource}
console.log(JSON.stringify([objectOrder(),bothSides(),arrayOrder(),computedOrder(),templateOrder()]));`,
      ],
      { timeout: 10_000 },
    );
    expect(JSON.parse(oracle.stdout)).toEqual([
      { set: 1, value: 1 },
      { before: 0, set: 1, after: 1 },
      [0, 1, 1],
      { "1": 0, value: 1 },
      { value: "11" },
    ]);
    await verifyJavaScriptReturnShapes(cli, orderedSource, (fields) => {
      for (const name of ["objectOrder", "computedOrder"])
        expect(fields(name)).toContainEqual(
          expect.objectContaining({
            path: "/value",
            state: "literal",
            value: 1,
          }),
        );
      expect(fields("bothSides")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "/before",
            state: "literal",
            value: 0,
          }),
          expect.objectContaining({
            path: "/after",
            state: "literal",
            value: 1,
          }),
        ]),
      );
      expect(fields("arrayOrder")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "/0", state: "literal", value: 0 }),
          expect.objectContaining({ path: "/2", state: "literal", value: 1 }),
        ]),
      );
      expect(fields("templateOrder")).toContainEqual(
        expect.objectContaining({ path: "/value", state: "unknown" }),
      );
    });
  },
  120_000,
);

cliTest(
  "shares captured dependency chains while separating values at escape capture points",
  async ({ cli }) => {
    const depth = 30;
    const source = `export function read(){let a0=1;
${Array.from({ length: depth }, (_, index) => `let a${index + 1}=a${index}+a${index};`).join("\n")}
const saved=a${depth};
${Array.from({ length: depth + 1 }, (_, index) => `a${index}=0;`).join("\n")}
return {value:saved};}
export function captured(external) {
let shared={value:1};
const before=shared.value; external(shared); const after=shared.value;
shared={value:2}; return {before,after};
}`;
    const oracle = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `${source}
console.log(JSON.stringify([read(),captured(object=>{object.value=3;})]));`,
      ],
      { timeout: 10_000 },
    );
    expect(JSON.parse(oracle.stdout)).toEqual([
      { value: 2 ** depth },
      { before: 1, after: 3 },
    ]);
    await verifyJavaScriptReturnShapes(cli, source, (fields) => {
      expect(fields("read")).toContainEqual(
        expect.objectContaining({
          path: "/value",
          state: "literal",
          value: 2 ** depth,
        }),
      );
      expect(fields("captured")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "/before",
            state: "literal",
            value: 1,
          }),
          expect.objectContaining({ path: "/after", state: "unknown" }),
        ]),
      );
    });
  },
  120_000,
);

cliTest(
  "keeps defaults and do-while tests conditional while preserving definite evaluation",
  async ({ cli }) => {
    const defaultsSource = `
export function objectPresent(){let x=0;const {a=(x=1)}={a:2};return {value:x,selected:a};}
export function objectMissing(){let x=0;const {a=(x=1)}={};return {value:x};}
export function arrayPresent(){let x=0;const [a=(x=1)]=[2];return {value:x};}
export function arrayMissing(){let x=0;const [a=(x=1)]=[];return {value:x};}
export function assignmentDefault(){let x=0,a;({a=(x=1)}={a:2});return {value:x};}
export function nestedDefault(){let x=0;const {a:{b=(x=1)}}={a:{b:2}};return {value:x};}
export function computedKey(){let x=0;const {[x=1]:a=9}={1:2};return {value:x};}
export function initializer(){let x=0;const {a}=(x=1,{a:2});return {value:x};}
export function nestedLeftKey(){let x=0;const {a:{[x=1]:b}={}}={a:{1:2}};return {value:x};}
export function doBreak(){let x=0;do{break;}while((x=1,false));return {value:x};}
export function doMaybe(flag){let x=0;do{if(flag)break;}while((x=1,false));return {value:x};}
export function doBody(){do{var x=1;}while(false);return {value:x};}
`;
    const oracle = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `${defaultsSource}
console.log(JSON.stringify([objectPresent(),objectMissing(),arrayPresent(),arrayMissing(),assignmentDefault(),nestedDefault(),computedKey(),initializer(),nestedLeftKey(),doBreak(),doMaybe(true),doMaybe(false),doBody()]));`,
      ],
      { timeout: 10_000 },
    );
    expect(JSON.parse(oracle.stdout)).toEqual([
      { value: 0, selected: 2 },
      ...[1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 1].map((value) => ({ value })),
    ]);
    await verifyJavaScriptReturnShapes(cli, defaultsSource, (fields) => {
      for (const name of [
        "objectPresent",
        "objectMissing",
        "arrayPresent",
        "arrayMissing",
        "assignmentDefault",
        "nestedDefault",
        "doBreak",
        "doMaybe",
      ])
        expect(fields(name)).toContainEqual(
          expect.objectContaining({ path: "/value", state: "unknown" }),
        );
      expect(fields("objectPresent")).toContainEqual(
        expect.objectContaining({
          path: "/selected",
          state: "literal",
          value: 2,
        }),
      );
      for (const name of [
        "computedKey",
        "initializer",
        "nestedLeftKey",
        "doBody",
      ])
        expect(fields(name)).toContainEqual(
          expect.objectContaining({
            path: "/value",
            state: "literal",
            value: 1,
          }),
        );
    });
  },
  120_000,
);

cliTest(
  "keeps a captured parameter unknown when comparing export shapes through CLI and MCP",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-captured-comparison-");
    const evidence = [];
    for (const [side, body] of [
      ["left", 'const saved=x; x=2; return {type:"ok",value:saved};'],
      ["right", 'return {type:"ok",value:2};'],
    ] as const) {
      const directory = join(root, side);
      await mkdir(directory);
      await writeFile(
        join(directory, "main.mjs"),
        `export function read(x) { ${body} }`,
      );
      const response = await cli.run({
        arguments: ["analyze-javascript-application", directory, "--json"],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      evidence.push(parseEvidence(response.json));
    }
    const [left, right] = evidence;
    if (left === undefined || right === undefined)
      throw new Error("Missing source Evidence");
    const input = {
      left,
      right,
      left_module_path: "main.mjs",
      left_export_name: "read",
      right_module_path: "main.mjs",
      right_export_name: "read",
    };
    const path = join(root, "comparison.json");
    await writeFile(path, JSON.stringify(input));
    const response = await cli.run({
      arguments: ["compare-javascript-export-shapes", path, "--json"],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const comparison = parseEvidence(response.json);
    expect(comparison.evidence_links).toEqual([
      left.evidence_id,
      right.evidence_id,
    ]);
    expect(comparison.normalized_result).toMatchObject({
      summary: {
        added: 0,
        removed: 0,
        changed: 0,
        unknown: 1,
      },
      changes: [expect.objectContaining({ path: "/value", status: "unknown" })],
    });
    const harness = await createApplicationMcpHarness();
    try {
      const reply = await harness.client.callTool({
        name: "compare_javascript_export_shapes",
        arguments: input,
      });
      expect(reply.isError).not.toBe(true);
      expect(parseEvidence(reply.structuredContent)).toEqual(comparison);
      const retained = await harness.client.callTool({
        name: "compare_javascript_export_shapes",
        arguments: {
          ...input,
          left: { kind: "retained-evidence", evidence_id: left.evidence_id },
          right: { kind: "retained-evidence", evidence_id: right.evidence_id },
        },
      });
      expect(retained.isError).not.toBe(true);
      expect(parseEvidence(retained.structuredContent)).toEqual(comparison);
    } finally {
      await harness.close();
    }
  },
  120_000,
);
