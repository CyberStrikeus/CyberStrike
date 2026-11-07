export interface AppleIpsFixtureOptions {
  readonly bugType?: string;
  readonly procName?: string;
  readonly uuid?: string;
  readonly arch?: string | null;
  readonly imageOffset?: number;
  readonly base?: number;
  readonly exceptionType?: string;
  readonly signal?: string;
  readonly subtype?: string;
  readonly terminationNamespace?: string;
  readonly terminationCode?: string;
  readonly terminationIndicator?: string;
  readonly terminationReasons?: readonly string[];
  readonly registerValue?: string;
  /** Emit the older string `osVersion` form instead of the producer dictionary. */
  readonly osVersionText?: string;
  readonly extraBody?: string;
  readonly truncateBody?: boolean;
}

const defaultUuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** First-line metadata object as macOS ReportCrash writes it. */
export const appleIpsMetadataLine = (
  options: Pick<AppleIpsFixtureOptions, "bugType" | "procName"> = {},
): string =>
  JSON.stringify({
    app_name: options.procName ?? "rea-crash-fixture",
    timestamp: "2026-01-01 00:00:00.000 +0000",
    app_version: "",
    slice_uuid: defaultUuid,
    build_version: "",
    platform: 1,
    share_with_app_devs: 0,
    is_first_party: 1,
    bug_type: options.bugType ?? "309",
    os_version: "macOS 15.0 (24A335)",
    roots_installed: 0,
    bundleID: "test.rea.fixture",
    incident_id: "AAAA-BBBB",
    name: options.procName ?? "rea-crash-fixture",
  });

/**
 * Two-object Apple .ips crash report with a 309 metadata line, shaped like
 * ReportCrash output: dictionary `osVersion`, `threadState.flavor`, register
 * descriptions, a non-faulting thread with an inlined top frame, and unlisted
 * producer keys.
 */
export const appleIpsReport = (
  options: AppleIpsFixtureOptions = {},
): string => {
  const metadata = appleIpsMetadataLine(options);
  const uuid = options.uuid ?? defaultUuid;
  const arch = options.arch === undefined ? "arm64" : options.arch;
  const base = options.base ?? 4294967296;
  const imageOffset = options.imageOffset ?? 824;
  const register = options.registerValue ?? "9594637537912899908";
  const reasons =
    options.terminationReasons === undefined
      ? ""
      : `,"reasons":${JSON.stringify([...options.terminationReasons])}`;
  const extra = options.extraBody ?? "";
  const archJson = arch === null ? "null" : JSON.stringify(arch);
  const osVersion =
    options.osVersionText === undefined
      ? `{ "train": "macOS 15.0", "build": "24A335", "releaseType": "User" }`
      : JSON.stringify(options.osVersionText);
  const body = `{
  "uptime": 1000,
  "procRole": "Foreground",
  "version": 2,
  "userID": 501,
  "deployVersion": 210,
  "modelCode": "Mac14,2",
  "osVersion": ${osVersion},
  "captureTime": "2026-01-01 00:00:00.0000 +0000",
  "incident": "AAAA-BBBB",
  "pid": 4242,
  "translated": false,
  "cpuType": "ARM-64",
  "procName": ${JSON.stringify(options.procName ?? "rea-crash-fixture")},
  "procPath": "/tmp/rea-crash-fixture",
  "parentProc": "zsh",
  "parentPid": 100,
  "coalitionName": "com.apple.Terminal",
  "instructionByteStream": { "beforePC": "AAAA", "atPC": "AAAA" },
  "sip": "enabled",
  "vmRegionInfo": "0x10 is not in any region.",
  "exception": {
    "codes": "0x0000000000000001, 0x0000000000000010",
    "rawCodes": [1, 16],
    "type": ${JSON.stringify(options.exceptionType ?? "EXC_BAD_ACCESS")},
    "signal": ${JSON.stringify(options.signal ?? "SIGSEGV")},
    "subtype": ${JSON.stringify(options.subtype ?? "KERN_INVALID_ADDRESS at 0x0000000000000010")}
  },
  "termination": {
    "flags": 0,
    "code": ${options.terminationCode ?? "11"},
    "namespace": ${JSON.stringify(options.terminationNamespace ?? "SIGNAL")},
    "indicator": ${JSON.stringify(options.terminationIndicator ?? "Segmentation fault: 11")},
    "byProc": "exc handler",
    "byPid": 4242${reasons}
  },
  "extMods": { "caller": { "thread_create": 0 }, "warnings": 0 },
  "faultingThread": 0,
  "threads": [
    {
      "triggered": true,
      "id": 1,
      "threadState": {
        "x": [
          { "value": ${register} },
          { "value": 16 }
        ],
        "flavor": "ARM_THREAD_STATE64",
        "lr": { "value": ${String(base + 900)} },
        "esr": { "value": 2449473606, "description": "(Data Abort) byte read Translation fault" },
        "pc": { "value": ${String(base + imageOffset)}, "matchesCrashFrame": 1 },
        "far": { "value": 16 }
      },
      "queue": "com.apple.main-thread",
      "frames": [
        { "imageOffset": ${String(imageOffset)}, "symbol": "rea_fixture_fault", "symbolLocation": 12, "imageIndex": 0 },
        { "imageOffset": 900, "symbol": "main", "symbolLocation": 40, "imageIndex": 0 }
      ]
    },
    {
      "id": 2,
      "name": "worker",
      "frames": [
        { "imageOffset": 1000, "symbol": "rea_fixture_inlined", "symbolLocation": 0, "imageIndex": 0, "inline": true },
        { "imageOffset": 1000, "symbol": "rea_fixture_wait", "symbolLocation": 8, "imageIndex": 0 },
        { "imageOffset": 1100, "symbol": "rea_fixture_worker", "symbolLocation": 20, "imageIndex": 0 }
      ]
    }
  ],
  "usedImages": [
    {
      "source": "P",
      "arch": ${archJson},
      "base": ${String(base)},
      "size": 16384,
      "uuid": ${JSON.stringify(uuid)},
      "path": "/tmp/rea-crash-fixture",
      "name": "rea-crash-fixture"
    },
    {
      "source": "A",
      "arch": null,
      "base": 0,
      "size": 0,
      "uuid": "00000000-0000-0000-0000-000000000000",
      "path": ""
    }
  ],
  "sharedCache": { "base": 6442450944, "size": 4294967296, "uuid": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
  "vmSummary": "ReadOnly portion of Libraries: Total=1.0G",
  "legacyInfo": { "threadTriggered": { "queue": "com.apple.main-thread" } },
  "trialInfo": { "rollouts": [], "experiments": [] }${extra}
}`;
  if (options.truncateBody === true) return `${metadata}\n${body.slice(0, 40)}`;
  return `${metadata}\n${body}`;
};

export const appleIpsBytes = (options: AppleIpsFixtureOptions = {}): Buffer =>
  Buffer.from(appleIpsReport(options), "utf8");

/**
 * Register excerpt from a public ReportCrash .ips log:
 * https://github.com/Mortennn/Dozer/issues/189
 * The metadata and surrounding body are authored test scaffolding. The
 * malformed variant changes only tmp1 to exercise source-path reporting.
 */
export const appleIpsRosettaBytes = (tmp1: number | string = 532): Buffer =>
  Buffer.from(
    `${appleIpsMetadataLine()}\n{
      "translated": true,
      "cpuType": "X86-64",
      "threads": [{
        "threadState": {
          "flavor": "x86_THREAD_STATE",
          "rbp": { "value": 13029550560 },
          "r12": { "value": 0 },
          "rosetta": {
            "tmp2": { "value": 140706223703876 },
            "tmp1": { "value": ${JSON.stringify(tmp1)} },
            "tmp0": { "value": 140703707485410 }
          },
          "rbx": { "value": 140703456658352 }
        }
      }],
      "usedImages": []
    }`,
    "utf8",
  );
