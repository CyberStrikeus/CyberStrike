import { expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";
import { completeSemanticSteps } from "./javascriptSemanticTraversal.js";
import {
  buildJavaScriptRouteInventorySteps,
  javaScriptRouteInventorySchema,
  type JavaScriptRouteInventoryInput,
} from "./javascriptRouteInventory.js";

const source = (
  key: string,
  text: string,
  url: string | null = null,
): JavaScriptRouteInventoryInput => ({
  key,
  path: url === null ? key : null,
  url,
  sha256: "a".repeat(64),
  container_sha256: null,
  status: "complete",
  reason: null,
  facts: analyzeJavaScriptStaticSource(text).routes!,
  ...(url === null && key.startsWith("app/")
    ? {
        next_app_context: {
          kind: "app-directory" as const,
          directory: "app",
          package: {
            path: "package.json",
            sha256: "b".repeat(64),
            container_sha256: "c".repeat(64),
          },
        },
      }
    : {}),
});
const build = (inputs: JavaScriptRouteInventoryInput[], bytes?: number) =>
  javaScriptRouteInventorySchema.parse(
    completeSemanticSteps(buildJavaScriptRouteInventorySteps(inputs, bytes)),
  );

it.each([
  ["hello world", "hello%20world"],
  ["team?admin", "team%3Fadmin"],
  ["team#admin", "team%23admin"],
] as const)(
  "preserves Next filename pattern %s and its source identity",
  (segment, encoded) => {
    const url = `https://example.test/_next/static/chunks/app/${encoded}/page-abc.js`;
    const result = build([
      source(`app/${segment}/page.js`, ""),
      source("captured.js", "", url),
      source(
        "runtime.js",
        `globalThis.TURBOPACK=[];const page=${JSON.stringify(url)};`,
      ),
    ]);
    expect(result.routes).toMatchObject([
      { path: `/${segment}`, source_count: 3, occurrence_count: 3 },
    ]);
    expect(result.routes).toHaveLength(1);
    expect(result.occurrences.map(({ source_id }) => source_id).sort()).toEqual(
      result.sources.map(({ id }) => id).sort(),
    );
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: `app/${segment}/page.js`, url: null }),
        expect.objectContaining({ path: null, url }),
      ]),
    );
    expect(result.unknowns).toEqual([]);
    expect(result.coverage).toEqual({
      scope: "provided-code-sources",
      source_parsing: "complete",
      candidate_enumeration: "complete",
      application_routes: "unknown",
    });
  },
);

it.each(["%00", "%09", "%0A", "%7F"])(
  "retains an interpretation gap for a Next filename containing %s",
  (encoded) => {
    const url = `https://example.test/_next/static/chunks/app/hello${encoded}world/page-abc.js`;
    const result = build([source("captured.js", "", url)]);
    expect(result.routes).toEqual([]);
    expect(result.unknowns).toMatchObject([
      {
        source_id: result.sources[0]!.id,
        kind: "interpretation",
        reason: expect.stringContaining("control character"),
      },
    ]);
    expect(result.sources[0]!.url).toBe(url);
    expect(result.coverage.candidate_enumeration).toBe("partial");
  },
);

it.each(["app/page.js", "app/hello\nworld/page.js"])(
  "does not promote page-shaped path %j without source-router applicability",
  (path) => {
    const unknown = source(path, "");
    delete (unknown as { next_app_context?: unknown }).next_app_context;
    const result = build([unknown]);
    expect(result.routes).toEqual([]);
    expect(result.unknowns).toMatchObject([
      {
        source_id: result.sources[0]!.id,
        kind: "interpretation",
        reason: expect.stringContaining("not measured"),
      },
    ]);
    expect(result.sources[0]!.path).toBe(path);
    expect(result.coverage.candidate_enumeration).toBe("partial");
  },
);

it("binds source identity to the package evidence establishing router applicability", () => {
  const first = source("app/page.js", "");
  const context = first.next_app_context;
  if (context?.kind !== "app-directory")
    throw new Error("Expected declared fixture context");
  const second = {
    ...first,
    next_app_context: {
      ...context,
      package: { ...context.package, sha256: "d".repeat(64) },
    },
  };
  expect(build([first]).sources[0]!.id).not.toBe(
    build([second]).sources[0]!.id,
  );
});

it("coalesces exact patterns while retaining independent occurrences and stable identities", () => {
  const inputs = [
    source("one.js", `router.push('/reports');`),
    source(
      "two.js",
      `createBrowserRouter([{path:'/reports',children:[{path:'settings'}]}]);`,
    ),
  ];
  const result = build(inputs),
    repeated = build([...inputs].reverse());
  expect(result.routes.map(({ path }) => path)).toEqual([
    "/reports",
    "/reports/settings",
  ]);
  expect(result.routes[0]).toMatchObject({
    occurrence_count: 2,
    source_count: 2,
  });
  const reportOccurrences = result.occurrences.filter(
    ({ route_id }) => route_id === result.routes[0]!.id,
  );
  expect(
    reportOccurrences
      .map(({ source_id, mechanism, segments }) => ({
        source: result.sources.find(({ id }) => id === source_id)?.key,
        mechanism,
        segments: segments.map(({ value }) => value),
      }))
      .sort((left, right) => left.source!.localeCompare(right.source!)),
  ).toEqual([
    {
      source: "one.js",
      mechanism: "navigation-target",
      segments: ["/reports"],
    },
    {
      source: "two.js",
      mechanism: "nested-route-object",
      segments: ["/reports"],
    },
  ]);
  expect(new Set(result.occurrences.map(({ id }) => id)).size).toBe(
    result.occurrences.length,
  );
  expect(result.routes.map(({ id }) => id)).toEqual(
    repeated.routes.map(({ id }) => id),
  );
  expect(result.source_manifest_sha256).toBe(repeated.source_manifest_sha256);
  expect(result.inventory_id).toBe(repeated.inventory_id);
  expect(result.coverage.application_routes).toBe("unknown");
});
it("chooses deterministic primary provenance when sources have equal confidence", () => {
  const inputs = [
    source("one.js", `router.push('/reports');`),
    source("two.js", `router.push('/reports');`),
  ];
  expect(build(inputs)).toEqual(build([...inputs].reverse()));
});
it("binds ordinary constants to application segments across sources and excludes framework filesystem noise", () => {
  const result = build([
    source("navigation.js", `router.push('/reports');`),
    source(
      "runtime.js",
      `globalThis.TURBOPACK=[];const routes=['/reports/:id','/ROOT/node_modules/next/process/','/_not-found'];`,
    ),
  ]);
  expect(result.routes.map(({ path }) => path)).toEqual([
    "/reports",
    "/reports/:id",
  ]);
  expect(result.statistics.unanchored_literals_excluded).toBe(2);
});
it.each(["api", "assets", "static", "_next"])(
  "retains constants under an anchored %s segment without promoting unanchored paths",
  (prefix) => {
    const result = build([
      source("route.js", `router.push('/${prefix}/status');`),
      source(
        "runtime.js",
        `globalThis.TURBOPACK=[];const same='/${prefix}/status';const help='/${prefix}/help';const other='/unanchored/noise';`,
      ),
    ]);
    const anchored = result.routes.find(
      ({ path }) => path === `/${prefix}/status`,
    );
    const descendant = result.routes.find(
      ({ path }) => path === `/${prefix}/help`,
    );
    expect(anchored).toMatchObject({ occurrence_count: 2, source_count: 2 });
    expect(descendant).toMatchObject({
      confidence: "low",
      classification: "unknown",
    });
    expect(result.routes.some(({ path }) => path === "/unanchored/noise")).toBe(
      false,
    );
    expect(result.coverage.application_routes).toBe("unknown");
  },
);
it("retains inferred Next script bases and the unprefixed path", () => {
  const result = build([
    source(
      "script",
      `router.push('/planner');`,
      "https://example.test/app/_next/static/chunks/123.js",
    ),
  ]);
  expect(result.routes.map(({ path }) => path)).toEqual(["/app/planner"]);
  expect(result.occurrences[0]).toMatchObject({
    unprefixed_path: "/planner",
    inferred_base_path: "/app",
    confidence: "low",
  });
  expect(result.sources[0]!.url).toBe(
    "https://example.test/app/_next/static/chunks/123.js",
  );
  expect(result.unknowns.some(({ kind }) => kind === "inferred-base")).toBe(
    true,
  );
});
it("reports missing source facts as partial and preserves filename-only discoveries without fake AST ranges", () => {
  const result = build([
    {
      ...source("app/reports/[id]/page.js", ""),
      status: "unavailable",
      reason: "source was not selected",
      facts: null,
    },
  ]);
  expect(result.coverage).toMatchObject({
    source_parsing: "partial",
    candidate_enumeration: "partial",
    application_routes: "unknown",
  });
  expect(result.routes[0]!.path).toBe("/reports/:id");
  expect(result.occurrences[0]).toMatchObject({
    origin: "source-path",
    source_range: null,
  });
});
it("does not interpret the URL authority or file URL prefix as an App Router directory or routing base", () => {
  const result = build([
    source("script", `router.push('/reports');`, "https://app/reports/page.js"),
  ]);
  expect(result.routes.map(({ path }) => path)).toEqual(["/reports"]);
  const local = build([
    source("file", `router.push('/reports');`, "file:///tmp/_next/123.js"),
  ]);
  expect(local.sources[0]!.base_path).toBeNull();
  expect(local.routes[0]!.path).toBe("/reports");
});
it("rejects forged aggregate counts and detached provenance", () => {
  const result = build([source("one.js", `router.push('/reports');`)]);
  expect(
    javaScriptRouteInventorySchema.safeParse({
      ...result,
      routes: result.routes.map((route) => ({
        ...route,
        occurrence_count: 99,
      })),
    }).success,
  ).toBe(false);
  expect(
    javaScriptRouteInventorySchema.safeParse({ ...result, sources: [] })
      .success,
  ).toBe(false);
});

it("retains a bounded prefix with explicit capacity and counts only retained facts", () => {
  const inputs = [
    source(
      "many.js",
      Array.from(
        { length: 100 },
        (_, index) => `router.push('/reports/${index}');`,
      ).join("\n"),
    ),
  ];
  const result = build(inputs, 8192);
  expect(result.routes.length).toBeGreaterThan(0);
  expect(result.routes.length).toBeLessThan(100);
  expect(result.coverage.candidate_enumeration).toBe("partial");
  expect(result.capacity?.limit_bytes).toBe(8192);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192);
  expect(() => build(inputs, 1)).toThrow(RangeError);
});

it("anchors generic constants before applying an inferred asset base", () => {
  const result = build([
    source(
      "prefixed.js",
      `globalThis.TURBOPACK=[];createBrowserRouter([{path:'/reports'}]);const paths=['/reports/:id','/noise'];`,
      "https://example.test/app/_next/static/chunks/one.js",
    ),
  ]);
  expect(result.routes.map((row) => row.path)).toEqual([
    "/app/reports",
    "/app/reports/:id",
  ]);
  expect(result.statistics.unanchored_literals_excluded).toBe(1);
});
it("classifies typed page configuration while generic server route calls remain unknown", () => {
  const result = build([
    source(
      "typed.js",
      `defineRoutes({reports:{_$:'reports',settings:{_$:'settings'}}});app.route('/api/users');`,
    ),
  ]);
  expect(
    result.routes
      .filter((row) => row.classification === "page")
      .map((row) => row.path),
  ).toEqual(["/reports", "/reports/settings"]);
  expect(result.routes.find((row) => row.path === "/api/users")).toMatchObject({
    classification: "unknown",
    classification_basis: "unknown",
  });
});

it("keeps TypeScript page filename provenance separate from syntax ranges", () => {
  const result = build([
    source(
      "app/(account)/reports/[id]/page.tsx",
      "export default function Page() { return null; }",
    ),
  ]);
  expect(result.routes).toHaveLength(1);
  expect(result.routes[0]).toMatchObject({
    path: "/reports/:id",
    classification: "page",
    classification_basis: "next-app-page",
  });
  expect(result.occurrences[0]).toMatchObject({
    origin: "source-path",
    source_range: null,
  });
});

it("coalesces inferred deployment roots without rewriting explicit trailing slashes", () => {
  const result = build([
    source(
      "root-call",
      "router.push('/');",
      "https://example.test/app/_next/static/chunks/runtime.js",
    ),
    source(
      "root-page",
      "",
      "https://example.test/app/_next/static/chunks/app/page.tsx",
    ),
    source("explicit.js", "router.push('/app');router.push('/app/');"),
  ]);
  expect(result.routes.map(({ path }) => path)).toEqual(["/app", "/app/"]);
  const root = result.routes.find(({ path }) => path === "/app")!;
  expect(root.source_count).toBe(3);
  const page = result.occurrences.find(({ origin }) => origin === "source-url");
  expect(page).toMatchObject({
    route_id: root.id,
    unprefixed_path: "/",
    inferred_base_path: "/app",
    source_range: null,
  });
  expect(result.unknowns.some(({ kind }) => kind === "inferred-base")).toBe(
    true,
  );
});

it("keeps enumeration partial when a recognized navigation target is unresolved", () => {
  const result = build([source("navigation.js", "router.navigate(target);")]);
  expect(result.routes).toEqual([]);
  expect(result.coverage.candidate_enumeration).toBe("partial");
  expect(result.unknowns).toEqual([
    expect.objectContaining({
      kind: "interpretation",
      source_id: result.sources[0]!.id,
    }),
  ]);
});

it.each(["/app/reports", "/reports"])(
  "matches based and unbased constants against application segments for %s",
  (anchor) => {
    const result = build([
      source(
        "mixed.js",
        `globalThis.TURBOPACK=[];router.push('${anchor}');const paths=['/reports/settings','/app/reports/history','/noise','/app/noise','/ROOT/node_modules/framework'];`,
        "https://example.test/app/_next/static/chunks/one.js",
      ),
    ]);
    expect(result.routes.map(({ path }) => path)).toEqual([
      "/app/reports",
      "/app/reports/history",
      "/app/reports/settings",
    ]);
    expect(result.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unprefixed_path: "/reports/settings",
          inferred_base_path: "/app",
        }),
        expect.objectContaining({
          unprefixed_path: "/app/reports/history",
          inferred_base_path: null,
        }),
      ]),
    );
  },
);

it("keeps filename and module-derived anchors application-relative when a deployment base matches an application segment", () => {
  const result = build([
    source(
      "page",
      "",
      "https://example.test/app/_next/static/chunks/app/app/page-abc.js",
    ),
    source(
      "root-runtime",
      "globalThis.TURBOPACK=[];const paths=['/app/settings','/noise'];",
      "https://example.test/_next/static/chunks/root.js",
    ),
    source(
      "module-runtime",
      "globalThis.TURBOPACK=[];const modulePath='app/app/page.js';",
      "https://example.test/app/_next/static/chunks/runtime.js",
    ),
  ]);
  expect(result.routes.map(({ path }) => path)).toEqual([
    "/app/app",
    "/app/settings",
  ]);
  const page = result.routes.find(({ path }) => path === "/app/app")!;
  expect(page.source_count).toBe(2);
  for (const origin of ["source-url", "source-syntax"])
    expect(result.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route_id: page.id,
          origin,
          unprefixed_path: "/app",
          inferred_base_path: "/app",
        }),
      ]),
    );
  expect(result.statistics.unanchored_literals_excluded).toBe(1);
});

it("reports generated typed configurations as partial even without retained candidates", () => {
  const result = build([
    source("generated.js", "defineRoutes({reports:buildRoutes()});"),
  ]);
  expect(result.routes).toEqual([]);
  expect(result.coverage.candidate_enumeration).toBe("partial");
  expect(result.unknowns).toHaveLength(1);
  expect(result.unknowns[0]!.kind).toBe("interpretation");
});

it.each([
  ["app/feed/(.)photo/page.tsx", null],
  [
    "page.js",
    "https://example.test/_next/static/chunks/app/feed/(.)photo/page-123.js",
  ],
] as const)(
  "retains intercepted filename metadata as partial: %s",
  (path, url) => {
    const result = build([
      source(path, "export default function Photo(){return null;}", url),
    ]);
    expect(result.routes).toEqual([]);
    expect(result.coverage.candidate_enumeration).toBe("partial");
    expect(result.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "interpretation",
          reason: expect.stringContaining("intercepted"),
          source_range: null,
        }),
      ]),
    );
  },
);

it("decodes captured Next script URL segments once while retaining source URL identity", () => {
  const url =
    "https://example.test/base/_next/static/chunks/app/%28shop%29/blog/%5Bid%5D/page-abc.js";
  const result = build([
    source("captured-page", "", url),
    source("app/blog/%5Bid%5D/page.js", ""),
  ]);
  expect(result.routes.map(({ path }) => path)).toEqual([
    "/base/blog/:id",
    "/blog/%5Bid%5D",
  ]);
  expect(result.sources.find((entry) => entry.url === url)?.url).toBe(url);
  expect(result.occurrences).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        origin: "source-url",
        unprefixed_path: "/blog/:id",
        inferred_base_path: "/base",
      }),
    ]),
  );
});

it.each(["team%2Fadmin", "team%5Cadmin", "%E0%A4%A"])(
  "keeps malformed Next URL segment %s unknown alongside usable script facts",
  (segment) => {
    const url = `https://example.test/_next/static/chunks/app/${segment}/page-abc.js`;
    const result = build([source("page", "router.push('/usable');", url)]);
    expect(result.routes.map(({ path }) => path)).toEqual(["/usable"]);
    expect(result.sources[0]?.url).toBe(url);
    expect(result.coverage.candidate_enumeration).toBe("partial");
    expect(result.unknowns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "interpretation",
          reason: expect.stringContaining("Next script URL"),
        }),
      ]),
    );
  },
);

it("preserves literal percent encoding after one script URL decode", () => {
  const result = build([
    source(
      "page",
      "",
      "https://example.test/_next/static/chunks/app/%255Bid%255D/page-abc.js",
    ),
  ]);
  expect(result.routes.map(({ path }) => path)).toEqual(["/%5Bid%5D"]);
});

it.each([
  "page%3Fnotes.js",
  "page%23notes.js",
  "page.js%3Fnotes",
  "page.js%23notes",
])("keeps encoded Next script filename delimiters literal: %s", (leaf) => {
  const url = `https://example.test/_next/static/chunks/app/dashboard/${leaf}`;
  const result = build([source("captured-page", "", url)]);
  expect(result.routes).toEqual([]);
  expect(result.sources[0]?.url).toBe(url);
});

it.each(["?cache=1", "#section", "?cache=1#section"])(
  "parses actual Next script URL suffix %s before classifying the filename",
  (suffix) => {
    const url = `https://example.test/_next/static/chunks/app/dashboard/page-abc.js${suffix}`;
    const result = build([source("captured-page", "", url)]);
    expect(result.routes.map(({ path }) => path)).toEqual(["/dashboard"]);
    expect(result.sources[0]?.url).toBe(url);
  },
);

it.each(["page?notes.js", "page#notes.js", "page.js?notes", "page.js#notes"])(
  "keeps filesystem Next page filename delimiters literal: %s",
  (leaf) => {
    const result = build([source(`app/dashboard/${leaf}`, "")]);
    expect(result.routes).toEqual([]);
  },
);
