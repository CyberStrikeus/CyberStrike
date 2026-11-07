import { expect, it } from "vitest";

import { analyzeJavaScriptSemantics } from "./javascriptSemanticAnalysis.js";

const analyze = (source: string) =>
  analyzeJavaScriptSemantics(
    `import { spawn } from 'node:child_process';\n${source}`,
  );

it("keeps interactions before replacement resolved and later ownership uncertain", () => {
  const ir = analyze(`
    let child = spawn('old');
    child.kill();
    child = { kill() {}, on() {} };
    child.kill();
    child.on('exit', done);
    const stable = spawn('stable'); stable.kill();
  `);
  const [old, stable] = ir.childProcessSpawns;
  expect(ir.childProcessInteractions).toMatchObject([
    { linkedProcessIds: [old!.processId], resolution: "complete" },
    { linkedProcessIds: [old!.processId], resolution: "partial" },
    { linkedProcessIds: [old!.processId], resolution: "partial" },
    { linkedProcessIds: [stable!.processId], resolution: "complete" },
  ]);
});

it("selects a new spawned child at each straight-line receiver read", () => {
  const ir = analyze(`
    let child = spawn('old'); child.kill();
    child = spawn('new'); child.once('exit', done); child.kill();
  `);
  const [old, replacement] = ir.childProcessSpawns;
  expect(ir.childProcessInteractions).toMatchObject([
    { linkedProcessIds: [old!.processId], resolution: "complete" },
    { linkedProcessIds: [replacement!.processId], resolution: "complete" },
    { linkedProcessIds: [replacement!.processId], resolution: "complete" },
  ]);
});

it("selects child ownership before and after a replacement in one expression", () => {
  const ir = analyze(`
    let child = spawn('old');
    (child.kill(), child = spawn('new'));
    child.kill();
  `);
  expect(ir.childProcessInteractions).toMatchObject(
    ir.childProcessSpawns.map(({ processId }) => ({
      linkedProcessIds: [processId],
      resolution: "complete",
    })),
  );
});

it.each([
  "class Stop { field = child.kill(); }",
  "class Stop { #field = child.kill(); }",
  "class Stop { ['field'] = child.kill(); }",
  "const Stop = class { field = (0, child.kill()); };",
  "class Stop { field = class { [child.kill()] = 0; }; }",
  "class Stop { stop() { child.kill(); } }",
  "class Stop { field = () => child.kill(); }",
])(
  "retains both child candidates across a deferred read: %s",
  (declaration) => {
    const ir = analyze(`
    let child = spawn('old');
    ${declaration}
    child = spawn('new');
    new Stop();
  `);
    expect(ir.childProcessSpawns).toHaveLength(2);
    expect(ir.childProcessInteractions[0]?.linkedProcessIds).toHaveLength(2);
    expect(ir.childProcessInteractions).toEqual([
      expect.objectContaining({
        linkedProcessIds: expect.arrayContaining(
          ir.childProcessSpawns.map(({ processId }) => processId),
        ),
        resolution: "partial",
      }),
    ]);
  },
);

it("does not prove an assignment-only child precedes an instance field read", () => {
  const ir = analyze(`
    let child;
    child = spawn('assigned');
    class Stop { field = child.kill(); }
    new Stop();
  `);
  expect(ir.childProcessInteractions).toMatchObject([
    {
      linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
      resolution: "partial",
    },
  ]);
});

it.each([
  "class Stop { static field = child.kill(); }",
  "class Stop { static #field = child.kill(); }",
  "class Stop { [child.kill()] = 0; }",
])("resolves reads evaluated at class definition: %s", (declaration) => {
  const ir = analyze(`
    let child = spawn('old');
    ${declaration}
    child = spawn('new');
    new Stop();
  `);
  expect(ir.childProcessInteractions).toMatchObject([
    {
      linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
      resolution: "complete",
    },
  ]);
});

it.each(["const", "let"])(
  "preserves a stable %s child across an instance field read",
  (kind) => {
    const ir = analyze(`
      ${kind} child = spawn('stable');
      class Stop { field = child.kill(); }
      new Stop();
    `);
    expect(ir.childProcessInteractions).toMatchObject([
      {
        linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
        resolution: "complete",
      },
    ]);
  },
);

it("retains a saved alias at its capture and marks a late alias uncertain", () => {
  const ir = analyze(`
    let child = spawn('old');
    const saved = child; const savedAgain = saved;
    child = { kill() {}, on() {} };
    const late = child;
    savedAgain.kill(); saved.on('exit', done); late.kill();
  `);
  const child = ir.childProcessSpawns[0]!;
  expect(ir.childProcessInteractions).toMatchObject([
    { linkedProcessIds: [child.processId], resolution: "complete" },
    { linkedProcessIds: [child.processId], resolution: "complete" },
    { linkedProcessIds: [child.processId], resolution: "partial" },
  ]);
});

it.each([
  "if (flag) child = replacement; child.kill();",
  "function replace() { child = replacement; } replace(); child.kill();",
  "function use() { child.kill(); } child = replacement; use();",
  "child &&= replacement; child.kill();",
  "child += replacement; child.kill();",
  "child++; child.kill();",
  "({ child } = replacement); child.kill();",
  "for (child of replacements) {} child.kill();",
  "while (flag) { child.kill(); child = replacement; }",
  "(child = replacement, child.kill());",
])("keeps uncertain child replacement explicit: %s", (body) => {
  const ir = analyze(`let child = spawn('old'); ${body}`);
  expect(ir.childProcessInteractions).toHaveLength(1);
  expect(ir.childProcessInteractions[0]).toMatchObject({
    linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
    resolution: "partial",
  });
});

it("does not resolve an interaction before its only spawn assignment", () => {
  const ir = analyze(`let child; child.kill(); child = spawn('later');`);
  expect(ir.childProcessInteractions).toMatchObject([
    { resolution: "partial" },
  ]);
});

it("keeps conditional spawn assignment and alias cycles uncertain", () => {
  const ir = analyze(`
    let child;
    if (flag) child = spawn('possible');
    let alias = child; child = alias;
    alias.kill();
  `);
  expect(ir.childProcessInteractions).toHaveLength(1);
  expect(ir.childProcessInteractions[0]).toMatchObject({
    linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
    resolution: "partial",
  });
});

it("preserves direct and stable captured children without admitting unrelated receivers", () => {
  const ir = analyze(`
    spawn('direct').kill();
    const child = spawn('captured'); function stop() { child.kill(); }
    { const child = { kill() {} }; child.kill(); }
  `);
  expect(ir.childProcessInteractions).toHaveLength(2);
  expect(
    ir.childProcessInteractions.every(
      ({ resolution }) => resolution === "complete",
    ),
  ).toBe(true);
});

it("keeps a default parameter child uncertain when a caller can supply another handle", () => {
  const ir = analyze(`
    function stop(child = spawn('fallback')) {
      child.kill(); child.on('exit', done);
    }
    stop({ kill() {}, on() {} });
  `);
  expect(ir.childProcessInteractions).toMatchObject([
    {
      linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
      resolution: "partial",
    },
    {
      linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
      resolution: "partial",
    },
  ]);
});

it("preserves the admitted scalar identity of an awaited spawn result", () => {
  const ir = analyze(`
    const child = await spawn('stable'); child.kill();
  `);
  expect(ir.childProcessInteractions).toMatchObject([
    {
      linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
      resolution: "complete",
    },
  ]);
});

it.each([
  "let child; function launch() { child = spawn('later'); } const alias = child; alias.kill();",
  "let child; { const alias = child; alias.kill(); } child = spawn('later');",
  "{ const alias = child; alias.kill(); } var child = spawn('later');",
])("keeps initialization across different bodies uncertain: %s", (source) => {
  const ir = analyze(source);
  expect(ir.childProcessInteractions).toMatchObject([
    {
      linkedProcessIds: [ir.childProcessSpawns[0]!.processId],
      resolution: "partial",
    },
  ]);
});

it("resolves an unconditional assignment before the read in the same function body", () => {
  const ir = analyze(`function stop() {
    let child; child = spawn('first'); child.kill();
    child = spawn('second'); child.kill();
  }`);
  expect(ir.childProcessInteractions).toMatchObject(
    ir.childProcessSpawns.map(({ processId }) => ({
      linkedProcessIds: [processId],
      resolution: "complete",
    })),
  );
});
