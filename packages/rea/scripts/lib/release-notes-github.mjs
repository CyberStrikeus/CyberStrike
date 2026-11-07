import { z } from "zod";
import {
  releaseAuthorSchema as author,
  releaseIssueSchema as issue,
  releasePullRequestSchema,
} from "./release-notes.mjs";

const pageInfo = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});
const connection = (node) => z.object({ nodes: z.array(node), pageInfo });
const associated = z.object({
  number: z.number().int().positive(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
});
const pr = releasePullRequestSchema.omit({ issues: true }).extend({
  closingIssuesReferences: connection(issue),
});
const PAGE = "pageInfo { hasNextPage endCursor }";
const ACTOR = "login __typename";
const AUTHORS = `authors(first:100, after:$cursor) { nodes { name email user { ${ACTOR} } } ${PAGE} }`;
const ASSOCIATED = `associatedPullRequests(first:100, after:$cursor) { nodes { number mergeCommit { oid } } ${PAGE} }`;
const ISSUES = `closingIssuesReferences(first:100, after:$cursor) { nodes { number url author { ${ACTOR} } repository { nameWithOwner } } ${PAGE} }`;

async function query(run, repository, selection, cursor = null) {
  const [owner, name] = repository.split("/");
  const response = JSON.parse(
    await run(
      "gh",
      ["api", "graphql", "--input", "-"],
      JSON.stringify({
        query: `query($owner:String!,$name:String!,$cursor:String) { repository(owner:$owner,name:$name) { ${selection} } }`,
        variables: { owner, name, cursor },
      }),
    ),
  );
  if (response.errors?.length)
    throw new Error(
      `GitHub inventory query failed: ${JSON.stringify(response.errors)}`,
    );
  if (!response.data?.repository)
    throw new Error(`GitHub repository unavailable: ${repository}`);
  return response.data.repository;
}

async function remainingPages(run, repository, selection, field) {
  const initial = field.initial;
  const nodes = [...initial.nodes];
  let page = initial;
  const cursors = new Set();
  while (page.pageInfo.hasNextPage) {
    const cursor = page.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor))
      throw new Error(`GitHub returned a non-advancing ${field.name} cursor`);
    cursors.add(cursor);
    const response = await query(run, repository, selection, cursor);
    page = field.schema.parse(response.item?.[field.name]);
    nodes.push(...page.nodes);
  }
  return nodes;
}

/** GitHub's commit authors include co-authors; unresolved identities remain explicit. */
export async function collectGitHubCredits(run, repository, commits) {
  const shipped = new Set(commits.map((commit) => commit.sha));
  const numbers = new Set();
  const result = [];
  // Small query batches limit transient GraphQL work, never the history examined.
  for (let offset = 0; offset < commits.length; offset += 20) {
    const batch = commits.slice(offset, offset + 20);
    const selection = batch
      .map(
        (commit, index) =>
          `c${index}: object(oid:${JSON.stringify(commit.sha)}) { ... on Commit { oid ${AUTHORS} ${ASSOCIATED} } }`,
      )
      .join("\n");
    const response = await query(run, repository, selection);
    for (const [index, commit] of batch.entries()) {
      const value = z
        .object({
          oid: z.literal(commit.sha),
          authors: connection(author),
          associatedPullRequests: connection(associated),
        })
        .parse(response[`c${index}`]);
      const select = (fields) =>
        `item: object(oid:${JSON.stringify(commit.sha)}) { ... on Commit { ${fields} } }`;
      const authors = await remainingPages(run, repository, select(AUTHORS), {
        name: "authors",
        schema: connection(author),
        initial: value.authors,
      });
      const associations = await remainingPages(
        run,
        repository,
        select(ASSOCIATED),
        {
          name: "associatedPullRequests",
          schema: connection(associated),
          initial: value.associatedPullRequests,
        },
      );
      const pullRequests = [
        ...new Set(
          associations
            .filter((item) => shipped.has(item.mergeCommit?.oid))
            .map((item) => item.number),
        ),
      ];
      for (const number of pullRequests) numbers.add(number);
      result.push({ ...commit, authors, pullRequests });
    }
  }
  const pullRequests = [];
  const sorted = [...numbers].sort((a, b) => a - b);
  for (let offset = 0; offset < sorted.length; offset += 20) {
    const batch = sorted.slice(offset, offset + 20);
    const fields = `number title url author { ${ACTOR} } mergeCommit { oid } ${ISSUES}`;
    const response = await query(
      run,
      repository,
      batch
        .map(
          (number, index) =>
            `p${index}: pullRequest(number:${number}) { ${fields} }`,
        )
        .join("\n"),
    );
    for (const [index, number] of batch.entries()) {
      const value = pr.parse(response[`p${index}`]);
      if (value.number !== number || !shipped.has(value.mergeCommit.oid))
        throw new Error(`PR #${number} changed outside the selected history`);
      const issues = await remainingPages(
        run,
        repository,
        `item: pullRequest(number:${number}) { ${ISSUES} }`,
        {
          name: "closingIssuesReferences",
          schema: connection(issue),
          initial: value.closingIssuesReferences,
        },
      );
      const { closingIssuesReferences: _connection, ...metadata } = value;
      pullRequests.push({ ...metadata, issues });
    }
  }
  return { commits: result, pullRequests };
}
