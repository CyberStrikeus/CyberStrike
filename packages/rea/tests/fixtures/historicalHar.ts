/** Synthetic HAR 1.2 fixture with producer-declared sizes independent of Unicode content. */
export const historicalHar = () => ({
  log: {
    version: "1.2",
    creator: { name: "rea-source-owned-fixture", version: "1" },
    entries: [
      {
        startedDateTime: "2026-10-07T13:00:00.123+08:00",
        time: 1.25,
        request: {
          method: "GET",
          url: "https://example.test/a?token=ordinary#fragment",
          httpVersion: "HTTP/2",
          cookies: [],
          headers: [],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/2",
          cookies: [],
          headers: [],
          content: { size: 99, mimeType: "text/plain", text: "雪😀\r\n" },
          redirectURL: "",
          headersSize: -1,
          bodySize: 99,
        },
        cache: {},
        timings: { send: 0, wait: 1.25, receive: 0 },
      },
    ],
  },
});

/** Unknown document fields may resemble entry fields without owning HTTP semantics. */
export const harWithContainerLookalikes = () => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0]!;
  const request = {
    ...entry.request,
    url: "https://user:password@example.test/opaque",
    headers: [{ name: "Authorization", value: "ordinary-root-evidence" }],
    cookies: [{ name: "session", value: "ordinary-root-evidence" }],
  };
  const response = {
    ...entry.response,
    redirectURL: "https://user:password@example.test/redirect",
    headers: [{ name: "Set-Cookie", value: "ordinary-root-evidence" }],
    content: {
      ...entry.response.content,
      encoding: "base64",
      text: "ordinary-root-evidence",
    },
  };
  return {
    ...fixture,
    request,
    response,
    log: {
      ...fixture.log,
      entries: [
        {
          ...entry,
          request,
          response: {
            ...response,
            content: { ...response.content, text: "QUJD" },
          },
        },
      ],
    },
  };
};

/** Request paths exercising only the public API surface format rules. */
export const apiSurfaceHar = () => {
  const fixture = historicalHar();
  const entry = fixture.log.entries[0]!;
  const paths = [
    "/users/8812",
    "/users/9031",
    "/ids/550e8400-e29b-41d4-a716-446655440000",
    "/ids/abcdef0123456789abcdef0123456789",
    "/dates/2024-02-29",
    "/api/v1/users",
    "/api/v2/users",
    "/api/Report2",
    "/api/Report3",
    "/api/CreateDocument",
    "/api/ListDocuments",
    "/ids/abc123",
    "/dates/2023-02-29",
  ];
  fixture.log.entries = paths.map((path, index) => ({
    ...entry,
    request: {
      ...entry.request,
      url: `https://api.example.test${path}?not-in-view=value`,
    },
    response: {
      ...entry.response,
      status: index === 1 ? 404 : 200,
      content: {
        ...entry.response.content,
        mimeType:
          index === 1 ? "text/plain" : "application/json; charset=utf-8",
      },
    },
  }));
  return fixture;
};

type ManifestRow = readonly [
  method: string,
  url: string,
  mimeType: string,
  text: string,
  postText?: string,
];

/** Twenty-eight recorded exchanges of a Grafana-shaped application: UI assets, a second origin, JSON API reads and writes. */
const ENVIRONMENT_MANIFEST_ROWS: readonly ManifestRow[] = [
  [
    "GET",
    "http://grafana.example/dashboards",
    "text/html",
    "<!doctype html><html><body>Grafana</body></html>",
  ],
  [
    "GET",
    "http://grafana.example/public/build/app.js",
    "text/javascript",
    "console.log('app');",
  ],
  [
    "GET",
    "https://grafana.example.com/api/plugins/announcements",
    "application/json",
    '{"items":[]}',
  ],
  [
    "GET",
    "http://grafana.example/api/org",
    "application/json",
    '{"id":1,"name":"Main Org."}',
  ],
  [
    "GET",
    "http://grafana.example/api/user",
    "application/json",
    '{"id":1,"login":"admin","isGrafanaAdmin":true}',
  ],
  [
    "GET",
    "http://grafana.example/api/users/2",
    "application/json",
    '{"id":2,"uid":"fg1jo96rvtvk0e","login":"probe","email":"probe@example.test"}',
  ],
  [
    "GET",
    "http://grafana.example/api/users/3",
    "application/json",
    '{"id":3,"uid":"ag1jo31kg1ekgc","login":"viewer","email":"viewer@example.test"}',
  ],
  [
    "GET",
    "http://grafana.example/api/users/2/orgs",
    "application/json",
    '[{"orgId":1,"name":"Main Org.","role":"Viewer"}]',
  ],
  [
    "GET",
    "http://grafana.example/api/search?query=probe&type=dash-db",
    "application/json",
    '[{"id":7,"uid":"acb4v6","title":"probe dashboard","type":"dash-db"}]',
  ],
  [
    "GET",
    "http://grafana.example/api/search?query=&type=dash-folder",
    "application/json",
    '[{"id":5,"uid":"fg1jo91e57e2ob","title":"probe folder","type":"dash-folder"}]',
  ],
  [
    "GET",
    "http://grafana.example/api/dashboards/uid/acb4v6",
    "application/json",
    '{"meta":{"type":"db","folderUid":"fg1jo91e57e2ob"},"dashboard":{"uid":"acb4v6","title":"probe dashboard","panels":[]}}',
  ],
  [
    "GET",
    "http://grafana.example/api/dashboards/uid/acb4v6/versions",
    "application/json",
    '{"versions":[{"id":1,"version":1}]}',
  ],
  [
    "GET",
    "http://grafana.example/api/folders/fg1jo91e57e2ob?accesscontrol=true",
    "application/json",
    '{"id":5,"uid":"fg1jo91e57e2ob","title":"probe folder"}',
  ],
  [
    "GET",
    "http://grafana.example/api/folders/general?accesscontrol=true",
    "application/json",
    '{"id":0,"uid":"general","title":"Dashboards"}',
  ],
  [
    "GET",
    "http://grafana.example/api/folders?limit=100&page=1",
    "application/json",
    '[{"id":5,"uid":"fg1jo91e57e2ob","title":"probe folder"}]',
  ],
  [
    "GET",
    "http://grafana.example/api/plugins/grafana-testdata-datasource/settings",
    "application/json",
    '{"id":"grafana-testdata-datasource","enabled":true}',
  ],
  [
    "GET",
    "http://grafana.example/api/plugins/grafana-lokiexplore-app/settings",
    "application/json",
    '{"id":"grafana-lokiexplore-app","enabled":true}',
  ],
  [
    "GET",
    "http://grafana.example/api/plugins/grafana-pyroscope-app/settings",
    "application/json",
    '{"id":"grafana-pyroscope-app","enabled":false}',
  ],
  [
    "GET",
    "http://grafana.example/api/teams/1",
    "application/json",
    '{"id":1,"name":"probe team","memberCount":1}',
  ],
  [
    "GET",
    "http://grafana.example/api/teams/1/members",
    "application/json",
    '[{"userId":2,"login":"probe"}]',
  ],
  [
    "POST",
    "http://grafana.example/api/folders",
    "application/json",
    '{"id":5,"uid":"fg1jo91e57e2ob","title":"probe folder"}',
    '{"title":"probe folder"}',
  ],
  [
    "POST",
    "http://grafana.example/api/annotations",
    "application/json",
    '{"id":11,"message":"Annotation added"}',
    '{"dashboardUID":"acb4v6","panelId":1,"time":1792000000000,"text":"probe","tags":["rea"]}',
  ],
  [
    "PUT",
    "http://grafana.example/api/folders/fg1jo91e57e2ob",
    "application/json",
    '{"id":5,"uid":"fg1jo91e57e2ob","title":"probe folder renamed"}',
    '{"title":"probe folder renamed","overwrite":true}',
  ],
  [
    "DELETE",
    "http://grafana.example/api/dashboards/uid/acb4v6",
    "application/json",
    '{"title":"probe dashboard","message":"Dashboard probe dashboard deleted"}',
  ],
  [
    "DELETE",
    "http://grafana.example/api/teams/1",
    "application/json",
    '{"message":"Team deleted"}',
  ],
  [
    "GET",
    "http://grafana.example/api/annotations?dashboardUID=acb4v6&limit=10",
    "application/json",
    '[{"id":11,"dashboardUID":"acb4v6","text":"probe"}]',
  ],
  [
    "GET",
    "http://grafana.example/api/datasources/uid/dg1jo96tern5sb/health",
    "application/json",
    '{"status":"OK","message":"Data source is working"}',
  ],
  [
    "GET",
    "http://grafana.example/avatar/46d229b033af06a191ff2267bca9ae56",
    "image/jpeg",
    "JFIF",
  ],
];

/** Playwright-declared HAR 1.2 fixture for the environment-manifest view; every body is synthetic. */
export const environmentManifestHar = () => ({
  log: {
    version: "1.2",
    creator: { name: "Playwright", version: "1.58.2" },
    browser: { name: "chromium", version: "143.0.7499.4" },
    pages: [
      {
        startedDateTime: "2026-10-17T18:00:00.000Z",
        id: "page@1",
        title: "Grafana",
        pageTimings: { onContentLoad: -1, onLoad: -1 },
      },
    ],
    entries: ENVIRONMENT_MANIFEST_ROWS.map(
      ([method, url, mimeType, text, postText]) => ({
        startedDateTime: "2026-10-17T18:00:00.000Z",
        time: 7.5,
        request: {
          method,
          url,
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            { name: "accept", value: "application/json, text/plain, */*" },
          ],
          queryString: [...new URL(url).searchParams].map(([name, value]) => ({
            name,
            value,
          })),
          headersSize: -1,
          bodySize: postText === undefined ? -1 : postText.length,
          ...(postText === undefined
            ? {}
            : { postData: { mimeType: "application/json", text: postText } }),
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [{ name: "content-type", value: mimeType }],
          content: { size: text.length, mimeType, text },
          redirectURL: "",
          headersSize: -1,
          bodySize: text.length,
        },
        cache: {},
        timings: { send: 0.5, wait: 5.0, receive: 2.0 },
      }),
    ),
  },
});

/** The Grafana-shaped HAR with one second between requests, so its timeline orders reads before the writes that follow them. */
export const environmentStateHar = () => {
  const har = environmentManifestHar();
  const start = Date.parse("2026-10-17T18:00:00.000Z");
  har.log.entries = har.log.entries.map((entry, index) => ({
    ...entry,
    startedDateTime: new Date(start + index * 1000).toISOString(),
  }));
  return har;
};
