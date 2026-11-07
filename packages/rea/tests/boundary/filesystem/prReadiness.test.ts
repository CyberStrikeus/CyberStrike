import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import {
  evaluateReadiness,
  runReadinessCheck,
  type ReadinessGitHub,
  type ReadinessPullRequest,
} from "../../../scripts/ci/pr-readiness.mjs";

const template = await readFile(
  new URL("../../../.github/pull_request_template.md", import.meta.url),
  "utf8",
);
const readyBody = template
  .slice(
    template.indexOf("## Author readiness"),
    template.indexOf("## Before merge"),
  )
  .replace("Human owner: <!-- @GitHub-handle -->", "Human owner: @contributor")
  .replaceAll("- [ ]", "- [x]");
const makePull = (
  changes: Partial<ReadinessPullRequest> = {},
): ReadinessPullRequest => ({
  number: 42,
  state: "open",
  draft: false,
  body: readyBody,
  head: { sha: "a".repeat(40) },
  base: { ref: "main" },
  ...changes,
});

const headPage = (
  nodes: readonly { number: number; headRefOid: string }[],
  next: string | null = null,
) => ({
  repository: {
    pullRequests: {
      nodes,
      pageInfo: { hasNextPage: next !== null, endCursor: next },
    },
  },
});

function fixture(changes: Partial<ReadinessPullRequest> = {}) {
  const pull = makePull(changes);
  const get = vi.fn(async () => ({ data: pull }));
  const createCommitStatus = vi.fn(
    async (
      _status: Parameters<
        ReadinessGitHub["rest"]["repos"]["createCommitStatus"]
      >[0],
    ) => ({}),
  );
  const paginate = vi.fn(async () => [pull]);
  const graphql = vi.fn(
    async (
      ..._arguments: Parameters<ReadinessGitHub["graphql"]>
    ): Promise<unknown> => headPage([]),
  );
  const github = {
    graphql,
    rest: {
      pulls: { get },
      repos: {
        createCommitStatus,
        listPullRequestsAssociatedWithCommit: vi.fn(),
      },
    },
    paginate,
  };
  const context = {
    repo: { owner: "morluto", repo: "rea" },
    payload: { pull_request: { number: 42 } },
    serverUrl: "https://github.com",
    runId: 123,
  };
  const core = { info: vi.fn(), setFailed: vi.fn() };
  return {
    github,
    context,
    core,
    get,
    createCommitStatus,
    paginate,
    graphql,
    pull,
  };
}

describe("initial author declaration", () => {
  it("accepts the filled current template and uppercase checkmarks", () => {
    expect(evaluateReadiness(makePull(), template).state).toBe("success");
    expect(
      evaluateReadiness(
        makePull({ body: readyBody.replaceAll("[x]", "[X]") }),
        template,
      ).state,
    ).toBe("success");
    expect(
      evaluateReadiness(
        makePull({ body: readyBody.replaceAll("\n", "\r\n") }),
        template,
      ).state,
    ).toBe("success");
  });

  it("allows drafts without a body or declarations", () => {
    expect(
      evaluateReadiness(makePull({ draft: true, body: null }), template).state,
    ).toBe("pending");
  });

  it.each([0, 1, 2])("requires declaration %i to be checked", (index) => {
    let position = 0;
    const body = readyBody.replaceAll("- [x]", () =>
      position++ === index ? "- [ ]" : "- [x]",
    );
    expect(evaluateReadiness(makePull({ body }), template).state).toBe(
      "failure",
    );
  });

  it.each([
    null,
    readyBody.replace("Human owner: @contributor", "Human owner:"),
    readyBody.replace("Human owner: @contributor", "Human owner: @one @two"),
    readyBody.replace(
      "Human owner: @contributor",
      "Human owner: @automation[bot]",
    ),
    readyBody + "\nHuman owner: @other\n",
    readyBody.replace("## Author readiness", "## Other"),
    readyBody + readyBody,
    `<!--\n${readyBody}\n-->`,
    `~~~markdown\n${readyBody}\n~~~`,
    `\`\`\`markdown\n${readyBody}\n\`\`\``,
    readyBody
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    readyBody.replace(
      "- [x] I declare this PR ready for initial maintainer review.",
      "",
    ),
    readyBody +
      "\n- [x] I declare this PR ready for initial maintainer review.\n",
  ])(
    "rejects missing, hidden, ambiguous, or incomplete declarations (%#)",
    (body) => {
      expect(evaluateReadiness(makePull({ body }), template).state).toBe(
        "failure",
      );
    },
  );

  it("ignores checked examples in comments and fenced blocks before the actual declaration", () => {
    for (const example of [
      `<!--\n${readyBody}\n-->\n`,
      `~~~markdown\n${readyBody}\n~~~\n`,
      `\`\`\`markdown\n${readyBody}\n\`\`\`\n`,
    ])
      expect(
        evaluateReadiness(makePull({ body: example + readyBody }), template)
          .state,
      ).toBe("success");
  });

  it("does not treat an HTML comment inside a code example as hiding the real declaration", () => {
    const body =
      "~~~html\n<!-- an intentionally unfinished HTML example\n~~~\n" +
      readyBody;
    expect(evaluateReadiness(makePull({ body }), template).state).toBe(
      "success",
    );
  });

  it("fails closed when the trusted template loses a declaration", () => {
    expect(() =>
      evaluateReadiness(
        makePull(),
        template.replace(
          "- [ ] I declare this PR ready for initial maintainer review.",
          "",
        ),
      ),
    ).toThrow("three readiness declarations");
  });
});

describe("GitHub status boundary", () => {
  it("publishes failure on the actual PR head when declarations are unchecked", async () => {
    const input = fixture({ body: readyBody.replaceAll("[x]", "[ ]") });
    expect((await runReadinessCheck(input))?.state).toBe("failure");
    expect(
      input.createCommitStatus.mock.calls.map(([status]) => status),
    ).toEqual([
      expect.objectContaining({
        sha: input.pull.head.sha,
        context: "PR readiness",
        state: "pending",
      }),
      expect.objectContaining({
        sha: input.pull.head.sha,
        context: "PR readiness",
        state: "failure",
      }),
    ]);
    expect(input.core.setFailed).toHaveBeenCalledOnce();
  });

  it("keeps drafts pending without failing the workflow", async () => {
    const input = fixture({ draft: true, body: null });
    expect((await runReadinessCheck(input))?.state).toBe("pending");
    expect(input.core.setFailed).not.toHaveBeenCalled();
    expect(input.paginate).not.toHaveBeenCalled();
    expect(input.graphql).not.toHaveBeenCalled();
  });

  it("keeps the initial declaration valid after later pushes", async () => {
    for (const sha of ["a".repeat(40), "b".repeat(40)]) {
      const input = fixture({ head: { sha } });
      expect((await runReadinessCheck(input))?.state).toBe("success");
      expect(input.createCommitStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ sha, state: "success" }),
      );
      expect(input.github.rest.pulls).toEqual({ get: input.get });
      expect(input.graphql).not.toHaveBeenCalled();
    }
  });

  it("does not publish stale success if the PR changes during the check", async () => {
    const input = fixture();
    input.get
      .mockResolvedValueOnce({ data: input.pull })
      .mockResolvedValueOnce({
        data: makePull({ head: { sha: "b".repeat(40) }, body: null }),
      });
    expect((await runReadinessCheck(input))?.state).toBe("pending");
    expect(input.createCommitStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ sha: "b".repeat(40), state: "pending" }),
    );
  });

  it("prevents another open PR from lending its status to the same head", async () => {
    const input = fixture();
    input.paginate.mockResolvedValue([input.pull, makePull({ number: 43 })]);
    expect((await runReadinessCheck(input))?.state).toBe("failure");
    expect(input.core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("distinct head commits"),
    );
  });

  it("leaves the status pending and surfaces API failure", async () => {
    const input = fixture();
    input.paginate.mockRejectedValue(new Error("GitHub unavailable"));
    await expect(runReadinessCheck(input)).rejects.toThrow(
      "GitHub unavailable",
    );
    expect(input.createCommitStatus).toHaveBeenCalledOnce();
    expect(input.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "pending" }),
    );
  });

  it("keeps readiness unknown when GitHub has not associated the head with this PR", async () => {
    const input = fixture();
    input.paginate.mockResolvedValue([]);
    expect((await runReadinessCheck(input))?.state).toBe("pending");
    expect(input.core.setFailed).not.toHaveBeenCalled();
    expect(input.graphql).toHaveBeenCalledOnce();
  });

  it.each([{ state: "closed" as const }, { base: { ref: "other-branch" } }])(
    "ignores closed PRs and unprotected target branches (%#)",
    async (changes) => {
      const input = fixture(changes);
      await runReadinessCheck(input);
      expect(input.createCommitStatus).not.toHaveBeenCalled();
    },
  );

  it("supports manually rechecking an existing PR", async () => {
    const input = fixture();
    await runReadinessCheck({
      ...input,
      context: {
        ...input.context,
        payload: { inputs: { pull_request_number: "42" } },
      },
    });
    expect(input.get).toHaveBeenCalledWith({
      owner: "morluto",
      repo: "rea",
      pull_number: 42,
    });
  });
});

describe("Live PR-head identity", () => {
  it("confirms an unindexed commit through complete paged live PR heads", async () => {
    const input = fixture();
    input.paginate.mockResolvedValue([]);
    input.graphql
      .mockResolvedValueOnce(
        headPage([{ number: 1, headRefOid: "b".repeat(40) }], "next-page"),
      )
      .mockResolvedValueOnce(
        headPage([
          { number: input.pull.number, headRefOid: input.pull.head.sha },
        ]),
      );
    expect((await runReadinessCheck(input))?.state).toBe("success");
    expect(input.graphql).toHaveBeenNthCalledWith(1, expect.any(String), {
      owner: "morluto",
      name: "rea",
      after: null,
    });
    expect(input.graphql).toHaveBeenNthCalledWith(2, expect.any(String), {
      owner: "morluto",
      name: "rea",
      after: "next-page",
    });
    expect(input.createCommitStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ sha: input.pull.head.sha, state: "success" }),
    );
  });

  it("rejects a shared head discovered on a later live page", async () => {
    const input = fixture();
    input.paginate.mockResolvedValue([]);
    input.graphql
      .mockResolvedValueOnce(
        headPage(
          [{ number: input.pull.number, headRefOid: input.pull.head.sha }],
          "next",
        ),
      )
      .mockResolvedValueOnce(
        headPage([{ number: 43, headRefOid: input.pull.head.sha }]),
      );
    expect((await runReadinessCheck(input))?.state).toBe("failure");
    expect(input.core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining("distinct head commits"),
    );
  });

  it("does not publish stale success when a fallback scan spans a head update", async () => {
    const input = fixture();
    input.paginate.mockResolvedValue([]);
    input.graphql.mockResolvedValue(
      headPage([
        { number: input.pull.number, headRefOid: input.pull.head.sha },
      ]),
    );
    input.get
      .mockResolvedValueOnce({ data: input.pull })
      .mockResolvedValueOnce({
        data: makePull({ head: { sha: "b".repeat(40) } }),
      });
    expect((await runReadinessCheck(input))?.state).toBe("pending");
    expect(input.createCommitStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ sha: "b".repeat(40), state: "pending" }),
    );
  });
});

describe("Live PR-head coverage failures", () => {
  it("leaves readiness pending when live head metadata is unavailable", async () => {
    const input = fixture();
    input.paginate.mockResolvedValue([]);
    input.graphql.mockRejectedValue(new Error("live heads unavailable"));
    await expect(runReadinessCheck(input)).rejects.toThrow(
      "live heads unavailable",
    );
    expect(input.createCommitStatus).toHaveBeenCalledOnce();
    expect(input.createCommitStatus).toHaveBeenCalledWith(
      expect.objectContaining({ state: "pending" }),
    );
  });

  it.each([
    null,
    { repository: null },
    {
      repository: {
        pullRequests: { nodes: null, pageInfo: { hasNextPage: false } },
      },
    },
    headPage([{ number: 42, headRefOid: "unknown" }]),
    headPage([{ number: 43, headRefOid: "A".repeat(40) }]),
  ])(
    "cannot turn incomplete live metadata into success (%#)",
    async (response) => {
      const input = fixture();
      input.paginate.mockResolvedValue([]);
      input.graphql.mockResolvedValue(response);
      await expect(runReadinessCheck(input)).rejects.toThrow(
        /open-PR head metadata/u,
      );
      expect(input.createCommitStatus).toHaveBeenCalledOnce();
    },
  );

  it("rejects non-progressing live pagination without another API request", async () => {
    const input = fixture();
    input.paginate.mockResolvedValue([]);
    input.graphql
      .mockRejectedValue(new Error("unexpected extra page"))
      .mockResolvedValueOnce(headPage([], "repeat"))
      .mockResolvedValueOnce(headPage([], "repeat"));
    await expect(runReadinessCheck(input)).rejects.toThrow(
      "pagination did not advance",
    );
    expect(input.graphql).toHaveBeenCalledTimes(2);
    expect(input.createCommitStatus).toHaveBeenCalledOnce();
  });

  it("rejects overlapping live pages instead of claiming complete coverage", async () => {
    const input = fixture();
    input.paginate.mockResolvedValue([]);
    const node = { number: input.pull.number, headRefOid: input.pull.head.sha };
    input.graphql
      .mockResolvedValueOnce(headPage([node], "next"))
      .mockResolvedValueOnce(headPage([node]));
    await expect(runReadinessCheck(input)).rejects.toThrow(
      "repeated open-PR head metadata",
    );
    expect(input.createCommitStatus).toHaveBeenCalledOnce();
  });
});

const readWorkflow = async () =>
  z
    .object({
      on: z.object({
        pull_request_target: z.object({
          branches: z.array(z.string()),
          types: z.array(z.string()),
        }),
        workflow_dispatch: z.unknown(),
      }),
      permissions: z.record(z.string(), z.string()),
      jobs: z.object({
        readiness: z.object({
          permissions: z.record(z.string(), z.string()),
          steps: z.array(
            z.object({
              uses: z.string(),
              with: z.object({
                ref: z.string().optional(),
                "persist-credentials": z.boolean().optional(),
                script: z.string().optional(),
              }),
            }),
          ),
        }),
      }),
    })
    .parse(
      parse(
        await readFile(
          new URL(
            "../../../.github/workflows/pr-readiness.yml",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );

it("executes the production workflow step with trusted code and status-only write authority", async () => {
  const workflow = await readWorkflow();
  expect(workflow.on.pull_request_target.branches).toEqual([
    "main",
    "release/*",
  ]);
  expect(workflow.on.pull_request_target.types).toEqual(
    expect.arrayContaining([
      "opened",
      "edited",
      "synchronize",
      "reopened",
      "ready_for_review",
      "converted_to_draft",
    ]),
  );
  expect(workflow.permissions).toEqual({});
  expect(workflow.jobs.readiness.permissions).toEqual({
    contents: "read",
    "pull-requests": "read",
    statuses: "write",
  });
  const [checkout, check] = workflow.jobs.readiness.steps;
  expect(checkout?.with).toEqual({
    ref: "${{ github.event.repository.default_branch }}",
    "persist-credentials": false,
  });
  expect(check?.uses).toMatch(/^actions\/github-script@[a-f\d]{40}$/u);
  const input = fixture();
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const code = `
    import { createRequire } from "node:module";
    const require = createRequire(${JSON.stringify(new URL("../../../package.json", import.meta.url).href)});
    const pull = ${JSON.stringify(input.pull)};
    const statuses = [];
    const github = {
      rest: {
        pulls: { get: async () => ({ data: pull }) },
        repos: {
          createCommitStatus: async status => statuses.push(status),
          listPullRequestsAssociatedWithCommit: () => {},
        },
      },
      paginate: async () => [pull],
    };
    const context = ${JSON.stringify(input.context)};
    const core = {
      info: () => {},
      setFailed: message => { throw new Error(message); },
    };
    ${z.string().parse(check?.with.script)}
    console.log(JSON.stringify(statuses));
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      cwd: root,
      env: { ...process.env, GITHUB_WORKSPACE: root },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
  const statuses = z
    .array(z.object({ state: z.string() }))
    .parse(JSON.parse(stdout));
  expect(statuses.at(-1)?.state).toBe("success");
});
