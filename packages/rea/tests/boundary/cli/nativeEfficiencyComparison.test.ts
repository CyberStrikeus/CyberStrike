import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

// A recording port checks the experimental producer/consumer representation.
// Real provider verification remains in the separate native experiment receipts.
const generate = `
import {measureNativeEntry} from './tests/support/analysis-efficiency/native-entry.mjs';
const sha='0'.repeat(64);
const duplicate=process.argv[1]==='duplicate';
const stale=process.argv[1]==='stale-dos';
const collision=process.argv[1];
const dos=process.argv[1]==='dos'||stale||collision==='load-collision';
const dossier={procedure:{address:'0x1000'},pseudocode:'return;',callers:[],callees:[]};
class ToolFailure extends Error {}
const build=async digit=>{
  const parent='ev_'+digit.repeat(63)+'0';
  let ordinal=0;
  const call=async(name,args)=>{
    if(stale)process.stdout.write(name+'\\n');
    if(name==='open_binary'||name==='close_binary')return {};
    if(name==='inspect_native_load_image')return {evidence_id:'ev_'+digit.repeat(63)+'6',normalized_result:{status:'verified',target_sha256:stale?'f'.repeat(64):sha,entry:{linear_address:'0x1000'}}};
    if(name==='resolve_containing_procedure')return {evidence_id:'ev_'+digit.repeat(63)+'7',normalized_result:{found:true}};
    if(name==='analyze_function')return {evidence_id:parent,subject:{digest:{sha256:sha}},normalized_result:dossier};
    const id='ev_'+digit.repeat(63)+(collision==='containing-collision'?7:collision==='load-collision'?6:duplicate?1:++ordinal);
    if(args.view.kind==='summary')return {evidence_id:id};
    const facet=args.view.facet;
    const item=facet==='pseudocode'?{text:dossier.pseudocode,unit:'utf16-code-units'}:dossier[facet];
    return {evidence_id:id,normalized_result:{parent_evidence_id:parent,artifact:{sha256:sha},item,coverage:{exhausted:true},limitations:[],unknowns:[]}};
  };
  return measureNativeEntry({seed:dos?undefined:'0x1000',values:{path:'/selected/input','native-question':'entry-views'},call,inputSha:sha,ToolFailure});
};
process.stdout.write(JSON.stringify([await build('1'),await build('2')]));
`;

it.each([
  "observed",
  "missing",
  "errored",
  "wrong-target",
  "wrong-entry",
  "unreferenced",
])(
  "binds the DOS model grade to its observed load image: %s",
  async (scenario) => {
    // Synthetic transcripts exercise grading; they are not real-provider or
    // resource measurements. Real DOS transcripts are replayed separately.
    const root = await createTestTempDirectory("rea-dos-grader-");
    const trial = join(root, "trial");
    const referenceDirectory = join(root, "reference");
    await mkdir(trial);
    await mkdir(referenceDirectory);
    const sha = "0".repeat(64);
    const imageId = "ev_" + "1".repeat(64);
    const procedureId = "ev_" + "2".repeat(64);
    const procedure = {
      address: "0x1000",
      name: "entry",
      classification: "observed",
      signature: null,
      locals: [],
      body: { ranges: [], total_bytes: 0 },
    };
    const loadImage = {
      status: "verified",
      target_sha256: sha,
      entry: { linear_address: "0x1000" },
    };
    const reference = {
      artifact_sha256: sha,
      entry_address: "0x1000",
      caller_count: 0,
      callee_count: 0,
      pseudocode_prefix: "return;",
      containing_procedure: { procedure },
      procedure,
      load_image: loadImage,
    };
    const answer = {
      ...reference,
      load_image_status: "verified",
      evidence_ids: [
        procedureId,
        ...(["missing", "errored", "unreferenced"].includes(scenario)
          ? []
          : [imageId]),
      ],
    };
    const event = (tool: string, status: string, value: unknown) => ({
      type: "item.completed",
      item: {
        type: "mcp_tool_call",
        tool,
        status,
        arguments: {},
        result: { structured_content: value },
      },
    });
    const events = [
      event("analyze_function", "completed", { evidence_id: procedureId }),
    ];
    if (scenario !== "missing")
      events.push(
        event(
          "inspect_native_load_image",
          scenario === "errored" ? "failed" : "completed",
          scenario === "errored"
            ? { error: { code: "unsupported_target" } }
            : {
                operation: "inspect_native_load_image",
                evidence_id: imageId,
                normalized_result: {
                  ...loadImage,
                  target_sha256:
                    scenario === "wrong-target" ? "f".repeat(64) : sha,
                  entry: {
                    linear_address:
                      scenario === "wrong-entry" ? "0x2000" : "0x1000",
                  },
                },
              },
        ),
      );
    const resourceLog = join(root, "resource.log");
    const output = join(root, "review.json");
    for (const [path, value] of [
      [
        join(trial, "summary.json"),
        {
          completed_mcp_calls: [
            { tool: "close_binary", status: "completed", arguments: {} },
          ],
        },
      ],
      [join(trial, "trial-settings.json"), {}],
      [join(trial, "cleanup.json"), { profile_removed: true }],
      [join(trial, "answer.txt"), answer],
      [join(referenceDirectory, "answer.json"), reference],
      [
        resourceLog,
        {
          resource_scope: "synthetic-grader-fixture",
          abort: null,
          resource_counters_verified: true,
          resource_events_final: {
            "memory.events": { high: 0, max: 0, oom: 0, oom_kill: 0 },
            "pids.events": { max: 0 },
          },
        },
      ],
    ] as const)
      await writeFile(path, JSON.stringify(value));
    await writeFile(
      join(trial, "events.jsonl"),
      events.map((value) => JSON.stringify(value)).join("\n"),
    );
    const command = execute("python3", [
      resolve("tests/support/analysis-efficiency/review-model.py"),
      "--domain",
      "native",
      "--trial",
      trial,
      "--reference",
      referenceDirectory,
      "--resource-log",
      resourceLog,
      "--output",
      output,
    ]);
    if (scenario === "observed") await command;
    else await expect(command).rejects.toMatchObject({ code: 1 });
    const report = JSON.parse(await readFile(output, "utf8"));
    expect(report.all_selected_checks_pass).toBe(scenario === "observed");
    if (["missing", "errored", "unreferenced"].includes(scenario))
      expect(report.checks.load_image_source_observed_and_referenced).toBe(
        false,
      );
    if (scenario === "wrong-target")
      expect(report.checks["load_image.target_sha256"]).toBe(false);
    if (scenario === "wrong-entry")
      expect(report.checks["load_image.source_entry"]).toBe(false);
  },
);

it("retains the DOS load-image source for its facts and derived entry seed", async () => {
  const { stdout } = await execute(process.execPath, [
    "--input-type=module",
    "-e",
    generate,
    "dos",
  ]);
  const [answer] = JSON.parse(stdout);
  expect(answer).toMatchObject({
    entry_address: "0x1000",
    load_image: { status: "verified", entry: { linear_address: "0x1000" } },
    evidence_ids: { native_load_image: "ev_" + "1".repeat(63) + "6" },
  });
});

it("rejects a stale DOS load image before using its entry and closes the session", async () => {
  await expect(
    execute(process.execPath, [
      "--input-type=module",
      "-e",
      generate,
      "stale-dos",
    ]),
  ).rejects.toMatchObject({
    stdout: "open_binary\ninspect_native_load_image\nclose_binary\n",
    stderr: expect.stringContaining(
      "The DOS load image belongs to a different target",
    ),
  });
});

it.each(["containing-collision", "load-collision"])(
  "rejects a retained view that reuses an earlier producer identity: %s",
  async (collision) => {
    await expect(
      execute(process.execPath, [
        "--input-type=module",
        "-e",
        generate,
        collision,
      ]),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Retained native view reused an Evidence identity",
      ),
    });
  },
);

it("rejects a producer that reuses a view identity across facets", async () => {
  await expect(
    execute(process.execPath, [
      "--input-type=module",
      "-e",
      generate,
      "duplicate",
    ]),
  ).rejects.toMatchObject({
    stderr: expect.stringContaining(
      "Retained native view reused an Evidence identity",
    ),
  });
});

it.each(["references", "item", "coverage", "limitations", "unknowns"])(
  "separates native references while comparing %s exactly",
  async (change) => {
    const { stdout: generated } = await execute(process.execPath, [
      "--input-type=module",
      "-e",
      generate,
    ]);
    const [leftAnswer, rightAnswer] = JSON.parse(generated);
    if (change === "item")
      rightAnswer.retained_views[0].item.address = "0x1001";
    if (change === "coverage")
      rightAnswer.retained_views[0].coverage.exhausted = false;
    if (change === "limitations")
      rightAnswer.retained_views[0].limitations.push("partial");
    if (change === "unknowns")
      rightAnswer.retained_views[0].unknowns.push("unresolved");

    const root = await createTestTempDirectory("rea-native-comparison-");
    const left = join(root, "left");
    const right = join(root, "right");
    const summary = {
      artifact: "sharex.exe",
      native_question: "entry-views",
      provider_search_path_sha256: "0".repeat(64),
      native_workflow_source_sha256: "1".repeat(64),
      calls: [],
      failure: null,
    };
    for (const [directory, answer] of [
      [left, leftAnswer],
      [right, rightAnswer],
    ]) {
      await mkdir(directory);
      await writeFile(join(directory, "summary.json"), JSON.stringify(summary));
      await writeFile(join(directory, "answer.json"), JSON.stringify(answer));
    }
    const output = join(root, "comparison.json");
    const command = execute(process.execPath, [
      resolve("tests/support/analysis-efficiency/compare.mjs"),
      "--left",
      left,
      "--right",
      right,
      "--output",
      output,
    ]);
    if (change !== "references") {
      await expect(command).rejects.toMatchObject({
        code: 1,
        stdout: expect.stringContaining('"retained_views"'),
      });
      return;
    }
    const { stdout } = await command;
    expect(JSON.parse(stdout)).toMatchObject({
      settings_match: true,
      facts_match: true,
      preserved_run_specific_values: [
        {
          side: "left",
          path: ["evidence_ids"],
          value: leftAnswer.evidence_ids,
        },
        {
          side: "right",
          path: ["evidence_ids"],
          value: rightAnswer.evidence_ids,
        },
      ],
    });
    expect(leftAnswer.evidence_ids).not.toEqual(rightAnswer.evidence_ids);
    expect(leftAnswer.evidence_ids.retained_views[0]).toMatchObject({
      evidence_id: "ev_" + "1".repeat(64),
      parent_evidence_id: "ev_" + "1".repeat(63) + "0",
    });
    expect(leftAnswer.evidence_ids.native_summary).toBe(
      "ev_" + "1".repeat(63) + "5",
    );
  },
);
