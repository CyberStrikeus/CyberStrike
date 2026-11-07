import { describe, expect, it } from "vitest";
import {
  normalizeBinwalkReport,
  normalizeUnblobReport,
} from "./FirmwareReports.js";

const context = {
  inputPath: "/private/input.bin",
  outputRoot: "/private/output",
  sha256: "a".repeat(64),
  length: 20,
  offset: 64,
  maxDepth: 3,
};
const root = () => ({
  task: {
    path: context.inputPath,
    depth: 0,
    blob_id: "",
    is_multi_file: false,
  },
  reports: [
    {
      __typename__: "StatReport",
      path: context.inputPath,
      size: 20,
      is_file: true,
      is_dir: false,
      is_link: false,
      link_target: null,
    },
    { __typename__: "HashReport", sha256: context.sha256 },
    {
      __typename__: "UnknownChunkReport",
      id: "unknown",
      start_offset: 0,
      end_offset: 20,
      size: 20,
      randomness: null,
    },
  ],
  subtasks: [],
});

/** A chunk whose extraction failed on a missing dependency, when asked for it. */
const nestedDependencyChunk = (id: string, offset: number) => ({
  __typename__: "ChunkReport",
  id,
  start_offset: offset,
  end_offset: offset + 10,
  size: 10,
  handler_name: `handler-${id}`,
  is_encrypted: false,
  extraction_reports:
    id === "gzip-id"
      ? [
          {
            __typename__: "ExtractorDependencyNotFoundReport",
            severity: "ERROR",
            dependencies: ["sasquatch"],
          },
        ]
      : [],
});

describe("firmware producer chunk observations", () => {
  it("retains unknown chunks and their selected original-file range", () => {
    const normalized = normalizeUnblobReport([root()], context);
    expect(normalized.coverage).toBe("partial");
    expect(normalized.chunks[0]).toMatchObject({
      handler: null,
      range: { offset: 0, length: 20 },
      root_file_range: { offset: 64, length: 20 },
    });
    expect(normalized.missing_dependencies).toEqual([]);
  });
});

describe("firmware producer dependency ownership", () => {
  it("derives missing extractor dependencies from chunk and multi-file reports", () => {
    const record = root();
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: record.reports.filter(
            (item) => item.__typename__ !== "UnknownChunkReport",
          ),
          subtasks: [
            {
              path: `${context.outputRoot}/rootfs`,
              depth: 1,
              blob_id: "sq-id",
              is_multi_file: false,
            },
          ],
        },
        {
          task: {
            path: `${context.outputRoot}/rootfs`,
            depth: 1,
            blob_id: "sq-id",
            is_multi_file: false,
          },
          reports: [
            {
              __typename__: "StatReport",
              path: `${context.outputRoot}/rootfs`,
              size: 0,
              is_file: false,
              is_dir: true,
              is_link: false,
              link_target: null,
            },
            {
              __typename__: "MultiFileReport",
              id: "sq-id",
              handler_name: "squashfs",
              name: "rootfs",
              paths: [],
              extraction_reports: [
                {
                  __typename__: "ExtractorDependencyNotFoundReport",
                  severity: "ERROR",
                  dependencies: ["sasquatch"],
                },
              ],
            },
          ],
          subtasks: [],
        },
      ],
      context,
    );
    expect(normalized.missing_dependencies).toEqual([]);
    expect(normalized.failed_extraction_stages).toEqual([
      {
        input_path: "$output/rootfs",
        provider_id: "sq-id",
        handler: "squashfs",
        dependencies: ["sasquatch"],
        kind: "missing-extractor-dependency",
      },
    ]);
    expect(normalized.chunk_missing_dependencies).toEqual([]);
  });
  it("orders chunk dependencies totally across provider ids", () => {
    const record = root();
    const chunkWithDependency = (id: string, offset: number) => ({
      __typename__: "ChunkReport",
      id,
      start_offset: offset,
      end_offset: offset + 10,
      size: 10,
      handler_name: `handler-${id}`,
      is_encrypted: false,
      extraction_reports: [
        {
          __typename__: "ExtractorDependencyNotFoundReport",
          severity: "ERROR",
          dependencies: [`${id}-tool`],
        },
      ],
    });
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: [
            ...record.reports.filter(
              (item) => item.__typename__ !== "UnknownChunkReport",
            ),
            chunkWithDependency("b-id", 0),
            chunkWithDependency("a-id", 10),
          ],
        },
      ],
      context,
    );
    expect(normalized.chunk_missing_dependencies).toEqual([
      {
        input_path: "$input",
        provider_id: "a-id",
        dependencies: ["a-id-tool"],
      },
      {
        input_path: "$input",
        provider_id: "b-id",
        dependencies: ["b-id-tool"],
      },
    ]);
  });
  it("keeps chunk-nested dependency reports bound to their owning chunk", () => {
    const record = root();
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: [
            ...record.reports.filter(
              (item) => item.__typename__ !== "UnknownChunkReport",
            ),
            nestedDependencyChunk("gzip-id", 0),
            nestedDependencyChunk("other-id", 10),
          ],
        },
      ],
      context,
    );
    expect(normalized.missing_dependencies).toEqual([]);
    expect(normalized.chunk_missing_dependencies).toEqual([
      {
        input_path: "$input",
        provider_id: "gzip-id",
        dependencies: ["sasquatch"],
      },
    ]);
  });
});

describe("firmware dependency failures with unavailable identities", () => {
  it.each([{ dependencies: [] }, { dependencies: ["", ""] }])(
    "retains unnamed chunk dependency ownership ($dependencies)",
    ({ dependencies }) => {
      const record = root();
      const normalized = normalizeUnblobReport(
        [
          {
            ...record,
            reports: [
              ...record.reports.filter(
                (item) => item.__typename__ !== "UnknownChunkReport",
              ),
              {
                ...nestedDependencyChunk("gzip-id", 0),
                extraction_reports: [
                  {
                    __typename__: "ExtractorDependencyNotFoundReport",
                    severity: "ERROR",
                    dependencies,
                  },
                ],
              },
            ],
          },
        ],
        context,
      );
      expect(normalized.missing_dependencies).toEqual([]);
      expect(normalized.chunk_missing_dependencies).toEqual([
        {
          input_path: "$input",
          provider_id: "gzip-id",
          dependencies: [],
        },
      ]);
    },
  );
  it("retains the missing-dependency reason on an unnamed multi-file stage", () => {
    const record = root();
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: [
            ...record.reports,
            {
              __typename__: "MultiFileReport",
              id: "multi-id",
              handler_name: "multipart-firmware",
              name: "parts",
              paths: [],
              extraction_reports: [
                {
                  __typename__: "ExtractorDependencyNotFoundReport",
                  severity: "ERROR",
                  dependencies: [],
                },
              ],
            },
          ],
        },
      ],
      context,
    );
    expect(normalized.failed_extraction_stages).toEqual([
      {
        input_path: "$input",
        provider_id: "multi-id",
        handler: "multipart-firmware",
        dependencies: [],
        kind: "missing-extractor-dependency",
      },
    ]);
  });
  it("retains named and unnamed dependency reports on one multi-file stage", () => {
    const record = root();
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: [
            ...record.reports,
            {
              __typename__: "MultiFileReport",
              id: "multi-id",
              handler_name: "multipart-firmware",
              name: "parts",
              paths: [],
              extraction_reports: [
                {
                  __typename__: "ExtractorDependencyNotFoundReport",
                  severity: "ERROR",
                  dependencies: ["sasquatch"],
                },
                {
                  __typename__: "ExtractorDependencyNotFoundReport",
                  severity: "ERROR",
                  dependencies: [],
                },
              ],
            },
          ],
        },
      ],
      context,
    );
    expect(normalized.failed_extraction_stages).toEqual([
      {
        input_path: "$input",
        provider_id: "multi-id",
        handler: "multipart-firmware",
        dependencies: ["sasquatch"],
        kind: "missing-extractor-dependency",
      },
      {
        input_path: "$input",
        provider_id: "multi-id",
        handler: "multipart-firmware",
        dependencies: [],
        kind: "missing-extractor-dependency",
      },
    ]);
  });
});

describe("firmware producer chunk failures", () => {
  it("marks chunks whose extraction reported problems", () => {
    const record = root();
    const failing = {
      __typename__: "ChunkReport",
      id: "zip-id",
      start_offset: 0,
      end_offset: 20,
      size: 20,
      handler_name: "zip",
      is_encrypted: false,
      extraction_reports: [
        { __typename__: "SomeProducerFailure", severity: "ERROR" },
      ],
    };
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: [
            ...record.reports.filter(
              (item) => item.__typename__ !== "UnknownChunkReport",
            ),
            failing,
          ],
        },
      ],
      context,
    );
    expect(normalized.chunks).toHaveLength(1);
    expect(normalized.chunks[0]).toMatchObject({
      handler: "zip",
      extraction_failure_kinds: ["extractor-failure"],
    });
    expect(normalized.coverage).toBe("partial");
  });
});

const registerFirmwareIndependentFailureCases = () => {
  it.each(["chunk", "multi-file"] as const)(
    "retains independent failure kinds at one %s owner",
    (owner) => {
      const record = root();
      const extraction_reports = [
        {
          __typename__: "ExtractorDependencyNotFoundReport",
          severity: "ERROR",
          dependencies: ["sasquatch"],
        },
        {
          __typename__: "UnknownError",
          severity: "ERROR",
          exception: "independent failure",
        },
      ];
      const observation =
        owner === "chunk"
          ? {
              __typename__: "ChunkReport",
              id: "stage-id",
              handler_name: "gzip",
              start_offset: 0,
              end_offset: 20,
              size: 20,
              is_encrypted: false,
              extraction_reports,
            }
          : {
              __typename__: "MultiFileReport",
              id: "stage-id",
              handler_name: "gzip",
              name: "rootfs",
              paths: [],
              extraction_reports,
            };
      const normalized = normalizeUnblobReport(
        [
          {
            ...record,
            reports: [
              ...record.reports.filter(
                (item) => item.__typename__ !== "UnknownChunkReport",
              ),
              observation,
            ],
          },
        ],
        context,
      );
      if (owner === "chunk") {
        expect(normalized.chunks[0]?.extraction_failure_kinds).toEqual([
          "missing-extractor-dependency",
          "extractor-failure",
        ]);
        expect(normalized.chunk_missing_dependencies).toEqual([
          {
            input_path: "$input",
            provider_id: "stage-id",
            dependencies: ["sasquatch"],
          },
        ]);
      } else {
        expect(normalized.failed_extraction_stages).toEqual([
          {
            input_path: "$input",
            provider_id: "stage-id",
            handler: "gzip",
            dependencies: ["sasquatch"],
            kind: "missing-extractor-dependency",
          },
          {
            input_path: "$input",
            provider_id: "stage-id",
            handler: "gzip",
            dependencies: [],
            kind: "extractor-failure",
          },
        ]);
      }
    },
  );
};

const registerFirmwareDiagnosticOutcomeCases = () => {
  const outcomes = [
    {
      name: "task exception",
      report: {
        __typename__: "UnknownError",
        severity: "ERROR",
        exception: "inert fixture",
      },
      failed: true,
    },
    {
      name: "future declared error",
      report: { __typename__: "FutureProducerError", severity: "ERROR" },
      failed: true,
    },
    {
      name: "command warning",
      report: {
        __typename__: "ExtractCommandFailedReport",
        severity: "WARNING",
        command: "fixture",
        stdout: "",
        stderr: "",
        exit_code: 1,
      },
      failed: false,
    },
    {
      name: "resolved extraction problem",
      report: {
        __typename__: "ExtractionProblem",
        problem: "duplicate path",
        resolution: "kept first entry",
        path: "config",
      },
      failed: false,
    },
  ];

  it.each(["task", "chunk", "multi-file"] as const)(
    "preserves diagnostic outcomes at the %s owner",
    (owner) => {
      for (const { report, failed } of outcomes) {
        const record = root();
        const observation =
          owner === "task"
            ? report
            : owner === "chunk"
              ? {
                  __typename__: "ChunkReport",
                  id: "stage-id",
                  handler_name: "gzip",
                  start_offset: 0,
                  end_offset: 20,
                  size: 20,
                  is_encrypted: false,
                  extraction_reports: [report],
                }
              : {
                  __typename__: "MultiFileReport",
                  id: "stage-id",
                  handler_name: "gzip",
                  name: "rootfs",
                  paths: [],
                  extraction_reports: [report],
                };
        const normalized = normalizeUnblobReport(
          [
            {
              ...record,
              reports: [
                ...record.reports.filter(
                  (item) => item.__typename__ !== "UnknownChunkReport",
                ),
                observation,
              ],
            },
          ],
          context,
        );
        expect(normalized.coverage).toBe("partial");
        expect(normalized.diagnostics).toHaveLength(1);
        expect(normalized.diagnostics[0]).toMatchObject({
          input_path: "$input",
          report: owner === "multi-file" ? observation : report,
        });
        if (owner === "chunk") {
          expect(normalized.chunks[0]?.extraction_failure_kinds).toEqual(
            failed ? ["extractor-failure"] : [],
          );
          expect(normalized.failed_extraction_stages).toEqual([]);
        } else {
          expect(normalized.failed_extraction_stages).toEqual(
            failed
              ? [
                  {
                    input_path: "$input",
                    provider_id: owner === "task" ? null : "stage-id",
                    handler: owner === "task" ? null : "gzip",
                    dependencies: [],
                    kind: "extractor-failure",
                  },
                ]
              : [],
          );
        }
      }
    },
  );
};

describe("firmware producer error severity", () => {
  registerFirmwareIndependentFailureCases();
  registerFirmwareDiagnosticOutcomeCases();
});

describe("firmware task dependency failures", () => {
  it.each([{ dependencies: [] }, { dependencies: ["", ""] }])(
    "retains unnamed dependency failures ($dependencies)",
    ({ dependencies }) => {
      const record = root();
      const normalized = normalizeUnblobReport(
        [
          {
            ...record,
            reports: [
              ...record.reports,
              {
                __typename__: "ExtractorDependencyNotFoundReport",
                severity: "ERROR",
                dependencies,
              },
            ],
          },
        ],
        context,
      );
      expect(normalized.missing_dependencies).toEqual([
        { input_path: "$input", dependencies: [] },
      ]);
      expect(normalized.diagnostics).toHaveLength(1);
    },
  );
  it("retains named and unnamed task dependency reports together", () => {
    const record = root();
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: [
            ...record.reports,
            {
              __typename__: "ExtractorDependencyNotFoundReport",
              severity: "ERROR",
              dependencies: ["sasquatch"],
            },
            {
              __typename__: "ExtractorDependencyNotFoundReport",
              severity: "ERROR",
              dependencies: [],
            },
          ],
        },
      ],
      context,
    );
    expect(normalized.missing_dependencies).toEqual([
      { input_path: "$input", dependencies: ["sasquatch"] },
      { input_path: "$input", dependencies: [] },
    ]);
  });
});

describe("firmware chunk dependency failures", () => {
  it("retains named and unnamed dependency reports on one chunk", () => {
    const record = root();
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: [
            ...record.reports.filter(
              (item) => item.__typename__ !== "UnknownChunkReport",
            ),
            {
              ...nestedDependencyChunk("gzip-id", 0),
              extraction_reports: [
                {
                  __typename__: "ExtractorDependencyNotFoundReport",
                  severity: "ERROR",
                  dependencies: ["sasquatch"],
                },
                {
                  __typename__: "ExtractorDependencyNotFoundReport",
                  severity: "ERROR",
                  dependencies: [],
                },
              ],
            },
          ],
        },
      ],
      context,
    );
    expect(normalized.chunk_missing_dependencies).toEqual([
      {
        input_path: "$input",
        provider_id: "gzip-id",
        dependencies: ["sasquatch"],
      },
      { input_path: "$input", provider_id: "gzip-id", dependencies: [] },
    ]);
  });
  it("preserves unfamiliar report types as explicit diagnostics", () => {
    const record = root();
    const normalized = normalizeUnblobReport(
      [
        {
          ...record,
          reports: [
            ...record.reports,
            { __typename__: "FutureError", reason: "new producer facet" },
          ],
        },
      ],
      context,
    );
    expect(normalized.diagnostics).toEqual([
      {
        input_path: "$input",
        report: { __typename__: "FutureError", reason: "new producer facet" },
      },
    ]);
    expect(normalized.coverage).toBe("partial");
  });
});

describe("Unblob multi-file extraction diagnostics", () => {
  it.each([
    { dependencies: ["sasquatch"], names: ["sasquatch", "nested-tool"] },
    { dependencies: ["sasquatch", ""], names: ["sasquatch", "nested-tool"] },
    { dependencies: [], names: ["nested-tool"] },
  ])(
    "retains nested dependency diagnostics beneath $dependencies",
    ({ dependencies, names }) => {
      const dependencyFailure = {
        __typename__: "ExtractorDependencyNotFoundReport",
        severity: "ERROR",
        dependencies,
        nested_reports: [
          {
            __typename__: "ExtractorDependencyNotFoundReport",
            dependencies: ["nested-tool", "nested-tool"],
          },
        ],
      };
      const record = root();
      const normalized = normalizeUnblobReport(
        [
          {
            ...record,
            reports: [
              ...record.reports.filter(
                (item) => item.__typename__ !== "UnknownChunkReport",
              ),
              {
                __typename__: "ChunkReport",
                id: "gzip-id",
                start_offset: 0,
                end_offset: 20,
                size: 20,
                handler_name: "gzip",
                is_encrypted: false,
                extraction_reports: [dependencyFailure],
              },
            ],
          },
        ],
        context,
      );
      expect(normalized.coverage).toBe("partial");
      expect(normalized.diagnostics).toEqual([
        {
          input_path: "$input",
          stage: "gzip",
          missing_dependencies: names,
          report: dependencyFailure,
        },
      ]);
      expect(normalized.chunk_missing_dependencies).toEqual([
        ...(dependencies.includes("sasquatch")
          ? [
              {
                input_path: "$input",
                provider_id: "gzip-id",
                dependencies: ["sasquatch"],
              },
            ]
          : []),
        ...(dependencies.length === 0 || dependencies.includes("")
          ? [
              {
                input_path: "$input",
                provider_id: "gzip-id",
                dependencies: [],
              },
            ]
          : []),
      ]);
    },
  );
});

describe("Unblob task derivation identities", () => {
  it("joins chunk and MultiFile derivations to their producer blob reports", () => {
    const outputPath = `${context.outputRoot}/multi`;
    const chunkPath = `${context.outputRoot}/chunk-child`;
    const childTask = {
      path: outputPath,
      depth: 1,
      blob_id: "multi-id",
      is_multi_file: false,
    };
    const extractionFailure = {
      __typename__: "ExtractorDependencyNotFoundReport",
      severity: "ERROR",
      dependencies: ["sasquatch"],
    };
    const multiFileReport = {
      __typename__: "MultiFileReport",
      id: "multi-id",
      handler_name: "multipart-firmware",
      name: "rootfs",
      paths: [`${outputPath}/part-a`, `${outputPath}/part-b`],
      extraction_reports: [extractionFailure],
    };
    const parent = root();
    const normalized = normalizeUnblobReport(
      [
        {
          ...parent,
          reports: [
            ...parent.reports.filter(
              (item) => item.__typename__ !== "UnknownChunkReport",
            ),
            {
              __typename__: "ChunkReport",
              id: "chunk-id",
              start_offset: 4,
              end_offset: 10,
              size: 6,
              handler_name: "gzip",
              is_encrypted: false,
              extraction_reports: [],
            },
            multiFileReport,
          ],
          subtasks: [
            {
              path: chunkPath,
              depth: 1,
              blob_id: "chunk-id",
              is_multi_file: false,
            },
            childTask,
          ],
        },
        {
          task: {
            path: chunkPath,
            depth: 1,
            blob_id: "chunk-id",
            is_multi_file: false,
          },
          reports: [
            {
              __typename__: "StatReport",
              path: chunkPath,
              size: 4,
              is_file: true,
              is_dir: false,
              is_link: false,
              link_target: null,
            },
          ],
          subtasks: [],
        },
        {
          task: childTask,
          reports: [
            {
              __typename__: "StatReport",
              path: outputPath,
              size: 0,
              is_dir: true,
              is_file: false,
              is_link: false,
              link_target: null,
            },
          ],
          subtasks: [],
        },
      ],
      context,
    );

    expect(normalized.coverage).toBe("partial");
    expect(normalized.derivations).toEqual([
      {
        parent_path: "$input",
        child_path: "$output/chunk-child",
        provider_blob_id: "chunk-id",
        handler: "gzip",
        parent_file_range: { offset: 4, length: 6 },
      },
      {
        parent_path: "$input",
        child_path: "$output/multi",
        provider_blob_id: "multi-id",
        handler: "multipart-firmware",
        parent_file_range: null,
      },
    ]);
    expect(normalized.diagnostics).toEqual([
      {
        input_path: "$input",
        stage: "multipart-firmware",
        missing_dependencies: ["sasquatch"],
        report: multiFileReport,
      },
    ]);
    expect(normalized.failed_extraction_stages).toEqual([
      {
        input_path: "$input",
        provider_id: "multi-id",
        handler: "multipart-firmware",
        dependencies: ["sasquatch"],
        kind: "missing-extractor-dependency",
      },
    ]);
  });
});

describe("failed multi-file extraction stages", () => {
  it("records a failed multi-file stage for a recovery row without chunks", () => {
    const outputPath = `${context.outputRoot}/multi`;
    const childTask = {
      path: outputPath,
      depth: 1,
      blob_id: "multi-id",
      is_multi_file: true,
    };
    const stageFailure = {
      __typename__: "UnknownError",
      severity: "ERROR",
      exception: "inert multi-file extraction failure",
    };
    const normalized = normalizeUnblobReport(
      [
        {
          ...root(),
          reports: root().reports.filter(
            (item) => item.__typename__ !== "UnknownChunkReport",
          ),
          subtasks: [childTask],
        },
        {
          task: childTask,
          reports: [
            {
              __typename__: "StatReport",
              path: outputPath,
              size: 0,
              is_dir: true,
              is_file: false,
              is_link: false,
              link_target: null,
            },
            {
              __typename__: "MultiFileReport",
              id: "multi-id",
              handler_name: "multipart-firmware",
              name: "rootfs",
              paths: [`${outputPath}/part-a`],
              extraction_reports: [stageFailure],
            },
          ],
          subtasks: [],
        },
      ],
      context,
    );
    expect(normalized.failed_extraction_stages).toEqual([
      {
        input_path: "$output/multi",
        provider_id: "multi-id",
        handler: "multipart-firmware",
        dependencies: [],
        kind: "extractor-failure",
      },
    ]);
    expect(normalized.missing_dependencies).toEqual([]);
  });
});

describe("Unblob blob identity validation", () => {
  it("joins reports within each parent, allows missing provenance and rejects local duplicates", () => {
    const rootChild = {
      path: `${context.outputRoot}/root-child`,
      depth: 1,
      blob_id: "shared-id",
      is_multi_file: false,
    };
    const containerTask = {
      path: `${context.outputRoot}/container`,
      depth: 1,
      blob_id: "container-id",
      is_multi_file: false,
    };
    const nestedChild = {
      path: `${context.outputRoot}/container/nested-child`,
      depth: 2,
      blob_id: "shared-id",
      is_multi_file: false,
    };
    const fileRecord = <T extends { path: string }>(task: T) => ({
      task,
      reports: [
        {
          __typename__: "StatReport",
          path: task.path,
          size: 1,
          is_file: true,
          is_dir: false,
          is_link: false,
          link_target: null,
        },
      ],
      subtasks: [],
    });
    const chunk = (
      id: string,
      handler: string,
      start: number,
      end: number,
    ) => ({
      __typename__: "ChunkReport",
      id,
      start_offset: start,
      end_offset: end,
      size: end - start,
      handler_name: handler,
      is_encrypted: false,
      extraction_reports: [],
    });
    const base = root();
    const rootReports = [
      ...base.reports.filter(
        (report) => report.__typename__ !== "UnknownChunkReport",
      ),
      chunk("shared-id", "root-handler", 0, 4),
      chunk("container-id", "container-handler", 4, 10),
    ];
    const normalized = normalizeUnblobReport(
      [
        {
          ...base,
          reports: rootReports,
          subtasks: [rootChild, containerTask],
        },
        fileRecord(rootChild),
        {
          task: containerTask,
          reports: [
            {
              __typename__: "StatReport",
              path: containerTask.path,
              size: 10,
              is_file: true,
              is_dir: false,
              is_link: false,
              link_target: null,
            },
            chunk("shared-id", "nested-handler", 2, 5),
          ],
          subtasks: [nestedChild],
        },
        fileRecord(nestedChild),
      ],
      context,
    );

    expect(normalized.derivations).toMatchObject([
      { handler: "root-handler", parent_file_range: { offset: 0, length: 4 } },
      {
        handler: "container-handler",
        parent_file_range: { offset: 4, length: 6 },
      },
      {
        handler: "nested-handler",
        parent_file_range: { offset: 2, length: 3 },
      },
    ]);

    const noOrigin = {
      ...base,
      reports: base.reports.filter(
        (report) => report.__typename__ !== "UnknownChunkReport",
      ),
      subtasks: [rootChild],
    };
    expect(
      normalizeUnblobReport([noOrigin, fileRecord(rootChild)], context)
        .derivations[0],
    ).toMatchObject({ handler: null, parent_file_range: null });

    expect(() =>
      normalizeUnblobReport(
        [
          {
            ...base,
            reports: [...rootReports, chunk("shared-id", "duplicate", 10, 12)],
            subtasks: [rootChild],
          },
          fileRecord(rootChild),
        ],
        context,
      ),
    ).toThrow("Duplicate blob identity in parent task");
  });
});

describe("firmware producer boundaries", () => {
  it("rejects unknown tasks outside the owned output and disconnected task graphs", () => {
    const record = root();
    for (const path of [
      "/private/output/../escaped",
      "/private/output/unconnected",
    ]) {
      const child = { ...record, task: { ...record.task, path, depth: 1 } };
      expect(() => normalizeUnblobReport([record, child], context)).toThrow();
    }
  });
  it("rejects absent root identity, inconsistent chunk bounds and duplicate tasks", () => {
    const record = root();
    expect(() => normalizeUnblobReport([], context)).toThrow("exactly one");
    expect(() =>
      normalizeUnblobReport(
        [
          {
            ...record,
            reports: record.reports.filter(
              (report) => report.__typename__ !== "HashReport",
            ),
          },
        ],
        context,
      ),
    ).toThrow("hash");
    expect(() =>
      normalizeUnblobReport(
        [
          {
            ...record,
            reports: [
              ...record.reports,
              {
                __typename__: "UnknownChunkReport",
                id: "bad",
                start_offset: 10,
                end_offset: 21,
                size: 11,
              },
            ],
          },
        ],
        context,
      ),
    ).toThrow("bounds");
    expect(() => normalizeUnblobReport([record, record], context)).toThrow(
      "exactly one",
    );
  });
  it("rejects empty, combined and extracting Binwalk reports", () => {
    const record = {
      Analysis: { file_path: context.inputPath, file_map: [], extractions: {} },
    };
    expect(normalizeBinwalkReport([record], context.inputPath, 20)).toEqual([]);
    for (const report of [
      [],
      [record, record],
      [
        {
          Analysis: {
            ...record.Analysis,
            extractions: { hit: { status: "success" } },
          },
        },
      ],
    ])
      expect(() =>
        normalizeBinwalkReport(report, context.inputPath, 20),
      ).toThrow();
  });
});

describe("selected firmware byte coverage", () => {
  const known = (id: string, start: number, end: number) => ({
    __typename__: "ChunkReport",
    id,
    start_offset: start,
    end_offset: end,
    size: end - start,
    handler_name: "gzip",
    is_encrypted: false,
    extraction_reports: [],
  });
  it.each([
    { name: "empty chunk inventory", spans: [], gaps: [[0, 20]] },
    {
      name: "internal and trailing holes",
      spans: [
        [2, 5],
        [7, 10],
      ],
      gaps: [
        [0, 2],
        [5, 2],
        [10, 10],
      ],
    },
    {
      name: "overlapping unordered coverage",
      spans: [
        [8, 20],
        [0, 10],
        [2, 4],
      ],
      gaps: [],
    },
    {
      name: "adjacent coverage",
      spans: [
        [10, 20],
        [0, 10],
      ],
      gaps: [],
    },
  ] as const)(
    "derives $name from byte intervals without invented chunk identities",
    ({ spans, gaps }) => {
      const record = root();
      const reports = record.reports.filter(
        (report) => report.__typename__ !== "UnknownChunkReport",
      );
      const normalized = normalizeUnblobReport(
        [
          {
            ...record,
            reports: [
              ...reports,
              ...spans.map(([start, end], index) =>
                known(String(index), start, end),
              ),
            ],
          },
        ],
        context,
      );
      expect(normalized.coverage).toBe(
        gaps.length > 0 ? "partial" : "complete",
      );
      expect(normalized.unclassified_ranges).toEqual(
        gaps.map(([offset, length]) => ({
          input_path: "$input",
          range: { offset, length },
          root_file_range: { offset: 64 + offset, length },
        })),
      );
      expect(normalized.chunks).toHaveLength(spans.length);
    },
  );
});

const reportsAtProblemOwner = (
  owner: "task" | "chunk" | "multi-file",
  problems: readonly Record<string, unknown>[],
) => {
  if (owner === "task") return problems;
  const common = {
    id: "problem-owner",
    handler_name: "fixture-handler",
    extraction_reports: problems,
  };
  return [
    owner === "chunk"
      ? {
          ...common,
          __typename__: "ChunkReport",
          start_offset: 0,
          end_offset: 20,
          size: 20,
          is_encrypted: false,
        }
      : {
          ...common,
          __typename__: "MultiFileReport",
          name: "parts",
          paths: [],
        },
  ];
};

it.each(["task", "chunk", "multi-file"] as const)(
  "keeps dependency declaration admission and aggregation at its %s owner",
  (owner) => {
    for (const valid of [true, false]) {
      const problems = valid
        ? [
            {
              __typename__: "ExtractorDependencyNotFoundReport",
              severity: "ERROR",
              dependencies: ["z-tool", "", "a-tool", "z-tool"],
              producer_detail: "named source declaration",
            },
            {
              __typename__: "ExtractorDependencyNotFoundReport",
              severity: "ERROR",
              dependencies: ["", ""],
              producer_detail: "unnamed source declaration",
            },
          ]
        : [
            {
              __typename__: "ExtractorDependencyNotFoundReport",
              severity: "ERROR",
              dependencies: ["alleged-tool", 42],
              producer_detail: "malformed source declaration",
            },
          ];
      const observations = reportsAtProblemOwner(owner, problems);
      const record = root();
      const normalized = normalizeUnblobReport(
        [
          {
            ...record,
            reports: [
              ...record.reports.filter(
                (item) => item.__typename__ !== "UnknownChunkReport",
              ),
              ...observations,
            ],
          },
        ],
        context,
      );
      const dependencyRows = valid
        ? [
            { input_path: "$input", dependencies: ["a-tool", "z-tool"] },
            { input_path: "$input", dependencies: [] },
          ]
        : [];
      expect(normalized.missing_dependencies).toEqual(
        owner === "task" ? dependencyRows : [],
      );
      expect(normalized.chunk_missing_dependencies).toEqual(
        owner === "chunk"
          ? dependencyRows.map((row) => ({
              ...row,
              provider_id: "problem-owner",
            }))
          : [],
      );
      if (owner === "chunk")
        expect(normalized.chunks[0]?.extraction_failure_kinds).toEqual([
          valid ? "missing-extractor-dependency" : "extractor-failure",
        ]);
      expect(normalized.failed_extraction_stages).toEqual(
        owner === "multi-file"
          ? (valid ? dependencyRows : [{ dependencies: [] }]).map(
              ({ dependencies }) => ({
                input_path: "$input",
                provider_id: "problem-owner",
                handler: "fixture-handler",
                dependencies,
                kind: valid
                  ? "missing-extractor-dependency"
                  : "extractor-failure",
              }),
            )
          : owner === "task" && !valid
            ? [
                {
                  input_path: "$input",
                  provider_id: null,
                  handler: null,
                  dependencies: [],
                  kind: "extractor-failure",
                },
              ]
            : [],
      );
      const diagnosticRows = owner === "multi-file" ? observations : problems;
      expect(normalized.diagnostics).toEqual(
        diagnosticRows.map((report, index) => ({
          input_path: "$input",
          ...(owner === "task" ? {} : { stage: "fixture-handler" }),
          ...(valid && owner !== "task" && index === 0
            ? { missing_dependencies: ["z-tool", "a-tool"] }
            : {}),
          report,
        })),
      );
      expect(normalized.coverage).toBe("partial");
    }
  },
);
