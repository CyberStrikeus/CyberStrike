import { readFile } from "node:fs/promises";

const result = (state, description) => ({ state, description });

const OPEN_HEADS_QUERY = `query ReadinessOpenHeads($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 100, after: $after, states: OPEN, orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes { number headRefOid }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

/** An unindexed commit needs complete live head coverage, not PR bodies. */
async function openHeadsMatching(github, repository, sha) {
  const matches = [];
  const numbers = new Set();
  const cursors = new Set();
  let after = null;
  do {
    const response = await github.graphql(OPEN_HEADS_QUERY, {
      owner: repository.owner,
      name: repository.repo,
      after,
    });
    const page = response?.repository?.pullRequests;
    if (
      !Array.isArray(page?.nodes) ||
      typeof page.pageInfo?.hasNextPage !== "boolean"
    )
      throw new Error("GitHub returned incomplete open-PR head metadata.");
    for (const node of page.nodes) {
      if (
        !Number.isSafeInteger(node?.number) ||
        node.number <= 0 ||
        typeof node.headRefOid !== "string" ||
        !/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(node.headRefOid) ||
        numbers.has(node.number)
      )
        throw new Error(
          "GitHub returned invalid or repeated open-PR head metadata.",
        );
      numbers.add(node.number);
      if (node.headRefOid === sha)
        matches.push({ number: node.number, state: "open", head: { sha } });
    }
    if (!page.pageInfo.hasNextPage) return matches;
    const next = page.pageInfo.endCursor;
    if (typeof next !== "string" || next.length === 0 || cursors.has(next))
      throw new Error("GitHub open-PR head pagination did not advance.");
    cursors.add(next);
    after = next;
  } while (true);
}

function readinessLines(markdown) {
  const lines = markdown.split(/\r?\n/u);
  const visible = [];
  let fence;
  let comment = false;
  for (const source of lines) {
    if (fence) {
      if (
        new RegExp(
          `^ {0,3}${fence.character}{${fence.length},}\\s*$`,
          "u",
        ).test(source)
      )
        fence = undefined;
      continue;
    }
    const opening = !comment && /^ {0,3}(`{3,}|~{3,})/u.exec(source);
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }
    let line = "";
    let offset = 0;
    while (offset < source.length) {
      const marker = comment ? "-->" : "<!--";
      const index = source.indexOf(marker, offset);
      if (!comment)
        line += source.slice(offset, index === -1 ? source.length : index);
      if (index === -1) break;
      offset = index + marker.length;
      comment = !comment;
    }
    visible.push(line);
  }
  const starts = visible.flatMap((line, index) =>
    /^## Author readiness\s*$/u.test(line) ? [index] : [],
  );
  if (starts.length !== 1) return [];
  const remaining = visible.slice(starts[0] + 1);
  const end = remaining.findIndex((line) => /^#{1,2}\s/u.test(line));
  return (end === -1 ? remaining : remaining.slice(0, end)).map((line) =>
    line.trimEnd(),
  );
}

/** Check the initial declaration against the trusted repository template. */
export function evaluateReadiness(pull, template) {
  if (pull.draft)
    return result(
      "pending",
      "Draft PR: complete Author readiness before requesting review.",
    );
  const expected = readinessLines(template).flatMap((line) => {
    const match = /^- \[ \] (.+)$/u.exec(line);
    return match ? [match[1]] : [];
  });
  if (expected.length !== 3)
    throw new Error(
      "Trusted PR template must contain three readiness declarations.",
    );
  const lines = readinessLines(pull.body ?? "");
  const owners = lines.filter((line) => line.startsWith("Human owner:"));
  if (
    owners.length !== 1 ||
    !/^Human owner: @[a-z\d](?:[a-z\d-]*[a-z\d])?$/iu.test(owners[0])
  )
    return result(
      "failure",
      "Fill Human owner with one @GitHub-handle in the Author readiness section.",
    );
  const declarations = lines.flatMap((line) => {
    const match = /^- \[([ xX])\] (.+)$/u.exec(line);
    return match
      ? [{ checked: match[1].toLowerCase() === "x", text: match[2] }]
      : [];
  });
  if (
    expected.some((text) => {
      const matches = declarations.filter((item) => item.text === text);
      return matches.length !== 1 || !matches[0].checked;
    })
  )
    return result(
      "failure",
      "Complete all three Author readiness declarations from the current PR template.",
    );
  return result(
    "success",
    "Human owner and all three initial readiness declarations are filled.",
  );
}

/** Publish readiness on the PR head without running contributor code. */
export async function runReadinessCheck({ github, context, core }) {
  const number =
    context.payload.pull_request?.number ??
    Number(context.payload.inputs?.pull_request_number);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error("A positive pull request number is required.");
  const repository = context.repo;
  const getPull = async () =>
    (await github.rest.pulls.get({ ...repository, pull_number: number })).data;
  const pull = await getPull();
  if (pull.state !== "open" || !/^(?:main|release\/.+)$/u.test(pull.base.ref))
    return;
  const publish = (sha, verdict) =>
    github.rest.repos.createCommitStatus({
      ...repository,
      sha,
      context: "PR readiness",
      ...verdict,
      target_url: `${context.serverUrl}/${repository.owner}/${repository.repo}/actions/runs/${context.runId}`,
    });
  await publish(
    pull.head.sha,
    result("pending", "Checking the initial author readiness declaration."),
  );
  const template = await readFile(
    new URL("../../.github/pull_request_template.md", import.meta.url),
    "utf8",
  );
  let verdict = evaluateReadiness(pull, template);
  if (verdict.state === "success") {
    let associated = await github.paginate(
      github.rest.repos.listPullRequestsAssociatedWithCommit,
      { ...repository, commit_sha: pull.head.sha, per_page: 100 },
    );
    const ownsHead = (other) =>
      other.number === number &&
      other.state === "open" &&
      other.head.sha === pull.head.sha;
    if (!associated.some(ownsHead))
      associated = await openHeadsMatching(github, repository, pull.head.sha);
    if (!associated.some(ownsHead))
      verdict = result(
        "pending",
        "GitHub has not confirmed this PR's head association; rerun PR readiness.",
      );
    else if (
      associated.some(
        (other) =>
          other.state === "open" &&
          other.number !== number &&
          other.head.sha === pull.head.sha,
      )
    )
      verdict = result(
        "failure",
        "Open PRs must have distinct head commits because GitHub shares commit statuses.",
      );
  }
  const latest = await getPull();
  if (latest.state !== "open") return;
  if (
    latest.head.sha !== pull.head.sha ||
    latest.body !== pull.body ||
    latest.draft !== pull.draft ||
    latest.base.ref !== pull.base.ref
  )
    verdict = result(
      "pending",
      "PR changed during the check; wait for the latest run or rerun PR readiness.",
    );
  await publish(latest.head.sha, verdict);
  core.info(verdict.description);
  if (verdict.state === "failure") core.setFailed(verdict.description);
  return verdict;
}
