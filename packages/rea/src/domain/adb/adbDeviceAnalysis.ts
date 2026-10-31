import { z } from "zod";
import { localPathStringSchema } from "../localPath.js";
import { IDENTIFIER_PATTERN } from "../stringPatterns.js";

/**
 * Device serials as adb prints them: emulator-5554, USB identifiers, and
 * host:port transports. The pattern keeps arguments free of whitespace and
 * quotes; argv is positional in the provider, so this is admission hygiene
 * rather than injection defense.
 */
const deviceSerialSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^[^\x00\s"']+$/u,
    "Device serial cannot contain whitespace or quotes",
  );

/**
 * Android package names as Package Manager reports them. System entries can
 * be a single segment (`android`), so at least one identifier is required.
 */
const packageNameSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/u,
    "Package name must be dot-separated Java identifiers",
  );

/** Text states emitted by adb's ConnectionState formatter. */
export const ADB_DEVICE_STATES = [
  "no permissions",
  "unauthorized",
  "authorizing",
  "offline",
  "recovery",
  "sideload",
  "connecting",
  "bootloader",
  "device",
  "unknown",
  "host",
  "rescue",
  "detached",
] as const;
export const adbDeviceStateSchema = z.enum(ADB_DEVICE_STATES);
export type AdbDeviceState = (typeof ADB_DEVICE_STATES)[number];

const keyStringSchema = z.string().min(1).max(256);
const keyPattern = /^[A-Za-z0-9._\x2d]+$/u;
const activityExtraKeySchema = keyStringSchema
  .regex(keyPattern, "Extra keys are identifiers")
  .describe("Extra key");
const activityExtraStringValueSchema = z
  .string()
  .max(2048)
  .regex(/^[^\x00]*$/u, "Extra values cannot contain NUL");
const activityExtraNonEmptyValueSchema = activityExtraStringValueSchema.min(1);
/** Maximum typed extras admitted for one Android activity request. */
export const MAX_ADB_ACTIVITY_EXTRAS = 16;
// Android's `am start --ef` parses this text with Float.valueOf. Keep the
// caller's spelling intact while admitting Java FloatValue forms.
const javaFloatValuePattern =
  /^[\x01-\x20]*(?:\+|-)?(?:NaN|Infinity|(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE](?:\+|-)?\d+)?[fFdD]?|0[xX](?:[\da-fA-F]+(?:\.[\da-fA-F]*)?|\.[\da-fA-F]+)[pP](?:\+|-)?\d+[fFdD]?))[\x01-\x20]*$/u;
const activityExtraSchema = z.discriminatedUnion("type", [
  z.strictObject({
    key: activityExtraKeySchema,
    type: z.literal("string").describe("String extra value type"),
    value: activityExtraStringValueSchema.describe(
      "String extra value as text; an explicitly empty value is preserved",
    ),
  }),
  z.strictObject({
    key: activityExtraKeySchema,
    type: z.literal("boolean").describe("Boolean extra value type"),
    value: activityExtraNonEmptyValueSchema
      .regex(/^(true|false)$/u, "Boolean extra values must be true or false")
      .describe("Boolean extra value as true or false text"),
  }),
  z.strictObject({
    key: activityExtraKeySchema,
    type: z.literal("int").describe("Integer extra value type"),
    value: activityExtraNonEmptyValueSchema
      .regex(/^-?\d+$/u, "Integer extra values must be an integer")
      .describe("Integer extra value as signed decimal text"),
  }),
  z.strictObject({
    key: activityExtraKeySchema,
    type: z.literal("long").describe("Long extra value type"),
    value: activityExtraNonEmptyValueSchema
      .regex(/^-?\d+$/u, "Long extra values must be an integer")
      .describe("Long extra value as signed decimal text"),
  }),
  z.strictObject({
    key: activityExtraKeySchema,
    type: z.literal("float").describe("Float extra value type"),
    value: activityExtraNonEmptyValueSchema
      .regex(
        javaFloatValuePattern,
        "Float extra value must be valid Java float text",
      )
      .describe(
        "Float extra text parsed by Android am without changing its spelling",
      ),
  }),
]);

/**
 * Caller intent for ADB-backed device inspection and acquisition.
 *
 * REA never installs platform tools, starts an emulator, or manages devices;
 * every operation addresses devices the caller already connected, through the
 * adb binary the caller selected.
 */
export const adbInputSchemas = {
  inspect_adb_client: z.strictObject({}),
  list_adb_devices: z.strictObject({}),
  inspect_adb_device: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
  }),
  list_adb_packages: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    scope: z
      .enum(["all", "third_party", "system"])
      .default("all")
      .describe(
        "Package scope: all packages, third-party only (-3), or system only (-s)",
      ),
  }),
  pull_adb_package: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    package: packageNameSchema.describe(
      "Installed package name whose APK set is pulled",
    ),
    output_directory: localPathStringSchema.describe(
      "Local directory for the pulled APK set; REA creates a package-named subdirectory inside it",
    ),
  }),
  read_adb_logcat: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    count: z
      .int()
      .min(1)
      .max(10_000)
      .default(500)
      .describe("Number of most recent lines to read (logcat -d -t)"),
    buffer: z
      .enum(["main", "system", "radio", "events", "crash"])
      .default("main")
      .describe("Log buffer to read (logcat -b)"),
    pid: z
      .int()
      .positive()
      .optional()
      .describe("Restrict to one process id (logcat --pid)"),
  }),
  inspect_adb_package: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    package: packageNameSchema.describe("Installed package to inspect"),
  }),
  pull_adb_file: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    device_path: z
      .string()
      .min(1)
      .regex(/^\/[^\x00]*$/u, "Device path must be absolute")
      .describe("Absolute device filesystem path to pull"),
    output_directory: localPathStringSchema.describe(
      "Local directory for the pulled file; must not already contain the file",
    ),
  }),
  push_adb_file: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    local_path: localPathStringSchema.describe(
      "Existing local regular file to push",
    ),
    device_path: z
      .string()
      .min(1)
      .regex(/^\/[^\x00]*$/u, "Device path must be absolute")
      .describe("Absolute destination path on the device"),
    overwrite: z
      .boolean()
      .default(false)
      .describe("Allow replacing an existing device file; refused by default"),
  }),
  capture_adb_screen: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    output_directory: localPathStringSchema.describe(
      "Local directory for the captured PNG; must not already contain it",
    ),
  }),
  list_adb_processes: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
  }),
  list_adb_directory: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    device_path: z
      .string()
      .min(1)
      .regex(/^\/[^\x00]*$/u, "Device path must be absolute")
      .describe(
        "Absolute device directory path to list, including hidden children",
      ),
  }),
  list_adb_features: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
  }),
  list_adb_services: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
  }),
  inspect_adb_display: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
  }),
  inspect_adb_window: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
  }),
  read_adb_setting: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    namespace: z
      .enum(["system", "secure", "global"])
      .describe("Settings namespace to read"),
    key: keyStringSchema
      .regex(keyPattern, "Setting keys are restricted to identifiers")
      .describe("Setting key to read"),
  }),
  collect_adb_bugreport: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    output_directory: localPathStringSchema.describe(
      "Local directory for the bugreport archive; REA writes exactly one new zip into it",
    ),
  }),
  resolve_adb_packages: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    query: z
      .string()
      .min(2)
      .max(256)
      .describe(
        "Case-insensitive substring matched against installed package names (e.g. whatsapp)",
      ),
  }),
  install_adb_package: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    apk_path: localPathStringSchema.describe(
      "Existing local APK file to install",
    ),
    replace: z
      .boolean()
      .default(false)
      .describe(
        "Request replacement mode and keep existing app data if present (adb install -r); does not establish whether the app was already installed",
      ),
  }),
  uninstall_adb_package: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    package: packageNameSchema.describe("Installed package to uninstall"),
  }),
  start_adb_app: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    package: packageNameSchema.describe(
      "Installed package whose launcher activity is started",
    ),
  }),
  start_adb_activity: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    action: z
      .string()
      .min(1)
      .max(256)
      .regex(
        IDENTIFIER_PATTERN,
        "Intent action must be a dotted identifier such as android.intent.action.VIEW",
      )
      .describe("Intent action to start"),
    data_uri: z
      .string()
      .min(1)
      .max(2048)
      .regex(/^[^\x00\s]+$/u, "Data URI cannot contain whitespace or NUL")
      .optional()
      .describe("Intent data URI (-d)"),
    component: z
      .string()
      .min(1)
      .max(512)
      .regex(
        /^[A-Za-z0-9._\x2d]+(?:\/[A-Za-z0-9._$\x2d]*)?$/u,
        "Component must be package/activity form",
      )
      .optional()
      .describe("Explicit component to start (-n)"),
    extras: z
      .array(activityExtraSchema)
      .max(MAX_ADB_ACTIVITY_EXTRAS)
      .default([])
      .describe("Typed intent extras (--es/--ez/--ei/--el/--ef)"),
  }),
  stop_adb_app: z.strictObject({
    serial: deviceSerialSchema.describe(
      "Device serial exactly as `adb devices` reports it",
    ),
    package: packageNameSchema.describe(
      "Package whose processes are force-stopped",
    ),
  }),
} as const;

/** Supported ADB-backed operations. */
export type AdbOperation = keyof typeof adbInputSchemas;
/** Validated ADB requests carry their selected operation. */
export type AdbRequest = {
  [Name in AdbOperation]: {
    operation: Name;
    input: z.infer<(typeof adbInputSchemas)[Name]>;
  };
}[AdbOperation];

/** Validate operation and input together so their types remain correlated. */
export const adbRequestSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("inspect_adb_client"),
    input: adbInputSchemas.inspect_adb_client,
  }),
  z.strictObject({
    operation: z.literal("list_adb_devices"),
    input: adbInputSchemas.list_adb_devices,
  }),
  z.strictObject({
    operation: z.literal("inspect_adb_device"),
    input: adbInputSchemas.inspect_adb_device,
  }),
  z.strictObject({
    operation: z.literal("list_adb_packages"),
    input: adbInputSchemas.list_adb_packages,
  }),
  z.strictObject({
    operation: z.literal("pull_adb_package"),
    input: adbInputSchemas.pull_adb_package,
  }),
  z.strictObject({
    operation: z.literal("read_adb_logcat"),
    input: adbInputSchemas.read_adb_logcat,
  }),
  z.strictObject({
    operation: z.literal("inspect_adb_package"),
    input: adbInputSchemas.inspect_adb_package,
  }),
  z.strictObject({
    operation: z.literal("pull_adb_file"),
    input: adbInputSchemas.pull_adb_file,
  }),
  z.strictObject({
    operation: z.literal("push_adb_file"),
    input: adbInputSchemas.push_adb_file,
  }),
  z.strictObject({
    operation: z.literal("capture_adb_screen"),
    input: adbInputSchemas.capture_adb_screen,
  }),
  z.strictObject({
    operation: z.literal("list_adb_processes"),
    input: adbInputSchemas.list_adb_processes,
  }),
  z.strictObject({
    operation: z.literal("list_adb_directory"),
    input: adbInputSchemas.list_adb_directory,
  }),
  z.strictObject({
    operation: z.literal("list_adb_features"),
    input: adbInputSchemas.list_adb_features,
  }),
  z.strictObject({
    operation: z.literal("list_adb_services"),
    input: adbInputSchemas.list_adb_services,
  }),
  z.strictObject({
    operation: z.literal("inspect_adb_display"),
    input: adbInputSchemas.inspect_adb_display,
  }),
  z.strictObject({
    operation: z.literal("inspect_adb_window"),
    input: adbInputSchemas.inspect_adb_window,
  }),
  z.strictObject({
    operation: z.literal("read_adb_setting"),
    input: adbInputSchemas.read_adb_setting,
  }),
  z.strictObject({
    operation: z.literal("collect_adb_bugreport"),
    input: adbInputSchemas.collect_adb_bugreport,
  }),
  z.strictObject({
    operation: z.literal("resolve_adb_packages"),
    input: adbInputSchemas.resolve_adb_packages,
  }),
  z.strictObject({
    operation: z.literal("install_adb_package"),
    input: adbInputSchemas.install_adb_package,
  }),
  z.strictObject({
    operation: z.literal("uninstall_adb_package"),
    input: adbInputSchemas.uninstall_adb_package,
  }),
  z.strictObject({
    operation: z.literal("start_adb_app"),
    input: adbInputSchemas.start_adb_app,
  }),
  z.strictObject({
    operation: z.literal("start_adb_activity"),
    input: adbInputSchemas.start_adb_activity,
  }),
  z.strictObject({
    operation: z.literal("stop_adb_app"),
    input: adbInputSchemas.stop_adb_app,
  }),
]);

const client = z.strictObject({
  binary_path: z.string().min(1),
  path_source: z.enum(["environment", "path"]),
  version: z.string().min(1).nullable(),
  installed_path: z.string().min(1).nullable(),
});

const device = z.strictObject({
  serial: z.string().min(1),
  state: adbDeviceStateSchema,
  transport: z.enum(["usb", "tcp", "unknown"]),
  product: z.string().nullable(),
  model: z.string().nullable(),
  device: z.string().nullable(),
  transport_id: z.int().positive().nullable(),
  /**
   * Inferred device kind with its evidence basis. The serial prefix and the
   * `device:` metadata line are observations; the kind itself is derived.
   */
  kind: z.enum(["emulator", "physical", "unknown"]),
  kind_basis: z.enum(["emulator_serial_prefix", "usb_transport", "none"]),
});

const pulledArtifact = z.strictObject({
  device_path: z.string().min(1),
  file_name: z.string().min(1),
  local_path: z.string().min(1),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  role: z.enum(["base", "split", "unknown"]),
  role_basis: z.literal("file_name"),
});

const pullFailure = z.strictObject({
  device_path: z.string().min(1).nullable(),
  stage: z.enum(["resolve_paths", "pull", "digest"]),
  message: z.string().min(1),
});

/** Display ownership and source declarations, including unknown identities. */
export const adbWindowFocusContextSchema = z.strictObject({
  scope: z.enum(["display", "unscoped"]),
  display_id: z.string().nullable(),
  header_line: z.string().nullable(),
  declarations: z.array(
    z.strictObject({
      field: z.enum(["mCurrentFocus", "mFocusedApp"]),
      value: z.string().nullable(),
      raw_line: z.string().min(1),
    }),
  ),
});
export type AdbWindowFocusContext = z.infer<typeof adbWindowFocusContextSchema>;

const displayNumericReason = z.enum([
  "invalid_format",
  "unsafe_integer",
  "nonpositive",
]);
const displayNumericIssue = z.discriminatedUnion("command", [
  z.strictObject({
    command: z.literal("wm size"),
    field: z.enum(["physical_size", "override_size"]),
    reason: displayNumericReason,
    raw_line: z.string().min(1),
  }),
  z.strictObject({
    command: z.literal("wm density"),
    field: z.enum(["physical_density", "override_density"]),
    reason: displayNumericReason,
    raw_line: z.string().min(1),
  }),
]);

/** Bounded source diagnostics for display numeric declarations. */
export const adbDisplayNumericIssuesSchema = z.strictObject({
  sample: z.array(displayNumericIssue),
  total: z.int().nonnegative(),
});
export type AdbDisplayNumericIssues = z.infer<
  typeof adbDisplayNumericIssuesSchema
>;

/** Bounded source diagnostics for Package Manager's userId/appId declarations. */
export const adbPackageNumericIssuesSchema = z.strictObject({
  sample: z.array(
    z.strictObject({
      command: z.literal("dumpsys package"),
      field: z.literal("user_id"),
      reason: z.enum(["invalid_format", "unsafe_integer"]),
      raw_line: z.string().min(1),
    }),
  ),
  total: z.int().nonnegative(),
});
export type AdbPackageNumericIssues = z.infer<
  typeof adbPackageNumericIssuesSchema
>;

/** Portable ADB observations with explicit identity and coverage limitations. */
export const adbResultSchemas = {
  inspect_adb_client: z.strictObject({
    client,
    /**
     * `adb version` never contacts the adb server; this tool starts nothing.
     * Recorded explicitly so the session keeps the distinction observable.
     */
    contacted_adb_server: z.literal(false),
  }),
  list_adb_devices: z.strictObject({
    client,
    devices: z.array(device),
    /**
     * Starting the local adb server is an adb client behavior on first use;
     * REA observes whichever server state the caller's environment has.
     */
    may_have_started_adb_server: z.boolean(),
  }),
  inspect_adb_device: z.strictObject({
    client,
    serial: z.string().min(1),
    properties: z.array(
      z.strictObject({ name: z.string().min(1), value: z.string() }),
    ),
    property_count: z.int().nonnegative(),
    emulator_observed: z.boolean().nullable(),
  }),
  list_adb_packages: z.strictObject({
    client,
    serial: z.string().min(1),
    scope: z.enum(["all", "third_party", "system"]),
    packages: z.array(
      z.strictObject({
        package_name: packageNameSchema,
        /** Device filesystem path; not a host-local path. */
        base_apk_device_path: z.string().min(1),
      }),
    ),
    unparsed_lines: z.array(z.string().min(1)),
    coverage: z.enum(["complete", "partial"]),
  }),
  pull_adb_package: z.strictObject({
    client,
    serial: z.string().min(1),
    package_name: packageNameSchema,
    output_directory: z.string().min(1),
    artifacts: z.array(pulledArtifact),
    failures: z.array(pullFailure),
    coverage: z.enum(["complete", "partial"]),
  }),
  read_adb_logcat: z.strictObject({
    client,
    serial: z.string().min(1),
    count: z.int().positive(),
    buffer: z.enum(["main", "system", "radio", "events", "crash"]),
    pid: z.int().positive().nullable(),
    lines: z.array(z.string()),
    total_bytes: z.int().nonnegative(),
    coverage: z.enum(["complete", "partial"]),
  }),
  inspect_adb_package: z.strictObject({
    client,
    serial: z.string().min(1),
    package_name: packageNameSchema,
    version_name: z.string().nullable(),
    version_code: z
      .string()
      .regex(/^-?\d+$/u)
      .nullable()
      .describe(
        "Long version code exactly as dumpsys package prints it; may exceed the JSON safe-integer range",
      ),
    first_install_time: z.string().nullable(),
    last_update_time: z.string().nullable(),
    installer_package_name: z.string().nullable(),
    user_id: z.int().nonnegative().nullable(),
    pkg_flags: z.string().nullable(),
    requested_permissions_count: z.int().nonnegative().nullable(),
    numeric_issues: adbPackageNumericIssuesSchema,
    coverage: z.enum(["complete", "partial"]),
  }),
  pull_adb_file: z.strictObject({
    client,
    serial: z.string().min(1),
    device_path: z.string().min(1),
    local_path: z.string().min(1),
    bytes: z.int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  push_adb_file: z.strictObject({
    client,
    serial: z.string().min(1),
    local_path: z.string().min(1),
    device_path: z.string().min(1),
    bytes: z.int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    device_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    overwritten: z.boolean(),
    device_digest_source: z.enum(["device_sha256sum", "unavailable"]),
  }),
  capture_adb_screen: z.strictObject({
    client,
    serial: z.string().min(1),
    local_path: z.string().min(1),
    bytes: z.int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    width: z.int().positive().nullable(),
    height: z.int().positive().nullable(),
  }),
  list_adb_processes: z.strictObject({
    client,
    serial: z.string().min(1),
    columns: z.string().nullable(),
    processes: z.array(
      z.strictObject({
        user: z.string(),
        pid: z.int().nonnegative(),
        ppid: z.int().nullable(),
        rss: z.int().nullable(),
        state: z.string().nullable(),
        name: z.string(),
      }),
    ),
    unparsed_lines: z.array(z.string().min(1)),
    coverage: z.enum(["complete", "partial"]),
  }),
  list_adb_directory: z.strictObject({
    client,
    serial: z.string().min(1),
    device_path: z.string().min(1),
    entries: z.array(
      z.strictObject({
        name: z.string().min(1),
        kind: z.enum(["directory", "file", "symlink", "other"]),
        permissions: z.string().nullable(),
        owner: z.string().nullable(),
        group: z.string().nullable(),
        bytes: z.int().nullable(),
        date: z.string().nullable(),
        link_target: z.string().nullable(),
      }),
    ),
    unparsed_lines: z.array(z.string().min(1)),
    coverage: z.enum(["complete", "partial"]),
  }),
  list_adb_features: z.strictObject({
    client,
    serial: z.string().min(1),
    features: z.array(
      z.strictObject({
        name: z.string().min(1),
        version: z.int().nullable(),
      }),
    ),
    unparsed_lines: z.array(z.string().min(1)),
    coverage: z.enum(["complete", "partial"]),
  }),
  list_adb_services: z.strictObject({
    client,
    serial: z.string().min(1),
    services: z.array(
      z.strictObject({
        name: z.string().min(1),
        interface: z.string().nullable(),
      }),
    ),
    unparsed_lines: z.array(z.string().min(1)),
    coverage: z.enum(["complete", "partial"]),
  }),
  inspect_adb_display: z.strictObject({
    client,
    serial: z.string().min(1),
    physical_size: z.strictObject({
      width: z.int().positive(),
      height: z.int().positive(),
    }),
    override_size: z
      .strictObject({
        width: z.int().positive(),
        height: z.int().positive(),
      })
      .nullable(),
    physical_density: z.int().positive().nullable(),
    override_density: z.int().positive().nullable(),
    numeric_issues: adbDisplayNumericIssuesSchema,
    coverage: z.enum(["complete", "partial"]),
  }),
  inspect_adb_window: z.strictObject({
    client,
    serial: z.string().min(1),
    source_section: z.enum(["windows", "displays"]),
    focus_contexts: z.array(adbWindowFocusContextSchema),
    focus_summary: z.enum(["single_context", "ambiguous", "unavailable"]),
    focused_window: z.string().nullable(),
    focused_app: z.string().nullable(),
    observed_lines: z.array(z.string().min(1)),
  }),
  read_adb_setting: z.strictObject({
    client,
    serial: z.string().min(1),
    namespace: z.enum(["system", "secure", "global"]),
    key: z.string().min(1),
    value: z.string().nullable(),
    device_reported_null: z.boolean(),
  }),
  collect_adb_bugreport: z.strictObject({
    client,
    serial: z.string().min(1),
    local_path: z.string().min(1),
    bytes: z.int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    adb_reported_path: z.string().nullable(),
  }),
  resolve_adb_packages: z.strictObject({
    client,
    serial: z.string().min(1),
    query: z.string().min(1),
    matches: z.array(
      z.strictObject({
        package_name: packageNameSchema,
        base_apk_device_path: z.string().min(1),
      }),
    ),
    exact_match: z.boolean(),
    unparsed_lines: z.array(z.string().min(1)),
    coverage: z.enum(["complete", "partial"]),
  }),
  install_adb_package: z.strictObject({
    client,
    serial: z.string().min(1),
    apk_path: z.string().min(1),
    bytes: z.int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    replace_requested: z.boolean(),
    replaced: z.boolean().nullable(),
  }),
  uninstall_adb_package: z.strictObject({
    client,
    serial: z.string().min(1),
    package_name: packageNameSchema,
  }),
  start_adb_app: z.strictObject({
    client,
    serial: z.string().min(1),
    package_name: packageNameSchema,
    component: z.string().min(1),
    started_activity: z.string().nullable(),
    reported_activity: z.string().nullable().optional(),
    reported_status: z.string().nullable().optional(),
  }),
  start_adb_activity: z.strictObject({
    client,
    serial: z.string().min(1),
    action: z.string().min(1),
    data_uri: z.string().nullable(),
    component: z.string().nullable(),
    extras: z.array(
      z.strictObject({
        key: z.string().min(1),
        type: z.enum(["string", "boolean", "int", "long", "float"]),
        value: z.string(),
      }),
    ),
    started_activity: z.string().nullable(),
    reported_activity: z.string().nullable().optional(),
    reported_status: z.string().nullable().optional(),
  }),
  stop_adb_app: z.strictObject({
    client,
    serial: z.string().min(1),
    package_name: packageNameSchema,
  }),
} as const;

/** Completed display facts retained when the required physical size is unreadable. */
export const adbDisplayPartialObservationSchema = z.strictObject({
  provider_id: z.literal("adb"),
  operation: z.literal("inspect_adb_display"),
  reason: z.enum(["physical_size_absent", "physical_size_malformed"]),
  result: adbResultSchemas.inspect_adb_display.extend({
    physical_size: z.null(),
    coverage: z.literal("partial"),
  }),
});
export type AdbDisplayPartialObservation = z.infer<
  typeof adbDisplayPartialObservationSchema
>;

/** Parsed focus facts, before the adapter supplies client and command identity. */
export type AdbWindowFocusObservation = Omit<
  z.infer<typeof adbResultSchemas.inspect_adb_window>,
  "client" | "serial" | "source_section"
>;

/** Launch-attempt facts retained when Activity Manager does not report success. */
export type AdbActivityStartPartialObservation =
  | {
      readonly provider_id: "adb";
      readonly operation: "start_adb_app";
      readonly result: z.infer<typeof adbResultSchemas.start_adb_app>;
    }
  | {
      readonly provider_id: "adb";
      readonly operation: "start_adb_activity";
      readonly result: z.infer<typeof adbResultSchemas.start_adb_activity>;
    };

/** Acquired package facts retained when cancellation leaves caller-owned output. */
export type AdbPackagePullPartialObservation = {
  readonly provider_id: "adb";
  readonly operation: "pull_adb_package";
  readonly result: z.infer<typeof adbResultSchemas.pull_adb_package>;
};

/** Acquired file facts retained when publication, digest verification or cleanup fails. */
export type AdbAcquiredFilePartialObservation =
  | {
      readonly provider_id: "adb";
      readonly operation: "pull_adb_file";
      readonly result:
        | {
            readonly client: z.infer<
              typeof adbResultSchemas.pull_adb_file
            >["client"];
            readonly serial: string;
            readonly local_path: string;
            readonly device_path: string;
            readonly digest_status: "unknown";
          }
        | z.infer<typeof adbResultSchemas.pull_adb_file>;
    }
  | {
      readonly provider_id: "adb";
      readonly operation: "collect_adb_bugreport";
      readonly result:
        | z.infer<typeof adbResultSchemas.collect_adb_bugreport>
        | {
            readonly client: z.infer<
              typeof adbResultSchemas.collect_adb_bugreport
            >["client"];
            readonly serial: string;
            readonly local_path: string;
            readonly adb_reported_path: string;
            readonly digest_status: "unknown";
          };
    };
