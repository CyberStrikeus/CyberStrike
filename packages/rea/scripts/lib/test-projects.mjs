import { matchesGlob } from "node:path";

/** Canonical file ownership shared by Vitest and development-test planning. */
export const SOURCE_TEST_PROJECTS = [
  {
    name: "domain",
    group: "source",
    isolate: false,
    include: ["src/{contracts,domain}/**/*.test.ts"],
  },
  {
    name: "services",
    group: "source",
    isolate: false,
    include: ["src/application/**/*.test.ts"],
  },
  {
    name: "adapters",
    group: "source",
    include: [
      "src/*.test.ts",
      "src/{android,apkSignature,apktool,jeb,adb,artifacts,browser,config,cutter,dotnet,electron,erlang,evm,firmware,flutter,pcap,ghidra,go,gpu,hopper,ida,inspector,javascript,main,native,process,providers,python,reference,rust,server,sqlite,wasm,windows}/**/*.test.ts",
    ],
  },
  {
    name: "composition",
    group: "source",
    isolate: false,
    include: ["tests/composition/**/*.test.ts"],
  },
  {
    name: "conformance",
    group: "source",
    isolate: false,
    include: ["tests/conformance/**/*.test.ts"],
    exclude: ["tests/conformance/providers/hopper/realHopperSearch.test.ts"],
  },
  {
    name: "evaluation",
    group: "source",
    isolate: false,
    include: ["tests/evaluation/**/*.test.ts"],
  },
];

export const BUILT_TEST_PROJECTS = [
  {
    name: "boundary",
    group: "built",
    include: [
      "tests/boundary/**/*.test.ts",
      "tests/conformance/providers/hopper/realHopperSearch.test.ts",
    ],
    exclude: [
      "tests/boundary/cli/**/*.test.ts",
      "tests/boundary/mcp/**/*.test.ts",
      "tests/boundary/process/**/*.test.ts",
    ],
  },
  {
    name: "cli-boundary",
    group: "built",
    isolate: false,
    include: ["tests/boundary/cli/**/*.test.ts"],
  },
  {
    name: "process-boundary",
    group: "built",
    include: ["tests/boundary/process/**/*.test.ts"],
  },
  {
    name: "mcp-boundary",
    group: "built",
    isolate: false,
    include: ["tests/boundary/mcp/**/*.test.ts"],
  },
  {
    name: "acceptance",
    group: "built",
    include: ["tests/acceptance/**/*.test.ts"],
  },
  {
    name: "process-global",
    group: "built",
    include: ["tests/process-global/**/*.test.ts"],
  },
];

const ALL_TEST_PROJECTS = [...SOURCE_TEST_PROJECTS, ...BUILT_TEST_PROJECTS];

/** Return the unique Vitest owner for an exact repository-relative test path. */
export const projectForTest = (testPath) => {
  if (
    typeof testPath !== "string" ||
    testPath.startsWith("/") ||
    testPath.includes("\\") ||
    testPath.split("/").some((part) => part === ".." || part === ".") ||
    !testPath.endsWith(".test.ts")
  )
    throw new Error(`Expected a normalized repository test path: ${testPath}`);

  const owners = ALL_TEST_PROJECTS.filter(
    ({ include, exclude = [] }) =>
      include.some((pattern) => matchesGlob(testPath, pattern)) &&
      !exclude.some((pattern) => matchesGlob(testPath, pattern)),
  );
  if (owners.length !== 1)
    throw new Error(
      owners.length === 0
        ? `No test project owns ${testPath}`
        : `Multiple test projects own ${testPath}: ${owners.map(({ name }) => name).join(", ")}`,
    );
  return owners[0];
};
