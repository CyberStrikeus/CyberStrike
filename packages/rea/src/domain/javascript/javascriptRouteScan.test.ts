import * as t from "@babel/types";
import { expect, it } from "vitest";
import { parseJavaScriptSource } from "./javascriptSourceParser.js";
import { indexJavaScriptBindingsWithReceiversSteps } from "./javascriptSemanticAnalysis.js";
import {
  completeSemanticSteps as complete,
  traverseJavaScriptAst,
} from "./javascriptSemanticTraversal.js";
import { JavaScriptRouteScan } from "./javascriptRouteScan.js";
import {
  classifyNextAppRoutePath,
  nextScriptBasePath,
  routePath,
} from "./javascriptRoutePaths.js";

const analyze = (source: string, budget?: number) => {
  const file = parseJavaScriptSource(source);
  if (file === null) throw new Error("fixture must parse");
  const index = complete(
    indexJavaScriptBindingsWithReceiversSteps(file.program),
  );
  complete(index.indexAmbientWritesSteps());
  const scan = complete(
    JavaScriptRouteScan.createSteps(file, index, undefined, budget),
  );
  traverseJavaScriptAst(file, {
    enter: (node, parent) => {
      scan.inspect(node, parent);
    },
  });
  return complete(scan.finishSteps());
};

it("reads route-record keys at most once beyond inspecting each property", () => {
  const count = 128;
  const source = ["candidate", "router"]
    .map(
      (name) =>
        `const ${name} = { ${Array.from({ length: count }, (_, i) => `path: "${name}${String(i)}"`).join(", ")}${name === "router" ? ", component: Page" : ""} };`,
    )
    .join("\n");
  const file = parseJavaScriptSource(source);
  if (file === null) throw new Error("fixture must parse");
  const index = complete(
    indexJavaScriptBindingsWithReceiversSteps(file.program),
  );
  complete(index.indexAmbientWritesSteps());
  const facts: { value: string; interpretation: "candidate" | undefined }[] =
    [];
  const scan = complete(
    JavaScriptRouteScan.createSteps(file, index, (fact) => {
      facts.push({ value: fact.value, interpretation: fact.interpretation });
    }),
  );
  let inspecting = false;
  let propertyCount = 0;
  let keyReads = 0;
  traverseJavaScriptAst(file, {
    enter: (node) => {
      if (!t.isObjectProperty(node)) return;
      propertyCount += 1;
      const key = node.key;
      // Observe real parsed keys without changing their values. Count only
      // owner work, excluding the AST walk's own reads and setup/indexing.
      Object.defineProperty(node, "key", {
        enumerable: true,
        configurable: true,
        get: () => {
          if (inspecting) keyReads += 1;
          return key;
        },
      });
    },
  });
  traverseJavaScriptAst(file, {
    enter: (node, parent) => {
      inspecting = true;
      try {
        scan.inspect(node, parent);
      } finally {
        inspecting = false;
      }
    },
  });
  expect(facts).toEqual(
    ["candidate", "router"].flatMap((name) =>
      Array.from({ length: count }, (_, i) => ({
        value: `${name}${String(i)}`,
        interpretation: name === "candidate" ? "candidate" : undefined,
      })),
    ),
  );
  expect(propertyCount).toBe(count * 2 + 1);
  expect(keyReads).toBeGreaterThanOrEqual(propertyCount);
  expect(keyReads).toBeLessThanOrEqual(propertyCount * 2);
});

it.each(["true", "(true as const)", "INDEX"])(
  "retains an index route with flag %s",
  (flag) => {
    const facts = analyze(
      `const INDEX=true;createBrowserRouter([{index:${flag},Component:Home}]);`,
    );
    expect(facts.candidates.map(({ path }) => path)).toEqual(["/"]);
    expect(facts.unresolved).toEqual([]);
  },
);

it.each([
  "createBrowserRouter([{index:INDEX,Component:Home}]);const INDEX=true;",
  "const INDEX=runtime;createBrowserRouter([{index:INDEX,Component:Home}]);",
])("retains unknown index flags without inventing a route: %s", (source) => {
  const facts = analyze(source);
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toEqual([
    expect.objectContaining({
      reason: expect.stringContaining("index-route flag"),
    }),
  ]);
});

it("keeps a known false index flag absent", () => {
  const facts = analyze(
    "const INDEX=false;createBrowserRouter([{index:INDEX,Component:Home}]);",
  );
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toEqual([]);
});

it("keeps module references out of Next page declarations and retains unknown runtime applicability", () => {
  const facts = analyze(
    `import Page from './components/app/string-only/page.js';const ordinary=require('./components/app/module-only/page.js');const page='app/unproven/page.js';`,
  );
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toMatchObject([
    { mechanism: "next-app-chunk", reason: expect.stringContaining("context") },
  ]);
  const after = analyze(
    `const page='app/reports/page.js';globalThis.TURBOPACK=[];`,
  );
  expect(after.candidates.map(({ path }) => path)).toEqual(["/reports"]);
});

it("joins router children and preserves each segment's source", () => {
  const facts = analyze(
    `createBrowserRouter([{path:'/reports',children:[{path:':id?',children:[{path:'settings'}]}]}]);`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/reports",
    "/reports/:id?",
    "/reports/:id?/settings",
  ]);
  expect(facts.candidates[2]!.segments.map(({ value }) => value)).toEqual([
    "/reports",
    ":id?",
    "settings",
  ]);
  expect(facts.candidates[2]!.derivation).toBe("joined");
  expect(facts.unresolved).toEqual([]);
});
it("uses typed literal segments and marks property-name fallbacks inferred", () => {
  const facts = analyze(
    `const ROUTES=defineRoutes({reports:{_$:'reports',settings:{_$:'settings'},history:{}}});`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/reports",
    "/reports/settings",
    "/reports/history",
  ]);
  expect(facts.candidates[2]).toMatchObject({
    confidence: "low",
    derivation: "inferred",
  });
  expect(facts.candidates[2]!.segments[1]!.origin).toBe("property-name");
});
it.each([
  ["defineRoutes({reports:({_$:'reports'} as const)});", ["/reports"]],
  [
    "defineRoutes({reports:{_$:'reports',detail:({_$:'detail'} as const)}});",
    ["/reports", "/reports/detail"],
  ],
  [
    "const detail={_$:'detail'};defineRoutes({reports:{_$:'reports',detail:(detail as typeof detail)}});",
    ["/reports", "/reports/detail"],
  ],
] as const)(
  "resolves typed children through erased wrappers: %s",
  (source, paths) => {
    const facts = analyze(source);
    expect(facts.candidates.map(({ path }) => path)).toEqual(paths);
    expect(facts.unresolved).toEqual([]);
  },
);
it("joins missing typed ancestor segments within a selected route-builder root", () => {
  const facts = analyze(`defineRoutes({reports:{settings:{_$:'settings'}}});`);
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/reports",
    "/reports/settings",
  ]);
  expect(facts.candidates[0]!.derivation).toBe("inferred");
  expect(facts.unresolved).toHaveLength(0);
});
it("does not reinterpret a typed descendant as a root after its parent was unresolved", () => {
  const facts = analyze(
    `defineRoutes({reports:{_$:prefix,settings:{_$:'settings'}}});`,
  );
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toHaveLength(1);
});
it("resolves stable route bindings without conflating shadowed variables", () => {
  const facts = analyze(
    `const routes=[{path:'/outer'}]; function f(){const routes=[{path:'/inner'}];useRoutes(routes)} createBrowserRouter(routes);`,
  );
  expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
    "/inner",
    "/outer",
  ]);
});
it("does not turn dynamic parents or changed arrays into exact whole paths", () => {
  const dynamic = analyze(
    `createBrowserRouter([{path:prefix,children:[{path:'settings'}]}]);`,
  );
  expect(dynamic.candidates).toEqual([]);
  expect(dynamic.unresolved).toHaveLength(1);
  const mutated = analyze(
    `const routes=[{path:'/before'}];routes[0].path='/after';useRoutes(routes);`,
  );
  expect(mutated.candidates).toEqual([]);
  expect(mutated.unresolved).toHaveLength(1);
});
it("keeps repeated route objects under different parents", () => {
  const facts = analyze(
    `const shared={path:'settings'};createBrowserRouter([{path:'/a',children:[shared]},{path:'/b',children:[shared]}]);`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/a",
    "/a/settings",
    "/b",
    "/b/settings",
  ]);
});
it("infers minified router configurations from view and children syntax", () => {
  const facts = analyze(
    `a([{path:'/reports',element:View,children:[{path:'settings',element:Settings}]}]);`,
  );
  expect(
    facts.candidates
      .filter(({ mechanism }) => mechanism === "nested-route-object")
      .map(({ path }) => path),
  ).toEqual(["/reports", "/reports/settings"]);
  expect(
    facts.candidates.every(({ derivation }) => derivation === "inferred"),
  ).toBe(true);
  expect(facts.unresolved).toHaveLength(1);
});
it("retains trailing slashes and optional route-pattern markers", () => {
  const facts = analyze(
    `createBrowserRouter([{path:'/reports/',children:[{path:':id?/'}]}]);`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/reports/",
    "/reports/:id?/",
  ]);
});
it("bounds aliased route expansion before allocating unbounded full paths", () => {
  const routes = Array.from(
    { length: 30 },
    (_, index) => `{path:'/r${index}',children:[shared]}`,
  ).join(",");
  const source = `const shared={path:'settings'};createBrowserRouter([${routes}]);`;
  const facts = analyze(source, 4096);
  expect(facts.capacity).toMatchObject({
    kind: "route-work-or-facts",
    limit_bytes: 4096,
  });
  expect(Buffer.byteLength(JSON.stringify(facts))).toBeLessThanOrEqual(4096);
  expect(facts.candidates.length).toBeLessThan(60);
});
it("preserves only fields established after an unknown spread", () => {
  const overwritten = analyze(
    `createBrowserRouter([{path:'/before',...unknown,children:[{path:'settings'}]}]);`,
  );
  expect(overwritten.candidates).toEqual([]);
  expect(overwritten.unresolved).toHaveLength(1);
  const restored = analyze(
    `createBrowserRouter([{...unknown,path:'/after',children:[{path:'settings'}]}]);`,
  );
  expect(restored.candidates.map(({ path }) => path)).toEqual([
    "/after",
    "/after/settings",
  ]);
  expect(restored.unresolved).toHaveLength(1);
});
it("invalidates fields before unknown computed keys while preserving exact empty keys", () => {
  const unknown = analyze(
    `createBrowserRouter([{path:'/before',[key]:'/after',children:[{path:'settings'}]}]);`,
  );
  expect(unknown.candidates).toEqual([]);
  expect(unknown.unresolved.length).toBeGreaterThan(0);
  const child = analyze(
    `createBrowserRouter([{path:'/before',[key]:{path:'/stale',element:View}}]);`,
  );
  expect(child.candidates).toEqual([]);
  expect(child.unresolved.length).toBeGreaterThan(0);
  const exact = analyze(
    `createBrowserRouter([{path:'/before',['']:true,children:[{path:'settings'}]}]);`,
  );
  expect(exact.candidates.map(({ path }) => path)).toEqual([
    "/before",
    "/before/settings",
  ]);
  expect(exact.unresolved).toEqual([]);
});
it("keeps a getter-backed parent unknown without treating unrelated loader methods as route gaps", () => {
  const getter = analyze(
    `createBrowserRouter([{get path(){return '/dynamic'},children:[{path:'settings'}]}]);`,
  );
  expect(getter.candidates).toEqual([]);
  expect(getter.unresolved).toHaveLength(1);
  const loader = analyze(
    `createBrowserRouter([{path:'/reports',loader(){return fetch('/api/reports')}}]);`,
  );
  expect(loader.candidates.map(({ path }) => path)).toEqual(["/reports"]);
  expect(loader.unresolved).toEqual([]);
});
it("excludes generic config paths and SVG data while retaining navigation candidates", () => {
  const facts = analyze(
    `const v={path:'/state/items/0',d:'M16.0123 18.7087H0V34',route:'contact_email'};router.push('/reports?tab=recent');`,
  );
  expect(
    facts.candidates
      .filter(({ mechanism }) => mechanism !== "route-string-constant")
      .map(({ path }) => path),
  ).toEqual(["/reports"]);
  expect(
    facts.candidates.some(({ path }) => path.includes("state/items")),
  ).toBe(false);
});
it.each([
  ["/_next/static/chunks/app/page-123.js", "/"],
  ["https://example.test/app/_next/static/chunks/app/page.tsx", "/"],
  [
    "https://example.test/app/_next/static/chunks/app/reports/page.js",
    "/reports",
  ],
  [
    "https://example.test/app/_next/static/chunks/pages/reports/page.js",
    undefined,
  ],
  ["app/app/page.tsx", "/app"],
  ["app/reports/page-helpers.js", undefined],
  ["app/reports/page-deadbeef.js", undefined],
  ["https://example.test/app/reports/page-helpers.js", undefined],
  ["app/_components/page.tsx", undefined],
  ["app/blog/_draft/page.js", undefined],
  ["app/(group)/_private/nested/page.tsx", undefined],
  ["app/%5Fcomponents/page.tsx", "/_components"],
  ["app/blog/%5fdraft/page.js", "/blog/%5fdraft"],
  ["app/%61/page.tsx", "/%61"],
  ["https://example.test/app/%61/page.tsx", undefined],
  ["app/a/page.tsx", "/a"],
  ["app/100%/page.tsx", "/100%"],
  ["app/team%2Fadmin/page.tsx", "/team%2Fadmin"],
  ["static/chunks/app/(account)/reports/[id]/page-deadbeef.js", "/reports/:id"],
  ["app/docs/[...slug]/page.js", "/docs/:slug+"],
  ["app/(account)/reports/[id]/page.tsx", "/reports/:id"],
  ["app/reports/page.ts", "/reports"],
  ["app/docs/[[...slug]]/page", "/docs/:slug*"],
  ["app/@modal/(.)photo/[id]/page.js", undefined],
  ["/assets/app.js", undefined],
] as const)(
  "interprets Next App Router path %s without claiming reachability",
  (value, expected) => {
    const route = classifyNextAppRoutePath(value, {
      kind: "source-literal",
      runtime: "next",
    });
    expect(route?.kind === "known" ? route.path : undefined).toBe(expected);
  },
);
it("distinguishes route-pattern markers, navigation query strings and Next asset bases", () => {
  expect(routePath("/reports/:id?")).toBe("/reports/:id?");
  expect(routePath("/reports?tab=recent#summary", { navigation: true })).toBe(
    "/reports",
  );
  expect(
    nextScriptBasePath("https://example.test/app/_next/static/chunks/1.js"),
  ).toBe("/app");
  expect(
    nextScriptBasePath("https://example.test/_next/static/chunks/1.js"),
  ).toBe("");
});

it("keeps rejected mutated configurations owned instead of reviving stale automatic roots", () => {
  for (const code of [
    `const routes=[{path:'/before',element:View}];routes[0].path='/after';useRoutes(routes);`,
    `const routes=[{path:'/before',element:View}];const alias=routes;alias[0].path='/after';useRoutes(routes);`,
    `let routes=[{path:'/before',element:View}];routes=[{path:'/after',element:View}];useRoutes(routes);`,
  ]) {
    const facts = analyze(code);
    expect(facts.candidates).toEqual([]);
    expect(facts.unresolved.length).toBeGreaterThan(0);
  }
});
it("does not turn ordinary wrapper objects into route ancestry", () => {
  const standard = analyze(
    `const config={routes:[{path:'/reports',component:Reports}]};x(config);`,
  );
  expect(standard.candidates.map((row) => row.path)).toEqual(["/reports"]);
  const typed = analyze(
    `const config={ui:{routes:{reports:{_$:'reports',settings:{_$:'settings'}}}}};x(config);`,
  );
  expect(typed.candidates.map((row) => row.path)).toEqual([
    "/reports",
    "/reports/settings",
  ]);
  expect(typed.unresolved).toHaveLength(1);
});
it("leaves missing unbound typed ancestors unknown instead of inventing container segments", () => {
  const facts = analyze(
    `const config={reports:{settings:{_$:'settings'}}};x(config);`,
  );
  expect(facts.candidates.map((row) => row.path)).toEqual(["/settings"]);
  expect(facts.candidates[0]!.derivation).toBe("inferred");
  expect(facts.unresolved).toHaveLength(1);
});

it("keeps dynamic route and navigation fragments out of independent literal candidates", () => {
  const facts = analyze(`
    createBrowserRouter([{path:'/users'}, {path:'/users/' + id}]);
    router.push('/users/' + id);
    router.replace(ready ? '/users/ready' : '/users/pending');
    router.navigate(\`/users/\${id}\`);
    route('/users/registered/' + id);
    const link = {href: '/users/link/' + id};
    const typed = defineRoutes({entry: {_$: '/users/typed/' + id}});
    const independent = '/users/settings';
    values.push(value);
  `);
  expect([...new Set(facts.candidates.map(({ path }) => path))].sort()).toEqual(
    ["/users", "/users/settings"],
  );
  expect(
    facts.unresolved.filter(
      ({ mechanism }) => mechanism === "navigation-target",
    ),
  ).toHaveLength(4);
  expect(
    facts.unresolved.some(({ mechanism }) => mechanism === "router-call"),
  ).toBe(true);
  expect(
    facts.unresolved.some(
      ({ mechanism }) => mechanism === "nested-route-object",
    ),
  ).toBe(true);
  expect(
    facts.unresolved.some(({ mechanism }) => mechanism === "typed-route-tree"),
  ).toBe(true);
});

it.each([
  `const secondary=[{path:'/reports',element:Reports}];createBrowserRouter([{path:'/shell',element:jsx(Panel,{routes:secondary})}]);`,
  `createBrowserRouter([{path:'/shell',element:jsx(Panel,{routes:[{path:'/reports',element:Reports}]})}]);`,
])(
  "keeps independent component route tables outside configuration ownership: %s",
  (code) => {
    const facts = analyze(code);
    expect(
      [...new Set(facts.candidates.map(({ path }) => path))].sort(),
    ).toEqual(["/reports", "/shell"]);
    expect(
      facts.unresolved.some(({ reason }) =>
        reason.includes("without a bound route-builder"),
      ),
    ).toBe(true);
  },
);

it("does not let push registrations own independent module bodies or structured data", () => {
  const facts = analyze(`
    globalThis.TURBOPACK=[];
    globalThis.TURBOPACK.push([123, function module(){
      const paths=['/docs/a','/docs/b'];router.push('/docs');
    }]);
    router.push(build(function callback(){ const route = '/docs/c'; }));
  `);
  expect([...new Set(facts.candidates.map(({ path }) => path))].sort()).toEqual(
    ["/docs", "/docs/a", "/docs/b", "/docs/c"],
  );
  expect(facts.unresolved).toEqual([
    expect.objectContaining({ mechanism: "navigation-target" }),
  ]);
});

it("retains dynamic destinations of recognized navigation calls without treating collection writes as navigation", () => {
  const facts = analyze(
    `router.navigate(target);router.push(path);history.replace(destination.href);const link={href:target};items.push(value);values.replace(value);`,
  );
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toHaveLength(4);
  expect(
    facts.unresolved.every(
      ({ mechanism }) => mechanism === "navigation-target",
    ),
  ).toBe(true);
});

it("retains pathless grouping nodes in ordinary inferred route ancestry", () => {
  const facts = analyze(
    `const routes=[{path:'/a',children:[{children:[{path:'b',element:B}]}]}];unknown(routes);`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/a", "/a/b"]);
});
it("preserves inferred ancestry through stable child arrays and object aliases", () => {
  const facts = analyze(
    `const child={path:'b',element:B};const children=[child];const alias=children;const routes=[{path:'/a',children:alias}];unknown(routes);`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/a", "/a/b"]);
});
it("indexes only effective children when a shared child's former parent was overwritten", () => {
  for (const overwritten of [
    "children:[]",
    "get children(){return []}",
    "...unknown",
  ]) {
    const facts = analyze(
      `const child={path:'b',element:B};const routes=[{path:'/old',children:[child],${overwritten}},{path:'/new',children:[child]}];unknown(routes);`,
    );
    expect(facts.candidates.map(({ path }) => path)).toEqual([
      "/new",
      "/new/b",
    ]);
  }
});
it("keeps ambiguous or cyclic inferred ancestry unknown instead of shortening paths", () => {
  for (const code of [
    `const child={path:'b',element:B};const routes=[{path:'/a',children:[child]},{path:'/c',children:[child]}];unknown(routes);`,
    `const route={path:'b',element:B,children:[route]};unknown(route);`,
    `const child={path:'b',element:B};const children=[child];children[0].path='changed';const routes=[{path:'/a',children}];unknown(routes);`,
  ]) {
    const facts = analyze(code);
    expect(facts.candidates).toEqual([]);
    expect(facts.unresolved.length).toBeGreaterThan(0);
  }
});
it("does not attach an independent typed tree to ordinary children ancestry", () => {
  const facts = analyze(
    `const wrapper={children:[{_$:'typed',detail:{_$:'detail'}}]};unknown(wrapper);`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/typed",
    "/typed/detail",
  ]);
  const ordinary = analyze(
    `const typed={_$:'typed',children:[{path:'/foreign',element:F}]};unknown(typed);`,
  );
  expect(ordinary.candidates.map(({ path }) => path).sort()).toEqual([
    "/foreign",
    "/typed",
  ]);
});

it("retains mixed ordinary and typed siblings independently of scan order and builder selection", () => {
  for (const children of [
    "{path:'/x',element:X},{_$:'typed'}",
    "{_$:'typed'},{path:'/x',element:X}",
  ]) {
    for (const consumer of ["unknown", "createBrowserRouter"]) {
      const facts = analyze(
        `const config={children:[${children}]};${consumer}(config);`,
      );
      expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
        "/typed",
        "/x",
      ]);
      expect(
        facts.candidates.find(({ path }) => path === "/typed")?.mechanism,
      ).toBe("typed-route-tree");
    }
  }
});

it("withholds rejected mixed configuration data from every automatic interpretation", () => {
  for (const children of [
    "{path:'/x',element:X},{_$:'before',detail:{_$:'detail'}}",
    "{_$:'before',detail:{_$:'detail'}},{path:'/x',element:X}",
  ]) {
    for (const mutation of [
      "config.children[0].path='/after'",
      "const alias=config;alias.children[1]._$='after'",
      "config={children:[{_$:'replacement'}]}",
    ]) {
      const facts = analyze(
        `let config={children:[${children}]};${mutation};createBrowserRouter(config);`,
      );
      expect(facts.candidates).toEqual([]);
      expect(facts.unresolved.length).toBeGreaterThan(0);
    }
  }
});

it("does not recycle route-field initializers or writes as independent Next constants", () => {
  const facts = analyze(
    `globalThis.TURBOPACK=[];createBrowserRouter([{path:'/reports'}]);const mixed={children:[{path:'/reports/stale-ordinary',element:View},{_$:'/reports/stale-typed'}]};mixed.children[1]._$='/reports/changed';createBrowserRouter(mixed);const independent='/reports/help';`,
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
    "/reports",
    "/reports/help",
  ]);
});

it("owns structured navigation fragments without leaking partial destinations", () => {
  const facts = analyze(
    `createBrowserRouter([{path:'/users'}]);router.push({pathname:'/users/' + id});router.navigate(['/users/',id]);router.push({path:suffix + ['/users/',id]});`,
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
    "/users",
  ]);
  expect(
    facts.unresolved.filter(
      ({ mechanism }) => mechanism === "navigation-target",
    ),
  ).toHaveLength(3);
});
it("extracts effective local pathname literals while owning nested navigation data", () => {
  const facts = analyze(
    `globalThis.TURBOPACK=[];router.push({pathname:'/users',query:{href:'/not-a-route'}});router.replace({pathname:'/old',pathname:'/new'});router.push({pathname:'../edit'});router.push({pathname:'/users/' + id});`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/users", "/new"]);
  expect(facts.unresolved).toHaveLength(2);
  expect(facts.candidates[0]!.segments[0]).toMatchObject({
    value: "/users",
    origin: "literal",
  });
});
it("keeps navigation object authorities and unknown fields unresolved", () => {
  const facts = analyze(
    `router.push({pathname:'/users',host:'example.test'});router.push({pathname:'/users',protocol:'https:'});router.push({pathname:'/users',href:'/other'});router.push({...options,pathname:'/users'});router.push({get pathname(){return '/users'}});router.push({pathname:'//example.test/users'});router.push({pathname:'https://example.test/users'});`,
  );
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toHaveLength(7);
});
it("does not promote concatenation or template fragments into independent path or module constants", () => {
  const facts = analyze(
    `globalThis.TURBOPACK=[];createBrowserRouter([{path:'/users'}]);const computed='/users/' + id;items.push({pathname:'/users/fragment/' + id});const exact='/users/settings';const file='app/admin/page.js' + suffix;`,
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))].sort()).toEqual(
    ["/users", "/users/settings"],
  );
  expect(facts.unresolved.map(({ mechanism }) => mechanism)).toEqual([
    "next-app-chunk",
  ]);
});
it("retains computed-expression ownership through erased TypeScript wrappers", () => {
  const facts = analyze(
    "globalThis.TURBOPACK=[];route('/users');const file=(('app/admin/page.js' as string)!) + suffix;const partial=(('/users/' as const) satisfies string) + id;const template=`prefix${('/users/' as string)}`;const exact=('app/reports/page.js' as const);const independent='/users/settings';",
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))].sort()).toEqual(
    ["/reports", "/users", "/users/settings"],
  );
  expect(
    facts.unresolved.some(({ mechanism }) => mechanism === "next-app-chunk"),
  ).toBe(true);
});
it("retains relative navigation uncertainty and excludes known external URL literals", () => {
  const facts = analyze(
    `navigate('settings');router.push('../edit');const link={href:'#details'};items.push('value');text.replace('../not-navigation','x');router.push('https://elsewhere.test/users');const external={href:'mailto:a@example.test'};`,
  );
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toHaveLength(3);
  expect(
    facts.unresolved.every(
      ({ mechanism }) => mechanism === "navigation-target",
    ),
  ).toBe(true);
});

it.each([
  "router.addRoute('admin',{path:'settings',component:View});",
  "const child={path:'settings',component:View};router.addRoute('admin',child);",
  "router.addRoute('admin',({path:'settings',component:View} as const));",
] as const)("keeps named-parent addRoute ancestry unresolved: %s", (source) => {
  const facts = analyze(source);
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved.some(({ reason }) => reason.includes("parent"))).toBe(
    true,
  );
});
it.each([
  "router.push(({pathname:'/users'} as const));",
  "router.push(({pathname:'/users'} satisfies {pathname:string}));",
  "router.push(('/users' as const));",
] as const)("reads navigation through erased wrappers: %s", (source) => {
  const facts = analyze(source);
  expect(
    facts.candidates
      .filter(({ mechanism }) => mechanism === "navigation-target")
      .map(({ path }) => path),
  ).toEqual(["/users"]);
  expect(facts.unresolved).toEqual([]);
});

it("preserves literal route registration with an independent handler", () => {
  const facts = analyze(
    "router.addRoute('/ordinary',()=>render());router.route('/legacy',handler);",
  );
  expect(
    facts.candidates
      .filter(({ mechanism }) => mechanism === "router-call")
      .map(({ path }) => path),
  ).toEqual(["/legacy", "/ordinary"]);
  expect(facts.unresolved).toEqual([]);
});

it.each([
  [
    "router.addRoute('admin',{path:'/settings',component:View,children:[{path:'detail'}]});",
    ["/settings", "/settings/detail"],
  ],
  [
    "router.addRoute('admin',{path:'settings',component:View,children:[{path:'relative'},{path:'/public',children:[{path:'detail'}]}]});",
    ["/public", "/public/detail"],
  ],
  [
    "createBrowserRouter([{path:computedParent,children:[{path:'relative'},{path:'/public'}]}]);",
    ["/public"],
  ],
] as const)(
  "retains rooted children through unknown ancestry: %s",
  (source, paths) => {
    const facts = analyze(source);
    expect(facts.candidates.map(({ path }) => path)).toEqual(paths);
    expect(facts.unresolved.length).toBeGreaterThan(0);
  },
);

it.each([
  "defineRoutes({reports:buildRoutes()});",
  "defineRoutes({reports:{_$:'reports',detail:buildRoutes()}});",
  "defineRoutes({reports:buildRoutes({path:'/unresolved-argument',component:View})});",
] as const)(
  "retains an interpretation gap for generated typed children: %s",
  (source) => {
    const facts = analyze(source);
    expect(facts.unresolved.length).toBeGreaterThan(0);
    expect(
      facts.candidates.some(({ path }) => path === "/unresolved-argument"),
    ).toBe(false);
  },
);

it.each([
  "router.push({pathname:'/users',query:{path:'/download/file',component:'preview'}});",
  "router.push(({pathname:'/users',query:{children:[{path:'/download/file',component:'preview'}]}} as const));",
] as const)(
  "keeps navigation data outside route root discovery: %s",
  (source) => {
    const facts = analyze(source);
    expect(facts.candidates.map(({ path }) => path)).toEqual(["/users"]);
    expect(facts.unresolved).toEqual([]);
  },
);
it("keeps callable bodies independent of navigation data ownership", () => {
  const facts = analyze(
    "router.push({pathname:'/users',query:{render:()=>({path:'/component',element:View})}});",
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/users",
    "/component",
  ]);
});

it.each([
  "globalThis.TURBOPACK=[];const modulePath='app/feed/(.)photo/page.tsx';",
  "globalThis.TURBOPACK=[];const modulePath='/app/feed/(.)photo/page.tsx';",
] as const)("retains intercepted module paths as unknown: %s", (source) => {
  const facts = analyze(source);
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toEqual([
    expect.objectContaining({
      mechanism: "next-app-chunk",
      reason: expect.stringContaining(
        source.includes("='/app/") ? "context" : "intercepted",
      ),
    }),
  ]);
});

it.each(["app/(.)photo/_private/page.tsx", "app/_private/(.)photo/page.tsx"])(
  "keeps private pages excluded before interpreting %s",
  (value) => {
    expect(
      classifyNextAppRoutePath(value, {
        kind: "source-literal",
        runtime: "next",
      }),
    ).toBeUndefined();
  },
);

it("tests long literals for page-shaped Next paths in linear time", () => {
  const classify = (value: string) =>
    classifyNextAppRoutePath(value, {
      kind: "source-literal",
      runtime: "unknown",
    })?.kind;
  const started = performance.now();
  expect(classify("app/".repeat(64_000))).toBeUndefined();
  expect(classify(`app/${"x/page?".repeat(32_000)}\nend`)).toBeUndefined();
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(classify("lib/app/a\nb/page.tsx")).toBe("unknown");
  expect(classify("app/page-a\nb.js?v=1")).toBe("unknown");
  expect(classify("app/x/page?first\nsecond")).toBeUndefined();
  expect(classify("app/x/page.tsx/extra")).toBeUndefined();
});

it("keeps the already-covered aliased binary fragment excluded", () => {
  const facts = analyze(
    "createBrowserRouter([{path:'/users'}]);const target={pathname:'/users/'+id};router.push(target);",
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/users"]);
  expect(facts.unresolved).toHaveLength(1);
});
it.each([
  [
    "createBrowserRouter([{path:'/users'}]);const prefix='/users/';const target={pathname:prefix+id};router.push(target);",
    ["/users"],
  ],
  [
    "createBrowserRouter([{path:'/users'}]);const target=['/users/',id];router.navigate(target);",
    ["/users"],
  ],
  [
    "const target={pathname:'/users',query:{path:'/download/file',component:'preview',href:'/query-data',module:'app/fake/page.tsx'}};router.push(target);",
    ["/users"],
  ],
  [
    "const query={path:'/download/file',component:'preview',href:'/query-data'};const target={pathname:'/users',query};router.push(target);",
    ["/users"],
  ],
  ["const target='/reports';router.push(target);", ["/reports"]],
  [
    "const pathname='/reports';const target={pathname};router.push(target);",
    ["/reports"],
  ],
] as const)(
  "owns aliased navigation values before interpreting their data: %s",
  (source, paths) => {
    const facts = analyze(source);
    expect(facts.candidates.map(({ path }) => path)).toEqual(paths);
  },
);
it("keeps two alias use sites distinct with initializer segment provenance", () => {
  const facts = analyze(
    "const target='/reports';router.push(target);router.replace(target);",
  );
  expect(facts.candidates).toHaveLength(2);
  expect(facts.candidates[0]!.location).not.toEqual(
    facts.candidates[1]!.location,
  );
  expect(facts.candidates[0]!.segments).toEqual(facts.candidates[1]!.segments);
});
it("keeps callable bodies independent of aliased navigation data", () => {
  const facts = analyze(
    "const query={render:()=>({path:'/component',element:View})};const target={pathname:'/users',query};router.push(target);",
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/users",
    "/component",
  ]);
});
it("leaves cyclic navigation aliases explicitly unknown", () => {
  const facts = analyze(
    "const first=second;const second=first;router.push(first);",
  );
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toHaveLength(1);
});

it("preserves explicitly selected routes that also supply navigation query data", () => {
  const facts = analyze(
    "const route={path:'/selected',component:View};createBrowserRouter([route]);router.push({pathname:'/users',query:route});",
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/users",
    "/selected",
  ]);
});
it("keeps reassigned alias values unknown instead of selecting an initializer", () => {
  const facts = analyze("let target='/old';target='/new';router.push(target);");
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toHaveLength(1);
});
it("does not resolve a shadowed navigation parameter to an outer binding", () => {
  const facts = analyze(
    "const target='/outer';function render(target){router.push(target);}",
  );
  expect(facts.candidates).toEqual([]);
  expect(facts.unresolved).toHaveLength(1);
});
it("accounts for long navigation alias resolution before exceeding its work budget", () => {
  const chain = Array.from(
    { length: 256 },
    (_, i) => `const item${i}=${i === 0 ? "'/users'" : `item${i - 1}`};`,
  ).join("");
  const facts = analyze(chain + "router.push(item255);", 2048);
  expect(facts.capacity?.kind).toBe("route-work-or-facts");
  expect(facts.candidates).toEqual([]);
});

it("does not trust a selected route after an earlier opaque navigation escape", () => {
  const facts = analyze(
    "const route={path:'/selected',component:View};router.push({pathname:'/users',query:route});createBrowserRouter([route]);",
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/users"]);
  expect(facts.unresolved.length).toBeGreaterThan(0);
});

it.each([
  "const registry={route:{path:'/independent',component:View},make(){return {};}};router.push({pathname:'/users',query:registry.make()});",
  "const registry={route:{path:'/independent',component:View},query:{value:1}};router.push({pathname:'/users',query:registry.query});",
])(
  "does not own unrelated data in a navigation callee or projection: %s",
  (source) => {
    const facts = analyze(source);
    expect(facts.candidates.map(({ path }) => path)).toEqual([
      "/users",
      "/independent",
    ]);
  },
);

it.each([
  "route ? {ok:1} : {ok:2}",
  "!!route",
  "route !== null",
  "(route as unknown) ? {ok:1} : {ok:2}",
  "route && {ok:1}",
  "(route, {ok:1})",
  "({[route]:1})",
])(
  "keeps independent route references outside navigation data: %s",
  (query) => {
    const facts = analyze(
      `const route={path:'/independent',component:View};router.push({pathname:'/users',query:${query}});`,
    );
    expect(facts.candidates.map(({ path }) => path)).toEqual([
      "/users",
      "/independent",
    ]);
  },
);

it.each([
  "flag ? route : {}",
  "flag && route",
  "route || {}",
  "route ?? {}",
  "(flag, route)",
  "route ? route : {}",
])("owns actual navigation data branches: %s", (query) => {
  const facts = analyze(
    `const route={path:'/query-data',component:View};router.push({pathname:'/users',query:${query}});`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/users"]);
});

it.each(
  [
    "const registry={route:{path:'/independent',component:View},query:{ok:1}};const {query}=registry;router.push({pathname:'/users',query});",
    "const registry={route:{path:'/independent',component:View},query:{path:'/query-data',component:Preview}};const {query}=registry;router.push({pathname:'/users',query});",
    "const registry={route:{path:'/independent',component:View},query:{path:'/query-data',component:Preview}};const {query:payload}=registry;router.push({pathname:'/users',query:payload});",
    "const registry={route:{path:'/independent',component:View},settings:{query:{path:'/query-data',component:Preview}}};const {settings:{query}}=registry;router.push({pathname:'/users',query});",
    "const registry={route:{path:'/independent',component:View},query:{ok:1}};const {route,...query}=registry;router.push({pathname:'/users',query});",
    "const registry={query:{path:'/query-data',component:Preview},route:{path:'/independent',component:View}};const {route,...payload}=registry;router.push({pathname:'/users',query:payload});",
    "const registry={query:{path:'/query-data',component:Preview},route:{path:'/independent',component:View},other:{path:'/other-data',component:Preview}};const {route,...payload}=registry;router.push({pathname:'/users',query:payload});",
    "const registry={settings:{query:{path:'/query-data',component:Preview},route:{path:'/independent',component:View}}};const {settings:{route,...payload}}=registry;router.push({pathname:'/users',query:payload});",
    "const registry={query:{path:'/query-data',component:Preview},route:{path:'/independent',component:View}};const alias=registry;const {route,...payload}=alias;router.push({pathname:'/users',query:payload});",
    "const registry=[{path:'/independent',component:View},{path:'/query-data',component:Preview}];const [route,...payload]=registry;router.push({pathname:'/users',query:payload});",
  ].flatMap((source) => [source, `function module(){${source}}`]),
)(
  "preserves independent routes beside selected query projections: %s",
  (source) => {
    const facts = analyze(source);
    expect(facts.candidates.map(({ path }) => path)).toEqual([
      "/users",
      "/independent",
    ]);
  },
);

it.each([
  "route('/users/:id?');",
  "createBrowserRouter([{path:('/users/:id?' as const)}]);",
  "const route={path:('/users/:id?' as const),component:View};",
  "const pattern='/users/:id?';createBrowserRouter([{path:pattern}]);",
])(
  "keeps optional registration patterns out of URL inference: %s",
  (source) => {
    const facts = analyze(source);
    expect(facts.candidates.map(({ path }) => path)).toEqual(["/users/:id?"]);
  },
);

it("preserves explicit URL navigation beside an optional registered pattern", () => {
  const facts = analyze(
    "route('/users/:id?');router.push('/users/:id?query=x');",
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
    "/users/:id?",
    "/users/:id",
  ]);
  expect(
    facts.candidates.filter(
      ({ mechanism }) => mechanism === "navigation-target",
    ),
  ).toEqual([expect.objectContaining({ path: "/users/:id" })]);
});

it("preserves initializer provenance for aliased registration segments", () => {
  const source =
    "const pattern='/users/:id?';createBrowserRouter([{path:pattern}]);";
  const facts = analyze(source);
  const segment = facts.candidates[0]!.segments[0]!;
  expect(
    source.slice(segment.location.start.column, segment.location.end.column),
  ).toBe("'/users/:id?'");
});

it.each(
  [
    "const paths=[];paths.push('/cache/key');",
    "text.replace('/assets/logo.svg','');",
    "const paths=[];paths.push(('/cache/key' as const));",
    "const literal='/cache/key';const paths=[];paths.push(literal);",
    "createBrowserRouter([{path:'/cache',component:View}]);const paths=[];paths.push('/cache/key');",
  ].flatMap((source) => [source, `function module(){${source}}`]),
)("does not admit data writes as navigation: %s", (source) => {
  const facts = analyze(source);
  expect(
    facts.candidates.filter(
      ({ mechanism }) => mechanism === "navigation-target",
    ),
  ).toEqual([]);
  expect(
    facts.candidates.filter(
      ({ path }) => path === "/cache/key" || path === "/assets/logo.svg",
    ),
  ).toEqual([]);
});

it.each(
  [
    "const fallback={path:'/independent',component:View};const {query=fallback}={query:{ok:1}};router.push({pathname:'/users',query});",
    "const fallback={path:'/independent',component:View};const alias=fallback;const {query:payload=alias}={query:{ok:1}};router.push({pathname:'/users',query:payload});",
    "const fallback={path:'/independent',component:View};const {options:{query=fallback}}={options:{query:{ok:1}}};router.push({pathname:'/users',query});",
  ].flatMap((source) => [source, `function module(){${source}}`]),
)("keeps inactive navigation defaults independent: %s", (source) => {
  const facts = analyze(source);
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/users",
    "/independent",
  ]);
});

it.each(
  [
    "const fallback={path:'/query-data',component:Preview};const {query=fallback}={};router.push({pathname:'/users',query});",
    "const target='/users';const paths=[];paths.push(target);router.push(target);",
  ].flatMap((source) => [source, `function module(){${source}}`]),
)("keeps actual defaults and recognized navigation owned: %s", (source) => {
  const facts = analyze(source);
  expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
    "/users",
  ]);
});

it.each(
  [
    "true ? {} : independent",
    "false ? independent : {}",
    "false && independent",
    "true || independent",
    "0 ?? independent",
    "({}) ?? independent",
  ].flatMap((expression) => [expression, `(${expression}) as unknown`]),
)("keeps literal-inactive query branches independent: %s", (expression) => {
  const facts = analyze(
    `const independent={path:'/independent',component:View};router.push({pathname:'/users',query:${expression}});`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual([
    "/users",
    "/independent",
  ]);
});
it.each(
  [
    "true ? independent : {}",
    "false ? {} : independent",
    "true && independent",
    "false || independent",
    "null ?? independent",
  ].flatMap((expression) => [expression, `(${expression}) as unknown`]),
)("owns literal-selected query branches: %s", (expression) => {
  const facts = analyze(
    `const independent={path:'/query-data',component:Preview};router.push({pathname:'/users',query:${expression}});`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/users"]);
});

it.each([
  "router.push({pathname:'/users',query:{item:independent,item:0}});",
  "router.push({pathname:'/users',query:{item:independent,['item']:0}});",
  "router.push({pathname:'/users',query:{1:independent,'1':0}});",
  "router.push({pathname:'/users',query:independent,query:{}});",
  "const payload={item:independent,item:0};router.push({pathname:'/users',query:payload});",
  "router.push({pathname:'/users',query:{item:independent,...unknown,item:0}});",
  "router.push({pathname:'/users',query:{item:independent,get item(){return 0;}}});",
])(
  "keeps overwritten navigation data references independent: %s",
  (navigation) => {
    const result = analyze(
      `const independent={path:'/independent',component:View};${navigation}`,
    );
    expect(result.candidates.map((candidate) => candidate.path).sort()).toEqual(
      ["/independent", "/users"],
    );
  },
);

it.each([
  "{item:0,item:independent}",
  "{item:independent,other:0}",
  "{item:independent,...unknown}",
  "{item:independent,[key]:0}",
])("retains effective or uncertain query data ownership: %s", (query) => {
  const result = analyze(
    `const independent={path:'/query-data',component:Preview};router.push({pathname:'/users',query:${query}});`,
  );
  expect(result.candidates.map((candidate) => candidate.path)).toEqual([
    "/users",
  ]);
});

it.each([
  "const registry={query:{path:'/query-data',component:Preview},route:{path:'/independent',component:View}};router.push({pathname:'/users',query:registry.query});",
  "const registry={query:{path:'/query-data',component:Preview},route:{path:'/independent',component:View}};router.push({pathname:'/users',query:registry['query']});",
  "const registry={query:{path:'/query-data',component:Preview},route:{path:'/independent',component:View}};router.push({pathname:'/users',query:registry?.query});",
  "const registry={query:{path:'/query-data',component:Preview},route:{path:'/independent',component:View}};const selected=registry.query;router.push({pathname:'/users',query:selected});",
  "const registry={options:{query:{path:'/query-data',component:Preview}},route:{path:'/independent',component:View}};router.push({pathname:'/users',query:registry.options.query});",
  "const registry=[{path:'/query-data',component:Preview},{path:'/independent',component:View}];router.push({pathname:'/users',query:registry[0]});",
])("owns only selected navigation member data: %s", (source) => {
  const facts = analyze(source);
  expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
    "/independent",
    "/users",
  ]);
});

it.each([
  "router.push({pathname:'/users',query:{['__proto__']:payload,__proto__:null}});",
  "router.push({pathname:'/users',query:{['__proto__']:payload,'__proto__':null}});",
  "router.push({pathname:'/users',query:{__proto__:payload,['__proto__']:0}});",
  "router.push({pathname:'/users',query:{__proto__:null,['__proto__']:payload}});",
  "router.push({pathname:'/users',query:{['__proto__']:0,__proto__:payload}});",
  "const registry={['__proto__']:payload,__proto__:null};router.push({pathname:'/users',query:registry['__proto__']});",
  "const registry={['__proto__']:payload,__proto__:null};const {['__proto__']:query}=registry;router.push({pathname:'/users',query});",
])("distinguishes prototype setters from own query slots: %s", (navigation) => {
  const facts = analyze(
    `const payload={path:'/query-data',component:Preview};${navigation}`,
  );
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/users"]);
});

it("keeps an overwritten shorthand proto property independent", () => {
  const facts = analyze(
    "const __proto__={path:'/independent',component:View};router.push({pathname:'/users',query:{__proto__,['__proto__']:0}});",
  );
  expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
    "/independent",
    "/users",
  ]);
});

it.each([
  "const registry={query:independent};registry.query={ok:1};router.push({pathname:'/users',query:registry.query});",
  "const registry={query:independent};registry['query']={ok:1};router.push({pathname:'/users',query:registry.query});",
  "const registry={options:{query:independent}};registry.options={query:{ok:1}};router.push({pathname:'/users',query:registry.options.query});",
  "const registry={query:independent};const alias=registry;alias.query={ok:1};router.push({pathname:'/users',query:registry.query});",
  "const registry={query:independent};escape(registry);registry.query={ok:1};router.push({pathname:'/users',query:registry.query});",
  "let query=independent;query={ok:1};router.push({pathname:'/users',query});",
  "let query=independent;query={ok:1};const selected=query;router.push({pathname:'/users',query:selected});",
  "const registry={query:independent};const current={path:'/query-new-data',component:Preview};registry.query=current;router.push({pathname:'/users',query:registry.query});",
])("keeps definitely replaced query sources independent: %s", (navigation) => {
  const facts = analyze(
    `const independent={path:'/independent',component:View};${navigation}`,
  );
  expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
    "/independent",
    "/users",
  ]);
});

it.each([
  "const registry={query:payload};if(flag)registry.query={ok:1};router.push({pathname:'/users',query:registry.query});",
  "const registry={query:payload};router.push({pathname:'/users',query:registry.query});registry.query={ok:1};",
  "let query=payload;router.push({pathname:'/users',query});query={ok:1};router.push({pathname:'/users',query});",
])("retains sources from possible or earlier query reads: %s", (navigation) => {
  const facts = analyze(
    `const payload={path:'/query-data',component:Preview};${navigation}`,
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
    "/users",
  ]);
});

it.each([
  "const alias=flag?registry:other;alias.query={ok:1};",
  "const alias=flag?other:registry;alias.query={ok:1};",
  "const aliases=[registry,other];aliases[key].query={ok:1};",
  "const holder=flag?{inner:registry}:{inner:other};holder.inner.query={ok:1};",
])("keeps query sources through possible receiver writes: %s", (write) => {
  const facts = analyze(
    `const payload={path:'/query-data',component:Preview};const registry={query:payload};const other={query:{ok:1}};${write}router.push({pathname:'/users',query:registry.query});`,
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
    "/users",
  ]);
});

it("proves a write through the same uncertain receiver at its own read", () => {
  const facts = analyze(
    "const payload={path:'/independent',component:View};const registry={query:payload};const other={query:{ok:1}};const alias=flag?registry:other;alias.query={ok:1};router.push({pathname:'/users',query:alias.query});",
  );
  expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
    "/independent",
    "/users",
  ]);
});

it.each([
  "const registry={query:payload,...unknown};router.push({pathname:'/users',query:registry.query});",
  "const registry={query:payload,[key]:0};router.push({pathname:'/users',query:registry.query});",
  "const registry={settings:{query:payload,...unknown}};router.push({pathname:'/users',query:registry.settings.query});",
  "const registry={...{query:payload}};router.push({pathname:'/users',query:registry.query});",
  "const registry={query:payload,...unknown};const {query}=registry;router.push({pathname:'/users',query});",
  "const registry=[...unknown,payload];router.push({pathname:'/users',query:registry[0]});",
  "const registry={get [key](){return payload},set query(value){}};router.push({pathname:'/users',query:registry.query});",
  "const registry=flag?{query:payload}:{query:{ok:1}};router.push({pathname:'/users',query:registry.query});",
  "const other=flag?{query:payload}:{};const registry={...other};router.push({pathname:'/users',query:registry.query});",
])("retains possible selected query values: %s", (navigation) => {
  const facts = analyze(
    `const payload={path:'/query-data',component:Preview};${navigation}`,
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
    "/users",
  ]);
});

it.each([
  "const registry={query:payload,...{query:{ok:1}}};",
  "const registry={query:payload,...unknown,query:{ok:1}};",
  "const registry={[key]:payload,query:{ok:1}};",
  "const registry={get [key](){return payload},get query(){return {ok:1}}};",
  "const registry=true?{query:{ok:1}}:{query:payload};",
])("preserves query values proved overwritten: %s", (registry) => {
  const facts = analyze(
    `const payload={path:'/independent',component:View};${registry}router.push({pathname:'/users',query:registry.query});`,
  );
  expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
    "/independent",
    "/users",
  ]);
});

it.each([
  "createBrowserRouter(registry.routes);",
  "createBrowserRouter(registry?.routes);",
  "const selected=registry.routes;createBrowserRouter(selected);",
  "const {routes}=registry;createBrowserRouter(routes);",
])(
  "preserves siblings outside a selected configuration: %s",
  (registration) => {
    const facts = analyze(
      `const registry={children:[{path:'/independent',component:View}],routes:[]};${registration}`,
    );
    expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
      "/independent",
    ]);
  },
);

it("preserves array siblings outside a selected configuration", () => {
  const facts = analyze(
    "const registry=[{children:[{path:'/independent',component:View}]},[]];createBrowserRouter(registry[1]);",
  );
  expect([...new Set(facts.candidates.map(({ path }) => path))]).toEqual([
    "/independent",
  ]);
});

it.each([
  "const registry={get a(){return this.a.b}};",
  "const registry={get a(){return this.b.x},get b(){return this.a.y}};",
])("keeps unrelated routes when a getter projection grows: %s", (registry) => {
  const facts = analyze(
    `${registry}router.push({pathname:'/p',query:registry.a});route('/independent');`,
  );
  expect(facts.capacity).toBeNull();
  expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
    "/independent",
    "/p",
  ]);
  expect(facts.unresolved).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringMatching(/cycl/i) }),
    ]),
  );
});

it("consumes finite repeated getter selections", () => {
  const facts = analyze(
    "const registry={get a(){return this}};router.push({pathname:'/p',query:registry.a.a.a});route('/independent');",
  );
  expect(facts.capacity).toBeNull();
  expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
    "/independent",
    "/p",
  ]);
  expect(facts.unresolved).toEqual([]);
});

it("keeps configuration cycles in their source interpretation", () => {
  const facts = analyze(
    "const registry={get a(){return this.a.b}};createBrowserRouter(registry.a);route('/independent');",
  );
  expect(facts.capacity).toBeNull();
  expect(facts.candidates.map(({ path }) => path)).toEqual(["/independent"]);
  expect(facts.unresolved).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        mechanism: "nested-route-object",
        reason: expect.stringMatching(/cyclic/i),
      }),
    ]),
  );
  expect(
    facts.unresolved.some(({ mechanism }) => mechanism === "navigation-target"),
  ).toBe(false);
});

it.each([
  "const registry={get a(){return this},get b(){return this.a.a},path:'/query-data',component:Preview};",
  "const registry={get a(){return this},get b(){return this.a.a.a},path:'/query-data',component:Preview};",
  "const registry={get a(){return this},get b(){return this.a},get c(){return this.b.b},path:'/query-data',component:Preview};",
])(
  "finishes getters before following the caller's remaining members: %s",
  (registry) => {
    const facts = analyze(
      `${registry}router.push({pathname:'/p',query:registry.a.${registry.includes("get c()") ? "c" : "b"}});route('/independent');`,
    );
    expect(facts.capacity).toBeNull();
    expect(facts.candidates.map(({ path }) => path).sort()).toEqual([
      "/independent",
      "/p",
    ]);
    expect(facts.unresolved).toEqual([]);
  },
);
