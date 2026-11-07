import { expect, it, vi } from "vitest";
import { androidResultSchemas } from "../../../src/domain/android/androidAnalysis.js";

import {
  ANDROID_MANIFEST_LIMITS,
  parseAndroidManifestComponents,
  resolveAndroidComponentName,
} from "../../../src/android/AndroidManifestComponents.js";

it.each([
  [".sub.Target", "sub.Target", "partial"],
  ["com.example.sub.Target", "sub.Target", "partial"],
  [".sub.Target", ".sub.Target", "complete"],
  [".sub.Target", "com.example.sub.Target", "complete"],
  ["com.example.sub.Target", ".sub.Target", "complete"],
  ["com.example.sub.Target", "com.example.sub.Target", "complete"],
  [".Target", "Target", "complete"],
  ["sub.Target", "sub.Target", "complete"],
] as const)(
  "keeps alias class identity for %s targeting %s",
  (activity, target, status) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name="${activity}"/><activity-alias android:name=".Alias" android:targetActivity="${target}" android:exported="false"/></application></manifest>`,
      "complete",
      "33",
    );
    expect(inventory.status).toBe(status);
    expect(inventory.items.at(-1)?.target_activity).toBe(target);
    const limitations = inventory.limitations.join(" ");
    if (status === "partial")
      expect(limitations).toContain(
        "do not match a preceding activity declaration",
      );
    else expect(limitations).not.toContain("targetActivity value(s)");
  },
);

it("keeps pre-projection package parses independent", () => {
  const older = {
    engine: {
      name: "jadx",
      version: null,
      artifact_sha256: "a".repeat(64),
      source_revision: null,
      worker_count: 1,
      heap_limit_mib: null,
    },
    package_name: "com.example",
    version_name: null,
    version_code: null,
    min_sdk: null,
    target_sdk: "33",
    permissions: [],
    manifest: {
      status: "complete",
      text: '<manifest package="com.example"/>',
      reported_total_bytes: null,
    },
    class_count: 0,
    resource_count: 0,
    signature_verification: "not_performed",
  };
  const first = androidResultSchemas.inspect_android_package.parse(older);
  expect(first.components).toMatchObject({ status: "unavailable", items: [] });
  first.components.limitations.push("local parse mutation");
  try {
    const second = androidResultSchemas.inspect_android_package.parse(older);
    expect(second.components.limitations).not.toContain("local parse mutation");
  } finally {
    first.components.limitations.pop();
  }
});

it("projects exact declared component attributes without inferring runtime defaults", () => {
  const xml =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:other="urn:other" package="com.example"><application android:enabled="false" android:process=":app"><activity android:name=".Main" android:enabled="true" android:process=" :worker " other:enabled="false"/><provider android:name=".Files" android:grantUriPermissions="false"/><provider android:name=".Unknown" android:enabled="@bool/flag" android:grantUriPermissions="?attr/grants" android:process=""/></application></manifest>';
  const result = parseAndroidManifestComponents(xml, "complete", "33");
  expect(result.items[0]).toMatchObject({
    enabled: true,
    process: " :worker ",
    grant_uri_permissions: null,
  });
  expect(result.items[1]).toMatchObject({
    enabled: null,
    process: null,
    grant_uri_permissions: false,
  });
  expect(result.items[2]).toMatchObject({
    enabled: null,
    process: "",
    grant_uri_permissions: null,
  });
  expect(result.status).toBe("complete");
  expect(result.limitations.join(" ")).toContain("nonliteral boolean");
  expect(result.limitations.join(" ")).toContain("URI-grant state is unknown");
});

it("ignores foreign namespace aliases of component access attributes", () => {
  const result = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:other="urn:other" package="com.example"><application><provider android:name=".Provider" other:enabled="true" other:process="foreign" other:grantUriPermissions="true"/></application></manifest>',
    "complete",
    "33",
  );
  expect(result.status).toBe("complete");
  expect(result.items[0]).toMatchObject({
    enabled: null,
    process: null,
    grant_uri_permissions: null,
  });
});

it("bounds the total copied component process declarations", () => {
  const oversized = "a".repeat(ANDROID_MANIFEST_LIMITS.processBytes + 1);
  const result = parseAndroidManifestComponents(
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><service android:name=".Oversized" android:process="${oversized}"/><service android:name=".Valid" android:process=":valid"/></application></manifest>`,
    "complete",
    "33",
  );
  expect(result.items.map((item) => item.process)).toEqual([null, ":valid"]);
  expect(result.status).toBe("partial");
  expect(result.limitations.join(" ")).toContain(
    "process declarations are capped",
  );
});

it("enforces the process copy budget across individually valid components", () => {
  const processName = "p".repeat(2_050);
  const declarations = Array.from(
    { length: ANDROID_MANIFEST_LIMITS.components },
    (_, index) =>
      `<service android:name=".S${String(index)}" android:process="${processName}"/>`,
  ).join("");
  const result = parseAndroidManifestComponents(
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application>${declarations}</application></manifest>`,
    "complete",
    "33",
  );
  expect(result.items).toHaveLength(ANDROID_MANIFEST_LIMITS.components);
  expect(result.items[0]?.process).toBe(processName);
  expect(result.items.at(-2)?.process).toBe(processName);
  expect(result.items.at(-1)?.process).toBeNull();
  expect(result.status).toBe("partial");
  expect(result.limitations.join(" ")).toContain(
    "process declarations are capped",
  );
  expect(
    result.items.reduce(
      (bytes, item) => bytes + Buffer.byteLength(item.process ?? ""),
      0,
    ),
  ).toBeLessThanOrEqual(ANDROID_MANIFEST_LIMITS.processBytes);
});

it("keeps historical declaration omissions unknown rather than absent", () => {
  const parsed =
    androidResultSchemas.inspect_android_package.shape.components.parse({
      status: "complete",
      items: [
        {
          kind: "receiver",
          declared_name: ".Receiver",
          name: "com.example.Receiver",
          exported: null,
          exported_default: false,
          permission: null,
          permission_source: "none",
          intent_filter_count: 0,
          actions: [],
          categories: [],
          foreground_service_type: null,
          authorities: null,
          target_activity: null,
        },
      ],
      limitations: [],
    });
  expect(parsed.status).toBe("complete");
  expect(parsed.items[0]?.declaration_coverage).toBe("unknown");
  for (const field of [
    "enabled",
    "process",
    "grant_uri_permissions",
    "intent_filters",
    "meta_data",
    "location",
  ])
    expect(parsed.items[0]).not.toHaveProperty(field);
});

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">
  <application android:label="Example">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
    <activity android:name="DetailActivity">
      <intent-filter>
        <action android:name="com.example.app.OPEN_DETAIL" />
      </intent-filter>
    </activity>
    <activity android:name="com.example.app.HiddenActivity" android:exported="false">
      <intent-filter>
        <action android:name="com.example.app.HIDDEN" />
      </intent-filter>
    </activity>
    <activity-alias
      android:name=".AliasActivity"
      android:targetActivity=".MainActivity"
      android:exported="true" />
    <service
      android:name=".SyncService"
      android:permission="com.example.app.SYNC"
      android:foregroundServiceType="dataSync" />
    <receiver android:name=".BootReceiver">
      <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
      </intent-filter>
    </receiver>
    <provider
      android:name=".DataProvider"
      android:authorities="com.example.app.data;com.example.app.backup"
      android:exported="false" />
    <meta-data android:name="ignored" android:value="not-a-component" />
  </application>
</manifest>`;

it.each(['a:name=".First" b:name=".Last"', 'b:name=".Last" a:name=".First"'])(
  "refuses duplicate Android attribute identities: %s",
  (attributes) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest package="com.example" xmlns:a="http://schemas.android.com/apk/res/android" xmlns:b="http://schemas.android.com/apk/res/android"><application><activity ${attributes}/></application></manifest>`,
      "complete",
      "33",
    );
    expect(inventory).toMatchObject({ status: "unavailable", items: [] });
    expect(inventory.limitations.join(" ")).toContain("not well-formed XML");
  },
);

it("does not infer the Android namespace from an undeclared prefix", () => {
  expect(
    parseAndroidManifestComponents(
      '<manifest package="com.example"><application><activity android:name=".Guess"/></application></manifest>',
      "complete",
      "33",
    ),
  ).toMatchObject({ status: "unavailable", items: [] });
});

it.each([".9Activity", ".hyphen-name", ".😀Activity", ".nested.7"])(
  "resolves DEX component name %s and its alias reference",
  (name) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name="${name}"/><activity-alias android:name=".Alias" android:targetActivity="${name}"/></application></manifest>`,
      "complete",
      "33",
    );
    expect(inventory.items[0]?.name).toBe(`com.example${name}`);
    expect(inventory.items[1]?.target_activity).toBe(name);
    expect(inventory.status).toBe("complete");
  },
);

it.each([
  ["0x10", true, true],
  ["0X11", false, true],
  ["0x1f", false, null],
] as const)(
  "interprets decoded hexadecimal target SDK %s",
  (sdk, providerDefault, activityDefault) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><provider android:name=".Provider"/><activity android:name=".Activity"><intent-filter><action android:name="OPEN"/></intent-filter></activity></application></manifest>`,
      "complete",
      sdk,
    );
    expect(inventory.items.map((item) => item.exported_default)).toEqual([
      providerDefault,
      activityDefault,
    ]);
  },
);

it("uses a decoded hexadecimal minimum SDK when target SDK is omitted", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><uses-sdk android:minSdkVersion="0x10"/><application><provider android:name=".Provider"/></application></manifest>',
    "complete",
    null,
    "0x10",
  );
  expect(inventory.items[0]?.exported_default).toBe(true);
});

it.each([
  "0x",
  "0xgg",
  "1e1",
  "-1",
  "0",
  "2147483648",
  "0x80000000",
  "Preview",
])("keeps unsupported SDK spelling %s unknown", (sdk) => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><provider android:name=".Provider"/></application></manifest>',
    "complete",
    sdk,
  );
  expect(inventory.items[0]?.exported_default).toBeNull();
});

it.each([
  [
    "application",
    '<application xmlns="urn:vendor"><activity xmlns="" android:name=".Decoy"/></application>',
    [],
    [],
  ],
  [
    "component",
    '<application><activity xmlns="urn:vendor" android:name=".Decoy"/></application>',
    [],
    [],
  ],
  [
    "filter",
    '<application><activity android:name=".Real"><intent-filter xmlns="urn:vendor"><action android:name="DECOY"/></intent-filter></activity></application>',
    ["activity"],
    [],
  ],
  [
    "action",
    '<application><activity android:name=".Real"><intent-filter><action xmlns="urn:vendor" android:name="DECOY"/><action android:name="REAL"/></intent-filter></activity></application>',
    ["activity"],
    ["REAL"],
  ],
  [
    "category",
    '<application><activity android:name=".Real"><intent-filter><category xmlns="urn:vendor" android:name="DECOY"/><action android:name="REAL"/></intent-filter></activity></application>',
    ["activity"],
    ["REAL"],
  ],
] as const)(
  "ignores foreign namespace %s elements",
  (_kind, body, kinds, actions) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example">${body}</manifest>`,
      "complete",
      "30",
    );
    expect(inventory.status).toBe("complete");
    expect(inventory.items.map((item) => item.kind)).toEqual(kinds);
    expect(inventory.items[0]?.actions ?? []).toEqual(actions);
    expect(inventory.items[0]?.categories ?? []).toEqual([]);
    if (_kind === "filter")
      expect(inventory.items[0]?.intent_filter_count).toBe(0);
  },
);

it("refuses a namespaced manifest root", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns="urn:vendor" xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name=".Decoy"/></application></manifest>',
    "complete",
    "30",
  );
  expect(inventory.status).toBe("unavailable");
  expect(inventory.items).toEqual([]);
});

it("does not index foreign activities as alias targets", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity xmlns="urn:vendor" android:name=".Target"/><activity-alias android:name=".Alias" android:targetActivity=".Target"/></application></manifest>',
    "complete",
    "30",
  );
  expect(inventory.items.map((item) => item.kind)).toEqual(["activity-alias"]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "do not match a preceding activity declaration",
  );
});

it("projects declared components with resolved names and export defaults", () => {
  const inventory = parseAndroidManifestComponents(MANIFEST, "complete", "30");
  expect(inventory.status).toBe("complete");
  expect(inventory.limitations).toEqual([]);
  expect(inventory.items.map(({ kind, name }) => [kind, name])).toEqual([
    ["activity", "com.example.app.MainActivity"],
    ["activity", "com.example.app.DetailActivity"],
    ["activity", "com.example.app.HiddenActivity"],
    ["activity-alias", "com.example.app.AliasActivity"],
    ["service", "com.example.app.SyncService"],
    ["receiver", "com.example.app.BootReceiver"],
    ["provider", "com.example.app.DataProvider"],
  ]);
  expect(inventory.items[0]).toMatchObject({
    declared_name: ".MainActivity",
    exported: true,
    exported_default: true,
    actions: ["android.intent.action.MAIN"],
    categories: ["android.intent.category.LAUNCHER"],
  });
  // Absent android:exported keeps the declaration and the default separate.
  expect(inventory.items[1]).toMatchObject({
    exported: null,
    exported_default: true,
  });
  expect(inventory.items[2]).toMatchObject({
    exported: false,
    exported_default: true,
  });
  expect(inventory.items[3]).toMatchObject({
    target_activity: ".MainActivity",
  });
  expect(inventory.items[4]).toMatchObject({
    permission: "com.example.app.SYNC",
    foreground_service_type: "dataSync",
    actions: [],
  });
  expect(inventory.items[5]).toMatchObject({
    actions: ["android.intent.action.BOOT_COMPLETED"],
    categories: [],
  });
  expect(inventory.items[6]?.authorities).toEqual([
    "com.example.app.data",
    "com.example.app.backup",
  ]);
});

it("inherits an application permission when a component omits its own", () => {
  const manifest = MANIFEST.replace(
    '<application android:label="Example">',
    '<application android:label="Example" android:permission="com.example.APP">',
  );
  const inventory = parseAndroidManifestComponents(manifest, "complete", "33");
  expect(inventory.items[0]?.permission).toBe("com.example.APP");
  expect(inventory.items[0]?.permission_source).toBe("application");
  expect(inventory.items[4]?.permission).toBe("com.example.app.SYNC");
  expect(inventory.items[4]?.permission_source).toBe("component");
});

it("preserves exact action, category, and effective permission strings", () => {
  const manifest =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application android:permission=" P "><activity android:name=".Open"><intent-filter><action android:name=" OPEN "/><category android:name=" "/></intent-filter></activity><service android:name=".Worker" android:permission=" C "/></application></manifest>';
  const inventory = parseAndroidManifestComponents(manifest, "complete", "33");
  expect(inventory.items.map(({ permission }) => permission)).toEqual([
    " P ",
    " C ",
  ]);
  expect(inventory.items[0]).toMatchObject({
    actions: [" OPEN "],
    categories: [" "],
    permission_source: "application",
  });
  expect(inventory.status).toBe("complete");

  const whitespacePermission = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application android:permission=" "><activity android:name=".Open"/></application></manifest>',
    "complete",
    "33",
  );
  expect(whitespacePermission.items[0]).toMatchObject({
    permission: " ",
    permission_source: "application",
  });
});

it.each([
  ".Bad/Main",
  ".Bad//Main",
  "com.example.Bad/Name",
  "com..example.Bad",
  "com.example.Bad;Name",
  "com.example.Bad[Name",
])(
  "retains malformed component class name %s without resolving it",
  (declaredName) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name="${declaredName}"/></application></manifest>`,
      "complete",
      "33",
    );
    expect(inventory.items[0]).toMatchObject({
      declared_name: declaredName,
      name: declaredName,
    });
    expect(inventory.status).toBe("partial");
    expect(inventory.limitations.join(" ")).toContain(
      "do not fit DEX binary class-name syntax",
    );
  },
);

it("accepts Java nested and Unicode class identifiers", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name=".Outer$Inner"/><activity android:name=".Δelta"/></application></manifest>',
    "complete",
    "33",
  );
  expect(inventory.items.map(({ name }) => name)).toEqual([
    "com.example.Outer$Inner",
    "com.example.Δelta",
  ]);
  expect(inventory.status).toBe("complete");
});

it("does not inherit application permission through an explicit empty override", () => {
  const manifest =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application android:permission="com.example.APP"><activity android:name=".Open" android:permission=""/></application></manifest>';
  const inventory = parseAndroidManifestComponents(manifest, "complete", "33");
  expect(inventory.items[0]).toMatchObject({
    permission: null,
    permission_source: "none",
  });
});

it("marks unprojected provider read and write permission overrides partial", () => {
  const manifest =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><provider android:name=".ReadOnly" android:readPermission="com.example.READ"/><provider android:name=".WriteOnly" android:writePermission="com.example.WRITE"/><provider android:name=".Generic" android:permission="com.example.GENERIC" android:readPermission="com.example.READ"/></application></manifest>';
  const inventory = parseAndroidManifestComponents(manifest, "complete", "33");
  expect(
    inventory.items.map(({ permission, permission_source }) => [
      permission,
      permission_source,
    ]),
  ).toEqual([
    [null, "none"],
    [null, "none"],
    ["com.example.GENERIC", "component"],
  ]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "operation-specific permission overrides are retained",
  );
});

it("does not apply application or target permissions through an activity alias", () => {
  const manifest =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application android:permission="com.example.APP"><activity android:name=".Target" android:permission="com.example.TARGET"/><activity-alias android:name=".Alias" android:targetActivity=".Target"/></application></manifest>';
  const inventory = parseAndroidManifestComponents(manifest, "complete", "33");
  expect(inventory.items[0]).toMatchObject({
    permission: "com.example.TARGET",
    permission_source: "component",
  });
  expect(inventory.items[1]).toMatchObject({
    permission: null,
    permission_source: "none",
  });
});

it("keeps symbolic effective permissions unknown without resource resolution", () => {
  const manifest =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application android:permission="com.example.APP"><activity android:name=".Resource" android:permission="@string/resource_permission"/><service android:name=".Theme" android:permission="?attr/theme_permission"/><receiver android:name=".Placeholder" android:permission="${manifestPermission}"/><provider android:name=".Inherited"/></application></manifest>';
  const inventory = parseAndroidManifestComponents(manifest, "complete", "33");
  expect(
    inventory.items.map(({ permission, permission_source }) => [
      permission,
      permission_source,
    ]),
  ).toEqual([
    [null, "unknown"],
    [null, "unknown"],
    [null, "unknown"],
    ["com.example.APP", "application"],
  ]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "unresolved resource or manifest-placeholder tokens",
  );
});

it("bounds inherited permission copies across the inventory", () => {
  const permission = "p".repeat(2_050);
  const declarations = Array.from(
    { length: ANDROID_MANIFEST_LIMITS.components },
    (_, index) => `<receiver android:name=".R${String(index)}"/>`,
  ).join("");
  const inventory = parseAndroidManifestComponents(
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application android:permission="${permission}">${declarations}</application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.items[0]?.permission_source).toBe("application");
  expect(inventory.items.at(-1)).toMatchObject({
    permission: null,
    permission_source: "unknown",
  });
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain("total permission bytes");
  expect(
    inventory.items.reduce(
      (bytes, item) => bytes + Buffer.byteLength(item.permission ?? ""),
      0,
    ),
  ).toBeLessThanOrEqual(ANDROID_MANIFEST_LIMITS.permissionBytes);
});

it("measures an oversized inherited permission once for the whole inventory", () => {
  const permission = "p".repeat(ANDROID_MANIFEST_LIMITS.permissionBytes + 1);
  const declarations = Array.from(
    { length: ANDROID_MANIFEST_LIMITS.components },
    (_, index) => `<receiver android:name=".R${String(index)}"/>`,
  ).join("");
  const byteLength = vi.spyOn(Buffer, "byteLength");
  const includes = vi.spyOn(String.prototype, "includes");
  try {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application android:permission="${permission}">${declarations}</application></manifest>`,
      "complete",
      "33",
    );
    expect(
      byteLength.mock.calls.filter(([value]) => value === permission),
    ).toHaveLength(1);
    expect(
      byteLength.mock.calls.filter(([value]) => value === "com.example"),
    ).toHaveLength(1);
    // Unresolved-token classification checks three markers once at the
    // application owner, not once for every inherited component copy.
    expect(
      includes.mock.contexts.filter((value) => value === permission),
    ).toHaveLength(3);
    expect(inventory.items).toHaveLength(ANDROID_MANIFEST_LIMITS.components);
    expect(
      inventory.items.every((item) => item.permission_source === "unknown"),
    ).toBe(true);
    expect(inventory.status).toBe("partial");
  } finally {
    includes.mockRestore();
    byteLength.mockRestore();
  }
});

it("retains forbidden controls and empty component names", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name="&#x9;.Main&#x9;"/><service android:name=""/><receiver android:name=".Valid"/></application></manifest>',
    "complete",
    "33",
  );
  expect(
    inventory.items.map(({ declared_name, name }) => [declared_name, name]),
  ).toEqual([
    ["\t.Main\t", "\t.Main\t"],
    ["", ""],
    [".Valid", "com.example.Valid"],
  ]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "DEX binary class-name syntax",
  );
});

it("applies the provider export default from the target SDK", () => {
  // API 16 and below default providers to exported; API 17 and up do not.
  const legacy = parseAndroidManifestComponents(MANIFEST, "complete", "16");
  expect(legacy.items[6]).toMatchObject({
    kind: "provider",
    exported: false,
    exported_default: true,
  });
  const modern = parseAndroidManifestComponents(MANIFEST, "complete", "33");
  expect(modern.items[6]?.exported_default).toBe(false);
  // A reported but unrecognized SDK stays unknown; omission has a legacy default.
  const unknown = parseAndroidManifestComponents(
    MANIFEST,
    "complete",
    "Preview",
  );
  expect(unknown.items[6]?.exported_default).toBeNull();
  expect(unknown.limitations.join(" ")).toContain("target SDK is unknown");
});

it("leaves target-31-or-later filtered components without an inferred export default", () => {
  const manifest =
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name=".Filtered"><intent-filter><action android:name="example.OPEN"/></intent-filter></activity></application></manifest>';
  const modern = parseAndroidManifestComponents(manifest, "complete", "31");
  expect(modern.items[0]).toMatchObject({
    exported: null,
    exported_default: null,
  });
  expect(modern.limitations.join(" ")).toContain("requires an explicit value");
  expect(
    parseAndroidManifestComponents(manifest, "complete", "30").items[0],
  ).toMatchObject({ exported_default: true });
  expect(
    parseAndroidManifestComponents(manifest, "complete", "Preview").items[0],
  ).toMatchObject({ exported_default: null });
});

it("ignores same-local-name attributes from other namespaces", () => {
  const manifest = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
    '          xmlns:vendor="http://example.com/vendor"',
    '          package="com.example.app">',
    "  <application>",
    '    <activity vendor:name=".Decoy" android:name=".Real" vendor:exported="true" android:exported="false" />',
    "  </application>",
    "</manifest>",
  ].join("\n");
  const inventory = parseAndroidManifestComponents(manifest, "complete", "33");
  expect(inventory.items).toHaveLength(1);
  expect(inventory.items[0]).toMatchObject({
    declared_name: ".Real",
    name: "com.example.app.Real",
    exported: false,
    exported_default: false,
  });
});

it("resolves relative names against the manifest package", () => {
  expect(resolveAndroidComponentName("com.example.app", ".Main")).toBe(
    "com.example.app.Main",
  );
  expect(resolveAndroidComponentName("com.example.app", "Main")).toBe(
    "com.example.app.Main",
  );
  expect(resolveAndroidComponentName("com.example.app", "org.other.Main")).toBe(
    "org.other.Main",
  );
  expect(resolveAndroidComponentName(null, ".Main")).toBe(".Main");
});

it("keeps relative names unresolved when the manifest package is absent", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".Relative"/><activity android:name="Absolute.Name"/></application></manifest>',
    "complete",
    "33",
  );
  expect(inventory.items.map(({ name }) => name)).toEqual([
    ".Relative",
    "Absolute.Name",
  ]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "manifest package is absent",
  );
});

it("does not trim malformed package names into resolved component identities", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package=" com.example "><application><activity android:name=".Main"/></application></manifest>',
    "complete",
    "33",
  );
  expect(inventory.items[0]).toMatchObject({
    declared_name: ".Main",
    name: ".Main",
  });
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "package has surrounding whitespace",
  );
});

it("does not resolve package-relative names against malformed package syntax", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com..example"><application><activity android:name=".Foo"/><service android:name="Worker"/><receiver android:name="org.other.Valid"/></application></manifest>',
    "complete",
    "33",
  );
  expect(
    inventory.items.map(({ declared_name, name }) => [declared_name, name]),
  ).toEqual([
    [".Foo", ".Foo"],
    ["Worker", "Worker"],
    ["org.other.Valid", "org.other.Valid"],
  ]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "does not fit the supported Java package-name syntax",
  );
  expect(inventory.limitations.join(" ")).toContain(
    "package-relative component name(s) remain unresolved",
  );
});

it("preserves exact activity-alias targets and marks malformed references unknown", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name=".Target"/><activity android:name="Bare"/><activity-alias android:name=".Whitespace" android:targetActivity=" .Target "/><activity-alias android:name=".Empty" android:targetActivity=""/><activity-alias android:name=".Valid" android:targetActivity=".Target"/><activity-alias android:name=".Qualified" android:targetActivity="com.example.Target"/><activity-alias android:name=".Unqualified" android:targetActivity=".Bare"/><activity-alias android:name=".Missing"/><activity-alias android:name=".Later" android:targetActivity=".DeclaredLater"/><activity android:name=".DeclaredLater"/></application></manifest>',
    "complete",
    "33",
  );
  expect(inventory.items.map(({ target_activity }) => target_activity)).toEqual(
    [
      null,
      null,
      " .Target ",
      "",
      ".Target",
      "com.example.Target",
      ".Bare",
      null,
      ".DeclaredLater",
      null,
    ],
  );
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "do not match a preceding activity declaration",
  );
});

it("preserves unresolved aliases without expanding an unsupported huge package", () => {
  const packageName = "p".repeat(900 * 1024);
  const aliases = Array.from(
    { length: 511 },
    (_, index) =>
      `<activity-alias android:name=".Alias${String(index)}" android:targetActivity=".Target"/>`,
  ).join("");
  const inventory = parseAndroidManifestComponents(
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}"><application><activity android:name=".Target"/>${aliases}</application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.items[0]?.name).toBe(".Target");
  expect(
    inventory.items.every(({ name }) => !name.startsWith(packageName)),
  ).toBe(true);
  expect(inventory.items[1]).toMatchObject({
    declared_name: ".Alias0",
    target_activity: ".Target",
  });
  expect(inventory.items.at(-1)).toMatchObject({
    declared_name: ".Alias510",
    target_activity: ".Target",
  });
  expect(inventory.items).toHaveLength(ANDROID_MANIFEST_LIMITS.components);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain("targetActivity value(s)");
});

it("does not call resource and manifest placeholder names resolved identities", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name="@string/component_class"/><service android:name="${applicationId}.Worker"/></application></manifest>',
    "complete",
    "33",
  );
  expect(inventory.items.map(({ name }) => name)).toEqual([
    "@string/component_class",
    "${applicationId}.Worker",
  ]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "unresolved resource or manifest placeholder",
  );
  const placeholderPackage = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${applicationId}"><application><activity android:name=".Main"/></application></manifest>',
    "complete",
    "33",
  );
  expect(placeholderPackage.items[0]?.name).toBe(".Main");
  expect(placeholderPackage.status).toBe("partial");
  expect(placeholderPackage.limitations.join(" ")).toContain(
    "package is absent or contains",
  );
});

it("does not establish a component inventory from truncated manifest text", () => {
  const inventory = parseAndroidManifestComponents(MANIFEST, "partial");
  expect(inventory.status).toBe("partial");
  expect(inventory.items).toEqual([]);
  expect(inventory.limitations[0]).toContain("truncated");
});

it("reports unavailable inventory for malformed or unexpected manifests", () => {
  expect(
    parseAndroidManifestComponents("<manifest><application>", "complete"),
  ).toMatchObject({ status: "unavailable", items: [] });
  expect(
    parseAndroidManifestComponents(
      '<?xml version="1.0" encoding="utf-8"?><resources />',
      "complete",
    ),
  ).toMatchObject({ status: "unavailable", items: [] });
  expect(
    parseAndroidManifestComponents(
      '<?xml version="1.0" encoding="utf-8"?><!DOCTYPE manifest><manifest />',
      "complete",
    ),
  ).toMatchObject({ status: "unavailable", items: [] });
});

it("bounds the component inventory and says so", () => {
  const repeated = Array.from(
    { length: ANDROID_MANIFEST_LIMITS.components + 1 },
    (_, index) => `<activity android:name=".Activity${String(index)}" />`,
  ).join("");
  const inventory = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><application>${repeated}</application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.status).toBe("partial");
  expect(inventory.items).toHaveLength(ANDROID_MANIFEST_LIMITS.components);
  expect(inventory.limitations.join(" ")).toContain(
    String(ANDROID_MANIFEST_LIMITS.components),
  );
});

it("shares one intent-value budget across actions and categories", () => {
  const values = Array.from(
    { length: 80 },
    (_, index) =>
      `<intent-filter><action android:name="a${String(index)}" /><category android:name="c${String(index)}" /></intent-filter>`,
  ).join("");
  const inventory = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><application><activity android:name=".Many">${values}</activity></application></manifest>`,
    "complete",
    "33",
  );
  const first = inventory.items[0];
  expect(first).toBeDefined();
  expect((first?.actions.length ?? 0) + (first?.categories.length ?? 0)).toBe(
    ANDROID_MANIFEST_LIMITS.intentValues,
  );
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain("values per component");
});

it("bounds provider authorities", () => {
  const authorities = Array.from(
    { length: ANDROID_MANIFEST_LIMITS.authorities + 5 },
    (_, index) => `auth${String(index)}`,
  ).join(";");
  const inventory = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><application><provider android:name=".Many" android:authorities="${authorities}" /></application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.items[0]?.authorities).toHaveLength(
    ANDROID_MANIFEST_LIMITS.authorities,
  );
  expect(inventory.status).toBe("partial");
});

it("bounds total authority bytes across providers", () => {
  const first = "a".repeat(900_000);
  const second = "b".repeat(200_000);
  const manifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><provider android:name=".One" android:authorities="${first}"/><provider android:name=".Two" android:authorities="${second}"/></application></manifest>`;
  const inventory = parseAndroidManifestComponents(manifest, "complete", "33");
  expect(inventory.items[0]?.authorities?.[0]?.length).toBe(900_000);
  expect(inventory.items[1]?.authorities).toEqual([]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain("total authority bytes");
});

it("preserves malformed provider authority segments and marks them unknown", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><provider android:name=".Provider" android:authorities=" com.example.p ;;com.example.q;"/></application></manifest>',
    "complete",
    "33",
  );
  expect(inventory.items[0]?.authorities).toEqual([
    " com.example.p ",
    "",
    "com.example.q",
    "",
  ]);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "provider authority segment(s) are empty or have surrounding whitespace",
  );
});

it("leaves later names declared when the resolved-name budget is spent", () => {
  const hugeName = "A".repeat(64 * 1024);
  const names = Array.from(
    { length: 20 },
    (_, index) => `<activity android:name=".${hugeName}${String(index)}" />`,
  ).join("");
  const inventory = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application>${names}</application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.items.length).toBeGreaterThan(1);
  expect(inventory.items[0]?.name).toBe(`com.example.${hugeName}0`);
  const unresolved = inventory.items.filter(({ name }) => name.startsWith("."));
  expect(unresolved.length).toBeGreaterThan(0);
  expect(unresolved.every(({ name }) => name.startsWith(`.${hugeName}`))).toBe(
    true,
  );
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "resolved-name byte budget",
  );
  expect(inventory.limitations.join(" ")).not.toContain(
    "component inventory stops at",
  );
});

it("does not let the first component bypass the resolved-name byte budget", () => {
  const hugeName =
    "." + "A".repeat(ANDROID_MANIFEST_LIMITS.resolvedNameBytes + 1);
  const inventory = parseAndroidManifestComponents(
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name="${hugeName}"/></application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.items[0]?.name).toBe(hugeName);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "resolved-name byte budget",
  );
});

it("measures resolved names in UTF-8 bytes before concatenating them", () => {
  const multibyteName = "." + "界".repeat(400_000);
  const inventory = parseAndroidManifestComponents(
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name="${multibyteName}"/></application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.items[0]?.name).toBe(multibyteName);
  expect(inventory.status).toBe("partial");
  expect(inventory.limitations.join(" ")).toContain(
    "resolved-name byte budget",
  );
});

it("marks the inventory partial when nameless declarations are dropped", () => {
  const inventory = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><application><activity /><activity android:name=".Real" /></application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.status).toBe("partial");
  expect(inventory.items).toHaveLength(1);
  expect(inventory.limitations.join(" ")).toContain(
    "1 component declaration(s) without android:name",
  );
  expect(inventory.limitations.join(" ")).not.toContain(
    "component inventory stops at",
  );
});

it("does not warn about providers that declare android:exported", () => {
  const inventory = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><uses-sdk android:targetSdkVersion="Preview"/><application><provider android:name=".Declared" android:exported="false" /><provider android:name=".Omitted" /></application></manifest>`,
    "complete",
    "Preview",
  );
  expect(inventory.limitations.join(" ")).toContain("1 provider(s) omit");
  expect(inventory.limitations.join(" ")).not.toContain("2 provider(s) omit");
});

it("counts unnamed declarations against the component bound", () => {
  const unnamed = Array.from(
    { length: ANDROID_MANIFEST_LIMITS.components + 1 },
    () => "<activity />",
  ).join("");
  const inventory = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><application>${unnamed}</application></manifest>`,
    "complete",
    "33",
  );
  expect(inventory.status).toBe("partial");
  expect(inventory.items).toHaveLength(0);
  expect(inventory.limitations.join(" ")).toContain(
    `${String(ANDROID_MANIFEST_LIMITS.components)} component`,
  );
});

it("distinguishes nonliteral android:exported values from omission", () => {
  const inventory = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><uses-sdk android:targetSdkVersion="Preview"/><application><provider android:name=".Resource" android:exported="@bool/exported" /><provider android:name=".Omitted" /><provider android:name=".Empty" android:exported="" /><activity android:name=".True" android:exported="True"><intent-filter><action android:name="com.example.app.OPEN" /></intent-filter></activity></application></manifest>`,
    "complete",
    "Preview",
  );
  const resource = inventory.items.find(({ name }) =>
    name.endsWith(".Resource"),
  );
  expect(resource).toMatchObject({ exported: null, exported_default: null });
  const empty = inventory.items.find(({ name }) => name.endsWith(".Empty"));
  expect(empty).toMatchObject({ exported: null, exported_default: null });
  const trueCase = inventory.items.find(({ name }) => name.endsWith(".True"));
  expect(trueCase).toMatchObject({ exported: null, exported_default: null });
  const joined = inventory.limitations.join(" ");
  expect(joined).toContain("1 provider(s) omit");
  expect(joined).toContain(
    "3 component declaration(s) set android:exported to a value other than the literals true or false",
  );
  expect(inventory.status).toBe("complete");
});

it("keeps a known SDK default from governing a nonliteral exported value", () => {
  const legacy = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><application><provider android:name=".Resource" android:exported="@bool/exported" /></application></manifest>`,
    "complete",
    "16",
  );
  expect(legacy.items[0]).toMatchObject({
    exported: null,
    exported_default: null,
  });
  const modern = parseAndroidManifestComponents(
    `<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app"><application><activity android:name=".Resource" android:exported="@bool/exported"><intent-filter><action android:name="com.example.app.OPEN" /></intent-filter></activity></application></manifest>`,
    "complete",
    "33",
  );
  expect(modern.items[0]).toMatchObject({
    exported: null,
    exported_default: null,
  });
  expect(modern.limitations.join(" ")).toContain(
    "1 component declaration(s) set android:exported",
  );
});

it.each([
  "com._hidden",
  "com.$hidden",
  "com.Δelta",
  "com.9bad",
  "Single",
  "com..example",
  ".com.example",
  "com.example.",
  "a." + "b".repeat(222),
])(
  "preserves relative class identities under an unsupported Android package %s",
  (packageName) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}"><application><activity android:name=".Main"/><activity-alias android:name=".Alias" android:targetActivity=".Main" android:exported="false"/></application></manifest>`,
      "complete",
      "33",
    );
    expect(inventory.status).toBe("partial");
    expect(inventory.items.map(({ name }) => name)).toEqual([
      ".Main",
      ".Alias",
    ]);
    expect(inventory.items[1]?.target_activity).toBe(".Main");
  },
);

it.each(["android", "com.Example_9", "a." + "b".repeat(221)])(
  "qualifies names under the supported Android package %s",
  (packageName) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}"><application><activity android:name=".Main"/><activity-alias android:name=".Alias" android:targetActivity=".Main" android:exported="false"/></application></manifest>`,
      "complete",
      "33",
    );
    expect(inventory.status).toBe("complete");
    expect(inventory.items.map(({ name }) => name)).toEqual([
      `${packageName}.Main`,
      `${packageName}.Alias`,
    ]);
  },
);

it.each([
  [".Hidden ", ".Hidden ", "com.example.Hidden "],
  [" Hidden", ". Hidden", "com.example. Hidden"],
  [". Hidden ", "com.example. Hidden ", "com.example. Hidden "],
  [" ", ". ", "com.example. "],
  [" other.Hidden ", " other.Hidden ", " other.Hidden "],
])(
  "preserves DEX boundary spaces in %j and alias %j",
  (declared, target, expected) => {
    const inventory = parseAndroidManifestComponents(
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name="${declared}"/><activity-alias android:name=".Alias" android:targetActivity="${target}" android:exported="false"/></application></manifest>`,
      "complete",
      "33",
    );
    expect(inventory.status).toBe("complete");
    expect(inventory.items[0]).toMatchObject({
      declared_name: declared,
      name: expected,
    });
    expect(inventory.items[1]?.target_activity).toBe(target);
  },
);

it("keeps distinct DEX spellings distinct in alias matching", () => {
  const inventory = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity android:name=".Hidden"/><activity-alias android:name=".Alias" android:targetActivity=".Hidden " android:exported="false"/></application></manifest>',
    "complete",
    "33",
  );
  expect(inventory.status).toBe("partial");
  expect(inventory.items[1]?.target_activity).toBe(".Hidden ");
});

it.each([
  null,
  "",
  " ",
  " location ",
  "location|dataSync",
  "@string/service_type",
])("preserves the declared foreground service type %j", (declared) => {
  const attribute =
    declared === null ? "" : ` android:foregroundServiceType="${declared}"`;
  const inventory = parseAndroidManifestComponents(
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><service android:name=".Service"${attribute}/></application></manifest>`,
    "complete",
    "30",
  );
  expect(inventory.items[0]?.foreground_service_type).toBe(declared);
  expect(inventory.status).toBe("complete");
});

it("keeps intent-filter relationships and exact declarations in one source-located projection", () => {
  const xml = `<manifest xmlns:a="http://schemas.android.com/apk/res/android" xmlns:other="urn:other" package="com.example">\r\n <application>\r\n  <!-- 😀 --> <activity a:name=".Main" a:enabled="@bool/ready" a:process=":worker">\r\n   <intent-filter a:priority="@integer/rank"><action a:name="VIEW"/><data a:scheme="https" a:host="example.test" a:pathPrefix="/items" other:path="not-android"/></intent-filter>\r\n   <meta-data a:name="public.configuration" a:value="retained-in-text"/>\r\n   <intent-filter a:priority="-10"><action a:name="EDIT"/><category a:name="DEFAULT"/><data a:mimeType="text/plain"/></intent-filter>\r\n  </activity>\r\n </application>\r\n</manifest>`;
  const result = parseAndroidManifestComponents(xml, "complete", "30");
  expect(result.status).toBe("complete");
  const component = result.items[0]!;
  expect(component).toMatchObject({
    declaration_index: 0,
    declaration_coverage: "complete",
    enabled: null,
    enabled_declaration: "@bool/ready",
    process: ":worker",
    actions: ["VIEW", "EDIT"],
  });
  expect(component.location?.offset).toBe(xml.indexOf("<activity"));
  expect(component.location?.line).toBe(3);
  expect(component.intent_filters).toMatchObject([
    {
      source_index: 0,
      priority: "@integer/rank",
      actions: ["VIEW"],
      categories: [],
      coverage: "complete",
      data: [
        {
          scheme: "https",
          host: "example.test",
          path_prefix: "/items",
          path: null,
          mime_type: null,
        },
      ],
    },
    {
      source_index: 1,
      priority: "-10",
      actions: ["EDIT"],
      categories: ["DEFAULT"],
      coverage: "complete",
      data: [{ scheme: null, host: null, mime_type: "text/plain" }],
    },
  ]);
  expect(component.intent_filters?.[1]?.location?.offset).toBe(
    xml.indexOf('<intent-filter a:priority="-10"'),
  );
  expect(component.meta_data).toEqual([
    {
      name: "public.configuration",
      location: expect.objectContaining({ offset: xml.indexOf("<meta-data") }),
    },
  ]);
  expect(JSON.stringify(component.meta_data)).not.toContain("retained-in-text");
});

it("preserves original declaration ordinals across omitted unnamed components", () => {
  const result = parseAndroidManifestComponents(
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example"><application><activity/><service android:name=".Worker"/><receiver android:name=".Receiver"/></application></manifest>',
    "complete",
    "30",
  );
  expect(result.status).toBe("partial");
  expect(result.items.map((item) => item.declaration_index)).toEqual([1, 2]);
});

it("makes unsupported modern filter constructs partial while retaining their source entry", () => {
  const xml =
    '<manifest xmlns:a="http://schemas.android.com/apk/res/android" package="com.example"><application><activity a:name=".Main"><intent-filter><action a:name="VIEW"/><uri-relative-filter-group><data a:path="/selected"/></uri-relative-filter-group></intent-filter></activity></application></manifest>';
  const result = parseAndroidManifestComponents(xml, "complete", "30");
  expect(result.status).toBe("partial");
  expect(result.items[0]).toMatchObject({
    declaration_coverage: "partial",
    intent_filters: [{ actions: ["VIEW"], data: [], coverage: "partial" }],
  });
  expect(result.limitations.join(" ")).toContain("unsupported constructs");
});

it.each([
  ["a:sspPrefix", "partial"],
  ["foreign:sspPrefix", "complete"],
  ["android:sspPrefix", "complete"],
] as const)(
  "reports unprojected data constraints using namespace identity for %s",
  (attribute, coverage) => {
    const declaration = `<data a:scheme="mailto" ${attribute}="selected"/>`;
    const xml = `<manifest xmlns:a="http://schemas.android.com/apk/res/android" xmlns:foreign="urn:foreign" xmlns:android="urn:foreign" package="com.example"><application><activity a:name=".Main"><intent-filter><action a:name="VIEW"/>${declaration}</intent-filter></activity></application></manifest>`;
    const result = parseAndroidManifestComponents(xml, "complete", "30");
    expect(result.status).toBe(coverage);
    const component = result.items[0]!;
    expect(component.declaration_coverage).toBe(coverage);
    const filter = component.intent_filters[0]!;
    expect(filter).toMatchObject({
      actions: ["VIEW"],
      coverage,
      data: [{ scheme: "mailto", host: null, path: null }],
    });
    expect(filter.data[0]?.location?.offset).toBe(xml.indexOf(declaration));
    expect(
      result.limitations.join(" ").includes("unsupported constructs"),
    ).toBe(coverage === "partial");
  },
);

it("charges nested declarations across components and preserves unknown capped facts", () => {
  const name = "x".repeat(2050);
  const declarations = Array.from(
    { length: 512 },
    (_, i) =>
      `<service a:name=".S${String(i)}"><meta-data a:name="${name}"/></service>`,
  ).join("");
  const result = parseAndroidManifestComponents(
    `<manifest xmlns:a="http://schemas.android.com/apk/res/android" package="com.example"><application>${declarations}</application></manifest>`,
    "complete",
    "30",
  );
  expect(result.status).toBe("partial");
  expect(result.items.at(-2)).toMatchObject({
    declaration_coverage: "complete",
    meta_data: [{ name }],
  });
  expect(result.items.at(-1)).toMatchObject({
    declaration_coverage: "partial",
    meta_data: [{ name: null }],
  });
  expect(result.limitations.join(" ")).toContain("shared copy bound");
});

it("reports shared nested-record omissions without erasing the legacy action set", () => {
  const values = Array.from(
    { length: 64 },
    (_, i) => `<action a:name="ACTION_${String(i)}"/>`,
  ).join("");
  const xml = `<manifest xmlns:a="http://schemas.android.com/apk/res/android" package="com.example"><application><activity a:name=".Main"><intent-filter>${values}</intent-filter><meta-data a:name="extra"/></activity></application></manifest>`;
  const result = parseAndroidManifestComponents(xml, "complete", "30");
  expect(result.status).toBe("partial");
  expect(result.items[0]?.actions).toHaveLength(64);
  expect(result.items[0]).toMatchObject({
    declaration_coverage: "partial",
    meta_data: [],
    intent_filters: [{ coverage: "complete" }],
  });
});
