import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const endpoints = (source: string) =>
  analyzeJavaScriptStaticSource(source).endpoints.map(
    ({ kind, value, mechanism }) => ({ kind, value, mechanism }),
  );

const rpcEndpoints = (source: string) =>
  endpoints(source).filter(
    ({ mechanism }) =>
      mechanism.startsWith("trpc:") || mechanism.startsWith("graphql:"),
  );

describe("RPC object property ownership", () => {
  it.each([
    ['url: "/trpc/old", url: "/trpc/live"', "/trpc/live"],
    ['url: "/trpc/old", url: runtimeUrl', null],
    ['url: "/trpc/old", ...options', null],
    [
      'url: "/trpc/old", ...{helper(){},url:"/trpc/ignored",url:"/trpc/live"}',
      "/trpc/live",
    ],
    ['url: "/trpc/old", [key]: runtimeUrl', null],
    ['url: "/trpc/old", get url() { return runtimeUrl; }', null],
    ['url: "/trpc/old", url() {}', null],
    ['...options, url: "/trpc/live", headers: {}', "/trpc/live"],
    ['[key]: runtimeUrl, url: "/trpc/live"', "/trpc/live"],
    ['url: "/trpc/old", ["url"]: "/trpc/live"', "/trpc/live"],
    ['url: "/trpc/old", [`url`]: "/trpc/live"', "/trpc/live"],
    ['url: "/trpc/live", [`headers`]: {}', "/trpc/live"],
    ['url: "/trpc/live", [1n]: {}', "/trpc/live"],
    ['url: "/trpc/live", [0x1n]: {}', "/trpc/live"],
    ['url: "/trpc/live", [0b1n]: {}', "/trpc/live"],
    ['url: "/trpc/live", [-1n]: {}', "/trpc/live"],
  ] as const)(
    "reads only the final known link URL from {%s}",
    (options, value) => {
      expect(rpcEndpoints(`httpBatchLink({ ${options} });`)).toEqual(
        value === null
          ? []
          : [{ kind: "network", value, mechanism: "trpc:link:httpBatchLink" }],
      );
    },
  );

  it.each([
    ['operation: "mutation"', "Old", "graphql:mutation"],
    ['name: { kind: "Name", value: "Current" }', "Current", "graphql:query"],
    ['kind: "FragmentDefinition"', null, null],
    ["name: runtimeName", null, null],
    ["get name() { return runtimeName; }", null, null],
    ["...options", null, null],
    ["[key]: runtimeValue", null, null],
  ] as const)(
    "honors final GraphQL document properties: %s",
    (override, value, mechanism) => {
      const source = `const doc = {
      kind: "OperationDefinition", operation: "query",
      name: { kind: "Name", value: "Old" }, ${override}
    };`;
      expect(rpcEndpoints(source)).toEqual(
        value === null ? [] : [{ kind: "network", value, mechanism }],
      );
    },
  );
});

describe("tRPC procedure recognition", () => {
  it("preserves lexical clients and router members with browser-global spellings", () => {
    expect(
      rpcEndpoints(`function scope() {
      const history=createTRPCClient({links:[httpBatchLink({url:'/api/trpc'})]});
      history.archive.query();
      history.history.list.query();
      history.endpoints.list.query();
      navigator.permissions.query({name:'geolocation'});
      api.endpoints.list.useQuery();
    }`),
    ).toEqual([
      {
        kind: "network",
        value: "/api/trpc",
        mechanism: "trpc:link:httpBatchLink",
      },
      { kind: "network", value: "archive", mechanism: "trpc:procedure:query" },
      {
        kind: "network",
        value: "history.list",
        mechanism: "trpc:procedure:query",
      },
      {
        kind: "network",
        value: "endpoints.list",
        mechanism: "trpc:procedure:query",
      },
    ]);
  });

  it("recognizes React hook procedures on a renamed proxy root", () => {
    expect(
      rpcEndpoints(`
        const a = n.post.byId.useQuery({ id: 1 });
        const b = n.post.add.useMutation();
        n.feed.useInfiniteQuery({ limit: 10 });
        n.onEvent.useSubscription(undefined, { onData() {} });
        n.invoice.list.useSuspenseQuery();
      `),
    ).toEqual([
      {
        kind: "network",
        value: "post.byId",
        mechanism: "trpc:procedure:useQuery",
      },
      {
        kind: "network",
        value: "post.add",
        mechanism: "trpc:procedure:useMutation",
      },
      {
        kind: "network",
        value: "feed",
        mechanism: "trpc:procedure:useInfiniteQuery",
      },
      {
        kind: "network",
        value: "onEvent",
        mechanism: "trpc:procedure:useSubscription",
      },
      {
        kind: "network",
        value: "invoice.list",
        mechanism: "trpc:procedure:useSuspenseQuery",
      },
    ]);
  });

  it("recognizes TanStack React Query integration option factories", () => {
    expect(
      rpcEndpoints(`
        useQuery(e.invoice.list.queryOptions({ page: 1 }));
        useMutation(e.invoice.create.mutationOptions());
        client.invalidateQueries({ queryKey: e.invoice.list.queryKey() });
      `),
    ).toEqual([
      {
        kind: "network",
        value: "invoice.list",
        mechanism: "trpc:procedure:queryOptions",
      },
      {
        kind: "network",
        value: "invoice.create",
        mechanism: "trpc:procedure:mutationOptions",
      },
    ]);
  });
});

describe("tRPC procedure recognition", () => {
  it("recognizes vanilla client calls and link URLs only in sources carrying a tRPC marker", () => {
    expect(
      rpcEndpoints(`
        const client = createTRPCClient({
          links: [httpBatchLink({ url: "/api/trpc" })],
        });
        const bilbo = await client.getUser.query("id_bilbo");
        await client.post.add.mutate({ title: "x" });
        client.onPost.subscribe(undefined, { onData() {} });
      `),
    ).toEqual([
      {
        kind: "network",
        value: "/api/trpc",
        mechanism: "trpc:link:httpBatchLink",
      },
      { kind: "network", value: "getUser", mechanism: "trpc:procedure:query" },
      {
        kind: "network",
        value: "post.add",
        mechanism: "trpc:procedure:mutate",
      },
      {
        kind: "network",
        value: "onPost",
        mechanism: "trpc:procedure:subscribe",
      },
    ]);
    expect(
      rpcEndpoints(`
        const rows = await pool.users.query("select 1");
        emitter.changes.subscribe(listener);
        store.cart.mutate(update);
      `),
    ).toEqual([]);
  });

  it("requires corroboration for request methods shared with Apollo, RxJS and stores", () => {
    // The source carries a tRPC marker, so only the call shape can decide.
    expect(
      rpcEndpoints(`
        class TRPCClientError extends Error {}
        this.client.query({ query: q });
        e.queryManager.query(options);
        this.untypedClient.query("path", input);
        this.route.params.subscribe((params) => params);
        t.current.subscribe(listener);
        r.store.subscribe(() => {});
        n.cache.mutate(update);
        o.k.endpoints.getPosts.useQuery();
        e.api.endpoints.list.useQuery();
        this.trpc.invoice.list.useQuery();
      `),
    ).toEqual([]);
    expect(
      rpcEndpoints(`
        class TRPCClientError extends Error {}
        e.invoice.list.query({ page: 1 });
        e.invoice.onChange.subscribe(undefined, { onData() {} });
      `),
    ).toEqual([
      {
        kind: "network",
        value: "invoice.list",
        mechanism: "trpc:procedure:query",
      },
      {
        kind: "network",
        value: "invoice.onChange",
        mechanism: "trpc:procedure:subscribe",
      },
    ]);
  });

  it("never reports browser globals or RTK Query endpoints as procedures", () => {
    expect(
      rpcEndpoints(`
        class TRPCClientError extends Error {}
        navigator.permissions.query({ name: "geolocation" });
        window.navigator.permissions.query({ name: "camera" });
        api.endpoints.getPosts.useQuery();
        api.useGetPostsQuery();
        useQuery({ queryKey: ["x"] });
      `),
    ).toEqual([]);
  });
});

describe("tRPC binding identity and bundled syntax", () => {
  it("keeps client bindings local to their lexical declaration", () => {
    expect(
      rpcEndpoints(`
      function first() { const c = createTRPCClient({}); c.users.query(); }
      function unrelated(c) { c.users.query("select 1"); }
      const c = createTRPCClient({});
      function closure() { c.posts.query(); }
      function shadowed() { c.users.query(); var c = pool; }
      { const c = pool; c.users.query(); }
      try {} catch (c) { c.users.query(); }
    `),
    ).toEqual([
      { kind: "network", value: "users", mechanism: "trpc:procedure:query" },
      { kind: "network", value: "posts", mechanism: "trpc:procedure:query" },
    ]);
  });

  it("does not corroborate overwritten or destructured client bindings", () => {
    expect(
      rpcEndpoints(`
      let c = createTRPCClient({}); c = pool; c.users.query();
      const { client } = createTRPCClient({}); client.users.query();
    `),
    ).toEqual([]);
    expect(
      rpcEndpoints(`
      var c = createTRPCClient({}); c.users.query();
    `),
    ).toEqual([
      { kind: "network", value: "users", mechanism: "trpc:procedure:query" },
    ]);
  });

  it("retains one client initializer across variable redeclarations", () => {
    expect(
      rpcEndpoints(`
      var c;
      var c = createTRPCClient({});
      var c;
      c.users.query();

      var replaced;
      var replaced = createTRPCClient({});
      replaced = pool;
      replaced.posts.query();

      var initializedTwice = createTRPCClient({});
      var initializedTwice = pool;
      initializedTwice.comments.query();

      var conditional;
      if (flag) { var conditional = createTRPCClient({}); }
      conditional.groups.query();
    `),
    ).toEqual([
      { kind: "network", value: "users", mechanism: "trpc:procedure:query" },
    ]);
  });

  it("recognizes surviving factory names inside bundled call wrappers", () => {
    expect(
      rpcEndpoints(`
      const c = (0, t.createTRPCClient)({
        links: [(0, t.httpBatchLink)({ url: "/api/rpc" })],
      });
      c.users.query();
      const p = (t.createTRPCProxyClient as any)({});
      p.posts.query();
      (0, t.httpLink)({ url: "/api/other" });
    `),
    ).toEqual([
      {
        kind: "network",
        value: "/api/rpc",
        mechanism: "trpc:link:httpBatchLink",
      },
      { kind: "network", value: "users", mechanism: "trpc:procedure:query" },
      { kind: "network", value: "posts", mechanism: "trpc:procedure:query" },
      { kind: "network", value: "/api/other", mechanism: "trpc:link:httpLink" },
    ]);
  });

  it("preserves procedure paths beyond the former nesting cutoff", () => {
    const path = Array.from({ length: 64 }, (_, i) => `router${i}`).join(".");
    expect(rpcEndpoints(`root.${path}.useQuery();`)).toEqual([
      { kind: "network", value: path, mechanism: "trpc:procedure:useQuery" },
    ]);
  });
});

describe("GraphQL operation recognition", () => {
  it("recognizes named operations in tagged templates and string literals", () => {
    expect(
      rpcEndpoints(`
        const GET_USER = gql\`
          # comment
          query GetUser($id: ID!) { user(id: $id) { name } }
        \`;
        const UPDATE = "mutation UpdateInvoice($input: InvoiceInput!) { updateInvoice(input: $input) { id } }";
        const ON = \`subscription OnInvoice { invoiceChanged { id } } \${fragment}\`;
      `),
    ).toEqual([
      { kind: "network", value: "GetUser", mechanism: "graphql:query" },
      {
        kind: "network",
        value: "UpdateInvoice",
        mechanism: "graphql:mutation",
      },
      {
        kind: "network",
        value: "OnInvoice",
        mechanism: "graphql:subscription",
      },
    ]);
  });

  it("recognizes operations after leading fragment interpolations only when prior quasis are ignored", () => {
    expect(
      rpcEndpoints(`
        const one = gql\`  \${CORE_FIELDS}
          query CommentsForPost($postId: ID!) { comments { id } }\`;
        const two = gql\`\${CORE_FIELDS}
          # another fragment
          ,\${MORE_FIELDS}
          mutation UpdatePost($id: ID!) { updatePost(id: $id) { id } }\`;
        const prose = gql\`fragment prose before interpolation
          \${CORE_FIELDS}
          query NotAnOperation { viewer { id } }\`;
      `),
    ).toEqual([
      { kind: "network", value: "CommentsForPost", mechanism: "graphql:query" },
      { kind: "network", value: "UpdatePost", mechanism: "graphql:mutation" },
    ]);
  });

  it.each([
    ["query", "query # header\nGetUser { user }"],
    ["mutation", "mutation,# header\r\nGetUser { user }"],
    ["subscription", "subscription# header\rGetUser { user }"],
    ["query", "query GetUser # selection\n{ user }"],
    ["query", "query GetUser { # field\nuser }"],
    ["query", "query GetUser( # variable\n$id: ID!) { user }"],
    ["query", "query GetUser # directive\n@skip(if: false) { user }"],
    ["query", "query GetUser @ # directive name\nkeep { user }"],
    [
      "query",
      "# prefix\nquery # one\n, # two\nGetUser # three\n{ # four\nuser }",
    ],
  ])("recognizes %s header comments in %s", (type, text) => {
    const expected = [
      { kind: "network", value: "GetUser", mechanism: `graphql:${type}` },
    ];
    expect(rpcEndpoints(`const doc = ${JSON.stringify(text)};`)).toEqual(
      expected,
    );
    expect(rpcEndpoints("const doc = gql`" + text + "`; ")).toEqual(expected);
  });

  it.each([
    "query # GetUser { user }",
    "query GetUser # { user }",
    "query GetUser { # user }",
    "query # anonymous\n{ user }",
    "query GetUser # prose\nparameters",
    "query Get# split name\nUser { user }",
    "query GetUser @ # missing directive name",
    "query GetUser { # fragment\n...UserFields }",
    "query\u00a0GetUser { user }",
    "query\vGetUser { user }",
  ])("keeps incomplete or unsupported header text unknown: %s", (text) => {
    expect(rpcEndpoints(`const doc = ${JSON.stringify(text)};`)).toEqual([]);
  });

  it("retains operations after long ignored prefixes and long headers", () => {
    const name = "Operation" + "x".repeat(512);
    const text =
      "#" +
      "comment".repeat(700) +
      "\nquery " +
      name +
      " ".repeat(600) +
      "{ users { id } }";
    expect(rpcEndpoints(`const doc = ${JSON.stringify(text)};`)).toEqual([
      { kind: "network", value: name, mechanism: "graphql:query" },
    ]);
  });
});

describe("GraphQL document ownership", () => {
  it("retains the only operation in a standalone Source object", () => {
    expect(
      rpcEndpoints(`const source = {
        body: "query GetUser { user { id } }",
        locationOffset: { line: 1, column: 1 },
      };`),
    ).toEqual([
      { kind: "network", value: "GetUser", mechanism: "graphql:query" },
    ]);
  });

  it("does not deduplicate an unrelated Source against the same operation name", () => {
    expect(
      rpcEndpoints(`
        const source = {
          body: "query GetUser { user { id } }",
          locationOffset: { line: 1, column: 1 },
        };
        const operation = {
          kind: "OperationDefinition", operation: "query",
          name: { kind: "Name", value: "GetUser" },
        };
      `),
    ).toEqual([
      { kind: "network", value: "GetUser", mechanism: "graphql:query" },
      { kind: "network", value: "GetUser", mechanism: "graphql:query" },
    ]);
  });

  it.each(["referenced", "inline"])(
    "deduplicates a proven %s source reference",
    (representation) => {
      const source = `{
        body: "query GetUser { user { id } }",
        locationOffset: { line: 1, column: 1 },
      }`;
      const document = `export {}; const doc = { kind: "Document", definitions: [{
        kind: "OperationDefinition", operation: "query",
        name: { kind: "Name", value: "GetUser" },
      }], loc: { source: ${representation === "referenced" ? "source" : source} } };`;
      expect(
        rpcEndpoints(
          representation === "referenced"
            ? `const source = ${source};` + document
            : document,
        ),
      ).toEqual([
        { kind: "network", value: "GetUser", mechanism: "graphql:query" },
      ]);
    },
  );

  it("retains source text that differs from its document operation", () => {
    const actual = rpcEndpoints(`
        const source = {
          body: "query SourceUser { user { id } }",
          locationOffset: { line: 1, column: 1 },
        };
        const operation = {
          kind: "OperationDefinition", operation: "mutation",
          name: { kind: "Name", value: "UpdateUser" }, loc: { source },
        };
      `);
    expect(actual).toHaveLength(2);
    expect(actual).toEqual(
      expect.arrayContaining([
        { kind: "network", value: "SourceUser", mechanism: "graphql:query" },
        { kind: "network", value: "UpdateUser", mechanism: "graphql:mutation" },
      ]),
    );
  });

  it("selects only the final known standalone Source body", () => {
    expect(
      rpcEndpoints(`const source = {
        body: "query Old { user { id } }",
        body: "query Current { user { id } }",
        locationOffset: { line: 1, column: 1 },
      };`),
    ).toEqual([
      { kind: "network", value: "Current", mechanism: "graphql:query" },
    ]);
  });

  it("does not prove source ownership from an uninitialized reference", () => {
    const actual = rpcEndpoints(`
      const operation = {
        kind: "OperationDefinition", operation: "query",
        name: { kind: "Name", value: "GetUser" }, loc: { source },
      };
      const source = {
        body: "query GetUser { user { id } }",
        locationOffset: { line: 1, column: 1 },
      };
    `);
    expect(actual).toHaveLength(2);
    expect(actual.every(({ value }) => value === "GetUser")).toBe(true);
  });
});

describe("GraphQL document container ownership", () => {
  it.each([
    ["", "", 2],
    ["export {};", "", 1],
    ["function inspect() {", "}", 1],
  ] as const)(
    "distinguishes global script bindings from private lexical objects: %s",
    (prefix, suffix, count) => {
      expect(
        rpcEndpoints(`
          ${prefix}
          const source={body:"query GetUser { user { id } }",locationOffset:{line:1,column:1}};
          const doc={kind:"OperationDefinition",operation:"query",name:{kind:"Name",value:"GetUser"},loc:{source}};
          ${suffix}
        `),
      ).toHaveLength(count);
    },
  );

  it("does not prove a copy when a caller supplies direct eval", () => {
    expect(
      rpcEndpoints(`
        function inspect(eval) {
          const source={body:"query GetUser { user { id } }",locationOffset:{line:1,column:1}};
          const doc={kind:"OperationDefinition",operation:"query",name:{kind:"Name",value:"GetUser"},loc:{source}};
          eval("doc.loc.source={}");
        }
      `),
    ).toHaveLength(2);
  });

  it.each([
    ["export {}; ", "", 1],
    ["export {}; ", "holder.docs[0].loc.source = {};", 2],
    ["export ", "", 2],
  ] as const)(
    "checks containing object and array ownership: %s %s",
    (prefix, effect, count) => {
      expect(
        rpcEndpoints(`
          ${prefix}const holder = {docs:[{kind:"OperationDefinition",operation:"query",name:{kind:"Name",value:"GetUser"},loc:{source:{body:"query GetUser { user { id } }",locationOffset:{line:1,column:1}}}}]};
          ${effect}
        `),
      ).toHaveLength(count);
    },
  );

  it.each([
    ["", 'const indirect=globalThis; indirect.eval("loc.source={}");', 2],
    ["export {};", 'globalThis.eval("loc.source={}");', 1],
    ["export {};", 'eval("loc.source={}");', 2],
  ] as const)(
    "respects lexical exposure for indirect evaluation: %s %s",
    (prefix, effect, count) => {
      expect(
        rpcEndpoints(`
          ${prefix}
          const source={body:"query GetUser { user { id } }",locationOffset:{line:1,column:1}};
          const loc={source};
          const doc={kind:"OperationDefinition",operation:"query",name:{kind:"Name",value:"GetUser"},loc};
          ${effect}
        `),
      ).toHaveLength(count);
    },
  );

  it.each([
    "doc.loc.source = {};",
    "mutate(doc);",
    "export { doc };",
    'globalThis.eval("source.body = replacement");',
  ])("retains sources exposed through their document: %s", (effect) => {
    const actual = rpcEndpoints(`
      const source = {body:"query GetUser { user { id } }",locationOffset:{line:1,column:1}};
      const doc = {kind:"OperationDefinition",operation:"query",name:{kind:"Name",value:"GetUser"},loc:{source}};
      ${effect}
    `);
    expect(actual).toHaveLength(2);
  });

  it.each(["doc.loc.source = {};", "mutate(doc);", "export { doc };"])(
    "retains inline sources when the document escapes: %s",
    (effect) => {
      const actual = rpcEndpoints(`
      const doc = {kind:"OperationDefinition",operation:"query",name:{kind:"Name",value:"GetUser"},loc:{source:{body:"query GetUser { user { id } }",locationOffset:{line:1,column:1}}}};
      ${effect}
    `);
      expect(actual).toHaveLength(2);
    },
  );
});

describe("GraphQL source alias effects", () => {
  it.each([
    'source.body = "query Changed { user { id } }";',
    "mutate(source);",
    'eval("source.body = replacement");',
  ])(
    "retains Source observations after an unproven member effect: %s",
    (effect) => {
      const actual = rpcEndpoints(`
      const source = {
        body: "query GetUser { user { id } }",
        locationOffset: { line: 1, column: 1 },
      };
      ${effect}
      const operation = {
        kind: "OperationDefinition", operation: "query",
        name: { kind: "Name", value: "GetUser" }, loc: { source },
      };
    `);
      expect(actual.filter(({ value }) => value === "GetUser")).toHaveLength(2);
    },
  );

  it("does not prove source ownership through a changed location alias", () => {
    const actual = rpcEndpoints(`
      const source = {
        body: "query GetUser { user { id } }",
        locationOffset: { line: 1, column: 1 },
      };
      const loc = { source };
      loc.source = {};
      const operation = {
        kind: "OperationDefinition", operation: "query",
        name: { kind: "Name", value: "GetUser" }, loc,
      };
    `);
    expect(actual).toHaveLength(2);
  });

  it.each(["inline", "specifier"])(
    "retains separately exported sources: %s",
    (form) => {
      const actual = rpcEndpoints(`
      ${form === "inline" ? "export" : ""} const source = {
        body: "query GetUser { user { id } }",
        locationOffset: { line: 1, column: 1 },
      };
      ${form === "specifier" ? "export { source };" : ""}
      const doc = { kind: "OperationDefinition", operation: "query",
        name: { kind: "Name", value: "GetUser" }, loc: { source } };
    `);
      expect(actual).toHaveLength(2);
    },
  );
});

describe("GraphQL document recognition", () => {
  it("recognizes precompiled GraphQL document objects", () => {
    expect(
      rpcEndpoints(`
        const doc = { kind: "Document", definitions: [{
          kind: "OperationDefinition",
          operation: "query",
          name: { kind: "Name", value: "ListInvoices" },
          selectionSet: { kind: "SelectionSet", selections: [] },
        }] };
      `),
    ).toEqual([
      { kind: "network", value: "ListInvoices", mechanism: "graphql:query" },
    ]);
  });

  it("ignores anonymous operations and ordinary prose", () => {
    expect(
      rpcEndpoints(`
        const a = "query { viewer { id } }";
        const b = "query string parameters";
        const c = "mutation observer started";
        const d = { kind: "OperationDefinition", operation: "query" };
        const e = "mutation Observer {";
        const f = "query Search(";
        const g = "subscription Plan (monthly)";
      `),
    ).toEqual([]);
  });

  it("reports a private precompiled document once, not again from loc.source.body", () => {
    expect(
      rpcEndpoints(`
        export {};
        const doc = { kind: "Document", definitions: [{
          kind: "OperationDefinition",
          operation: "query",
          name: { kind: "Name", value: "GetUser" },
          selectionSet: { kind: "SelectionSet", selections: [] },
        }], loc: { start: 0, end: 40, source: {
          body: "query GetUser($id: ID!) { user(id: $id) { name } }",
          name: "GraphQL request",
          locationOffset: { line: 1, column: 1 },
        } } };
      `),
    ).toEqual([
      { kind: "network", value: "GetUser", mechanism: "graphql:query" },
    ]);
  });

  it.each([
    `body: "query Old { user }", body: "query Current { user }", locationOffset: { line: 1, column: 1 }`,
    `body: "query Old { user }", locationOffset: { line: 1, column: 1 }, ...sourceOptions`,
    `body: "query Old { user }", locationOffset: { line: 1, column: 1 }, ...{ body: "query Current { user }" }`,
    `...{ body: "query Old { user }" }, ...runtimeOptions, locationOffset: { line: 1, column: 1 }`,
  ])(
    "does not report overwritten or uncertain GraphQL source bodies: %s",
    (sourceFields) => {
      expect(
        rpcEndpoints(`
          export {};
          const source = { ${sourceFields} };
          const operation = {
            kind: "OperationDefinition",
            operation: "query",
            name: { kind: "Name", value: "Current" },
            loc: { source },
          };
        `),
      ).toEqual([
        { kind: "network", value: "Current", mechanism: "graphql:query" },
      ]);
    },
  );

  it("keeps ordinary GraphQL string scans outside Source-shaped objects", () => {
    expect(rpcEndpoints('const text = "query Standalone { user }";')).toEqual([
      { kind: "network", value: "Standalone", mechanism: "graphql:query" },
    ]);
  });
});

it("keeps existing network endpoint recognition unchanged", () => {
  expect(
    endpoints(`fetch("/api/invoices"); n.invoice.list.useQuery();`),
  ).toEqual([
    { kind: "network", value: "/api/invoices", mechanism: "call:fetch" },
    {
      kind: "network",
      value: "invoice.list",
      mechanism: "trpc:procedure:useQuery",
    },
  ]);
});

it("keeps named spreads unknown without proving nullish aliases", () => {
  expect(
    rpcEndpoints(`var p=null;const root=Function("return this")();
    root.p={url:"/changed"};httpLink({url:"/safe",...p});`),
  ).toEqual([]);
});

it("preserves named fields across primitive and string spreads while retaining unknown overrides", () => {
  const source = `
      httpLink({url:"/primitives",...false,...42,...1n,[void effect()]:0});
      httpLink({url:"/string",..."ab"});
      httpLink({url:"/array",...[1]});
      httpLink({url:"/unknown",...options});
    `;
  const observed: string[] = [];
  runInNewContext(
    source,
    {
      httpLink: (options: { url: string }) => observed.push(options.url),
      effect: () => {},
      options: { url: "/overwritten" },
    },
    { timeout: 1_000 },
  );
  expect(observed).toEqual([
    "/primitives",
    "/string",
    "/array",
    "/overwritten",
  ]);
  expect(rpcEndpoints(source)).toEqual([
    { kind: "network", value: "/primitives", mechanism: "trpc:link:httpLink" },
    { kind: "network", value: "/string", mechanism: "trpc:link:httpLink" },
    { kind: "network", value: "/array", mechanism: "trpc:link:httpLink" },
  ]);
});
