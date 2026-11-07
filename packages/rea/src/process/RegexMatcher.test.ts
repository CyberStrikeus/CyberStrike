import { expect, it } from "vitest";

import {
  DEFAULT_REGEX_MATCHING_DEADLINE,
  regexMatchingDeadlineRecovery,
} from "../config/regexMatchingDeadline.js";
import {
  regexWorkerHeapRequestRecovery,
  DEFAULT_REGEX_WORKER_HEAP_REQUEST,
} from "../config/regexWorkerHeapRequest.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  execArgvFromCommandLine,
  readLaunchExecArgv,
  readLaunchNodeOptions,
  regexMatchingDeadlineError,
  regexMatchingLimitation,
  regexWorkerHeapError,
  resolveLaunchRegexWorkerHeap,
  resolveRegexWorkerHeap,
  type RegexWorkerHeapLimit,
} from "./RegexMatcher.js";

const effective = (mib: number, overridden: boolean): RegexWorkerHeapLimit => ({
  kind: "effective",
  mib,
  overridden,
});

it.each([
  {
    name: "uses the 128 MiB request when no flag is set",
    execArgv: [],
    nodeOptions: undefined,
    heap: effective(128, false),
  },
  {
    name: "lets a smaller execArgv flag override the request",
    execArgv: ["--max-old-space-size=64"],
    nodeOptions: undefined,
    heap: effective(64, true),
  },
  {
    name: "lets a larger execArgv flag override the request",
    execArgv: ["--require", "./preload.js", "--max_old_space_size=256"],
    nodeOptions: undefined,
    heap: effective(256, true),
  },
  {
    name: "reads a positive NODE_OPTIONS flag that is absent from execArgv",
    execArgv: [],
    nodeOptions: "--no-warnings --max-old-space-size=192",
    heap: effective(192, true),
  },
  {
    name: "lets the last execArgv flag win over NODE_OPTIONS",
    execArgv: ["--max-old-space-size=256"],
    nodeOptions: "--max-old-space-size=96",
    heap: effective(256, true),
  },
  {
    name: "treats a final zero flag as leaving the 128 MiB request in effect",
    execArgv: ["--max-old-space-size=0"],
    nodeOptions: "--max-old-space-size=256",
    heap: effective(128, false),
  },
  {
    name: "accepts quoted NODE_OPTIONS and a leading plus or zeros",
    execArgv: ["--max-old-space-size=+0256"],
    nodeOptions: '"--max-old-space-size=144"',
    heap: effective(256, true),
  },
  {
    name: "uses the last positive flag",
    execArgv: ["--max-old-space-size=256", "--max-old-space-size=96"],
    nodeOptions: undefined,
    heap: effective(96, true),
  },
  {
    name: "leaves the effective heap unknown for an unparsed flag",
    execArgv: ["--max-old-space-size=256.5"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "keeps a later positive flag after an unparsed one",
    execArgv: ["--max-old-space-size=256.5", "--max-old-space-size=80"],
    nodeOptions: undefined,
    heap: effective(80, true),
  },
  {
    name: "leaves an untokenizable NODE_OPTIONS value unknown until execArgv decides",
    execArgv: [],
    nodeOptions: '"--max-old-space-size=256',
    heap: { kind: "unknown" } as const,
  },
  {
    name: "lets execArgv decide when NODE_OPTIONS cannot be tokenized",
    execArgv: ["--max-old-space-size=80"],
    nodeOptions: '"--max-old-space-size=256',
    heap: effective(80, true),
  },
  {
    name: "lets a NODE_OPTIONS percentage win over an execArgv absolute flag",
    execArgv: ["--max-old-space-size=64"],
    nodeOptions: "--max-old-space-size-percentage=50",
    heap: { kind: "unknown" } as const,
  },
  {
    name: "lets an execArgv percentage win over a NODE_OPTIONS absolute flag",
    execArgv: ["--max-old-space-size-percentage=50"],
    nodeOptions: "--max-old-space-size=64",
    heap: { kind: "unknown" } as const,
  },
  {
    name: "recognizes an underscore percentage flag",
    execArgv: ["--max_old_space_size_percentage=50"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "recognizes a percentage flag split from its value",
    execArgv: [
      "--max-old-space-size=64",
      "--max-old-space-size-percentage",
      "50",
    ],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "does not let a later absolute flag replace an invalid percentage",
    execArgv: ["--max-old-space-size-percentage=0", "--max-old-space-size=64"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "leaves a fractional percentage unestablished",
    execArgv: ["--max-old-space-size-percentage=50.5"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "does not treat a final zero absolute flag as 128 MiB after a percentage",
    execArgv: ["--max-old-space-size-percentage=50", "--max-old-space-size=0"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "recognizes an env-file flag split from its path",
    execArgv: ["--env-file", "rea.env"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "lets a later absolute flag win when an inherited NODE_OPTIONS blocks the env file",
    execArgv: ["--max-old-space-size=32", "--env-file-if-exists=rea.env"],
    nodeOptions: "--max-old-space-size=64",
    heap: effective(32, true),
  },
  {
    name: "keeps the 128 MiB request when an empty NODE_OPTIONS blocks the env file",
    execArgv: ["--env-file=rea.env"],
    nodeOptions: "",
    heap: effective(128, false),
  },
  {
    name: "does not let a recovered NODE_OPTIONS hide a config-file heap option",
    execArgv: ["--experimental-default-config-file"],
    nodeOptions: "--max-old-space-size=64",
    heap: { kind: "unknown" } as const,
  },
  {
    name: "leaves a config-file flag in recovered NODE_OPTIONS unestablished",
    execArgv: ["--max-old-space-size=256"],
    nodeOptions: "--experimental-config-file=node.config.json",
    heap: { kind: "unknown" } as const,
  },
  {
    name: "recognizes an underscore --max-heap-size",
    execArgv: ["--max_heap_size=+064"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "does not let a later --max-heap-size hide an old-space flag",
    execArgv: ["--max-old-space-size=64"],
    nodeOptions: "--max_heap_size=256",
    heap: { kind: "unknown" } as const,
  },
  {
    name: "lets a final zero --max-heap-size clear the total-heap cap",
    execArgv: ["--max-heap-size=64", "--max-heap-size=0"],
    nodeOptions: undefined,
    heap: effective(128, false),
  },
  {
    name: "keeps an old-space flag when a final --max-heap-size is zero",
    execArgv: ["--max-old-space-size=256", "--max-heap-size="],
    nodeOptions: undefined,
    heap: effective(256, true),
  },
  {
    name: "leaves an unparsed --max-heap-size unestablished",
    execArgv: ["--max-heap-size=64.5", "--max-old-space-size=80"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
  {
    name: "does not let a later zero clear an unparsed --max-heap-size",
    execArgv: ["--max-heap-size=64.5", "--max-heap-size=0"],
    nodeOptions: undefined,
    heap: { kind: "unknown" } as const,
  },
] as const)(
  "resolveRegexWorkerHeap $name",
  ({ execArgv, nodeOptions, heap }) => {
    expect(resolveRegexWorkerHeap(execArgv, nodeOptions)).toEqual(heap);
  },
);

it("does not treat a rewritten NODE_OPTIONS value as the launch heap", () => {
  const previous = process.env.NODE_OPTIONS;
  const rewritten = "--max-old-space-size=61-rewritten";
  process.env.NODE_OPTIONS = rewritten;
  try {
    const launch = readLaunchNodeOptions();
    if (process.platform === "linux") {
      expect(launch.kind).toBe("recovered");
      if (launch.kind === "recovered")
        expect(launch.value ?? "").not.toContain("61-rewritten");
    } else {
      expect(launch).toEqual({ kind: "unrecoverable" });
    }
    expect(
      resolveLaunchRegexWorkerHeap(
        { kind: "recovered", value: ["--max-old-space-size=256"] },
        { kind: "unrecoverable" },
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      resolveLaunchRegexWorkerHeap(
        { kind: "recovered", value: [] },
        { kind: "recovered", value: "--max_heap_size=64" },
      ),
    ).toEqual({ kind: "unknown" });
    expect(
      resolveLaunchRegexWorkerHeap(
        { kind: "unrecoverable" },
        { kind: "recovered", value: "--max-old-space-size=64" },
      ),
    ).toEqual({ kind: "unknown" });
    if (launch.kind === "recovered") {
      expect(launch.value).not.toBe(rewritten);
      expect(
        resolveLaunchRegexWorkerHeap(
          { kind: "recovered", value: ["--max-old-space-size=32"] },
          launch,
        ),
      ).toEqual(
        resolveRegexWorkerHeap(["--max-old-space-size=32"], launch.value),
      );
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
});

const commandLine = (...tokens: readonly string[]): Buffer =>
  Buffer.from(`${tokens.join("\0")}\0`);

it("recovers launch exec argv from the command line, not process.execArgv", () => {
  expect(
    execArgvFromCommandLine(
      commandLine(
        "node",
        "--max-old-space-size=64",
        "script.js",
        "--max-old-space-size=256",
      ),
    ),
  ).toEqual({ kind: "recovered", value: ["--max-old-space-size=64"] });
  expect(
    resolveLaunchRegexWorkerHeap(
      execArgvFromCommandLine(
        commandLine("node", "--max-old-space-size=64", "script.js"),
      ),
      { kind: "recovered", value: undefined },
    ),
  ).toEqual({ kind: "effective", mib: 64, overridden: true });
  expect(resolveRegexWorkerHeap([], undefined)).toEqual({
    kind: "effective",
    mib: 128,
    overridden: false,
  });
  expect(
    execArgvFromCommandLine(
      commandLine(
        "node",
        "--require",
        "preload.cjs",
        "--max_old_space_size=64",
        "script.js",
      ),
    ),
  ).toEqual({
    kind: "recovered",
    value: ["--require", "preload.cjs", "--max_old_space_size=64"],
  });
  expect(
    execArgvFromCommandLine(
      commandLine("node", "-e", "code", "--max-old-space-size=80"),
    ),
  ).toEqual({
    kind: "recovered",
    value: ["-e", "code", "--max-old-space-size=80"],
  });
  expect(
    execArgvFromCommandLine(
      commandLine("node", "--", "--max-old-space-size=64", "script.js"),
    ),
  ).toEqual({ kind: "recovered", value: [] });
  expect(
    execArgvFromCommandLine(
      commandLine("node", "--not-a-real-node-option", "script.js"),
    ),
  ).toEqual({ kind: "unrecoverable" });
  expect(execArgvFromCommandLine(Buffer.alloc(0))).toEqual({
    kind: "unrecoverable",
  });
  expect(execArgvFromCommandLine(Buffer.from([0xff, 0]))).toEqual({
    kind: "unrecoverable",
  });
  expect(execArgvFromCommandLine(commandLine("rea"))).toEqual({
    kind: "unrecoverable",
  });
  expect(
    execArgvFromCommandLine(
      Buffer.concat([Buffer.from("rea\0"), Buffer.alloc(32)]),
    ),
  ).toEqual({ kind: "unrecoverable" });
  expect(
    resolveLaunchRegexWorkerHeap(
      execArgvFromCommandLine(
        Buffer.concat([Buffer.from("rea\0"), Buffer.alloc(32)]),
      ),
      { kind: "recovered", value: undefined },
    ),
  ).toEqual({ kind: "unknown" });
  expect(execArgvFromCommandLine(commandLine("node", "script.js"))).toEqual({
    kind: "recovered",
    value: [],
  });
  const before = readLaunchExecArgv();
  const snapshot = [...process.execArgv];
  process.execArgv.length = 0;
  try {
    expect(process.execArgv).toEqual([]);
    expect(readLaunchExecArgv()).toEqual(before);
    if (before.kind === "recovered") expect(before.value).toEqual(snapshot);
    else expect(before).toEqual({ kind: "unrecoverable" });
  } finally {
    process.execArgv.push(...snapshot);
  }
});

it("describes the effective heap and the configurable matching deadline", () => {
  for (const heap of [
    effective(128, false),
    effective(256, true),
    { kind: "unknown" } as const,
  ]) {
    const limitation = regexMatchingLimitation(heap);
    for (const fact of [
      "5000 ms",
      "128 MiB",
      "source default",
      "regex.matching_deadline_ms",
      "regex.worker_heap_request_mib",
      "REA_REGEX_MATCHING_DEADLINE_MS",
      "REA_REGEX_WORKER_HEAP_REQUEST_MIB",
      "update_analysis_settings",
    ])
      expect(limitation).toContain(fact);
    // Providers repeat this text per search operation; bounds and recovery
    // stay with the errors below instead of every capability entry.
    expect(limitation).not.toContain(
      regexMatchingDeadlineRecovery(DEFAULT_REGEX_MATCHING_DEADLINE),
    );
    expect(limitation).not.toContain(
      regexWorkerHeapRequestRecovery(DEFAULT_REGEX_WORKER_HEAP_REQUEST),
    );
    expect(limitation.length).toBeLessThan(700);
    if (heap.kind === "effective")
      expect(limitation).toContain(`${String(heap.mib)} MiB`);
    expect(
      projectAnalysisError(regexMatchingDeadlineError("search_procedures"))
        .remediation.action,
    ).toContain(regexMatchingDeadlineRecovery(DEFAULT_REGEX_MATCHING_DEADLINE));
    const projected = projectAnalysisError(
      regexWorkerHeapError("search_procedures", new Error("heap"), heap),
    );
    if (heap.kind === "effective" && !heap.overridden)
      expect(projected.details?.limit).toMatchObject({
        setting: "regex.worker_heap_request_mib",
        effective_value: 128,
        source: "default",
      });
    else expect(projected.details?.limit).toBeUndefined();
    expect(projected.remediation.action).toContain("--max-old-space-size");
    expect(projected.remediation.action).toContain(
      "--max-old-space-size-percentage",
    );
    expect(projected.remediation.action).toContain(
      regexWorkerHeapRequestRecovery(DEFAULT_REGEX_WORKER_HEAP_REQUEST),
    );
    if (heap.kind === "unknown") {
      expect(projected.remediation.action).toContain(
        "--max-old-space-size-percentage",
      );
      expect(projected.remediation.action).toContain(
        "--experimental-config-file",
      );
      expect(projected.remediation.action).toContain("--max-heap-size");
      expect(projected.remediation.action).toContain(
        "--experimental-default-config-file",
      );
      expect(projected.details?.reported_limits).toEqual({
        requested_worker_heap_mib: 128,
        requested_worker_heap_source: "default",
      });
    } else {
      expect(projected.details).toMatchObject({
        reported_limits: {
          worker_heap_mib: heap.mib,
          requested_worker_heap_mib: 128,
          requested_worker_heap_source: "default",
        },
      });
    }
  }
});

it("keeps a selected heap request unless a positive Node flag overrides it", () => {
  const request = { heapMiB: 256, source: "setting" as const };
  expect(resolveRegexWorkerHeap([], undefined, request)).toEqual(
    effective(256, false),
  );
  expect(
    resolveRegexWorkerHeap(["--max-old-space-size=64"], undefined, request),
  ).toEqual(effective(64, true));
  const selected = regexMatchingLimitation(
    effective(256, false),
    DEFAULT_REGEX_MATCHING_DEADLINE,
    request,
  );
  for (const fact of ["256 MiB", "source setting"])
    expect(selected).toContain(fact);
  expect(selected).not.toContain("--max-old-space-size");
  const overridden = regexMatchingLimitation(
    effective(64, true),
    DEFAULT_REGEX_MATCHING_DEADLINE,
    request,
  );
  for (const fact of [
    "64 MiB",
    "256 MiB",
    "source setting",
    "--max-old-space-size",
  ])
    expect(overridden).toContain(fact);
  const projected = projectAnalysisError(
    regexWorkerHeapError(
      "search_procedures",
      new Error("heap"),
      effective(64, true),
      request,
    ),
  );
  expect(projected.details).toMatchObject({
    reported_limits: {
      worker_heap_mib: 64,
      requested_worker_heap_mib: 256,
      requested_worker_heap_source: "setting",
    },
  });
  expect(projected.remediation.action).toContain(
    regexWorkerHeapRequestRecovery(request),
  );
  expect(projected.details?.limit).toBeUndefined();
});
