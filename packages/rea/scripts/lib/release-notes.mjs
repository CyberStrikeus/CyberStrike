import { valid } from "semver";
import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const actor = z.object({
  login: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]*(?:\[bot\])?$/u),
  __typename: z.string(),
});
const author = z.object({
  name: z.string(),
  email: z.string(),
  user: actor.nullable(),
});
const commit = z.object({
  sha,
  subject: z.string(),
  body: z.string(),
  parents: z.array(sha),
  authors: z.array(author),
  pullRequests: z.array(z.number().int().positive()),
});
const issue = z.object({
  number: z.number().int().positive(),
  url: z.url(),
  author: actor.nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
});
const pullRequest = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.url(),
  author: actor.nullable(),
  mergeCommit: z.object({ oid: sha }),
  issues: z.array(issue),
});
export {
  author as releaseAuthorSchema,
  issue as releaseIssueSchema,
  pullRequest as releasePullRequestSchema,
};
export const releaseInventorySchema = z.object({
  schemaVersion: z.literal(1),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/u),
  version: z
    .string()
    .refine(
      (value) => valid(value) === value && !value.includes("+"),
      "Expected exact release SemVer",
    ),
  base: sha,
  target: sha,
  commits: z.array(commit),
  pullRequests: z.array(pullRequest),
});

export async function requireCompleteReleaseHistory(run) {
  if (
    (await run("git", ["rev-parse", "--is-shallow-repository"])).trim() !==
    "false"
  )
    throw new Error(
      "Release inventory requires complete Git history; fetch --unshallow first",
    );
}

export async function readReleaseHistory(run, base, target) {
  await requireCompleteReleaseHistory(run);
  const resolve = async (ref) =>
    sha.parse(
      (
        await run("git", [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${ref}^{commit}`,
        ])
      ).trim(),
    );
  const baseSha = await resolve(base);
  const targetSha = await resolve(target);
  await run("git", ["merge-base", "--is-ancestor", baseSha, targetSha]);
  const text = await run("git", [
    "log",
    "--reverse",
    "--topo-order",
    "-z",
    "--format=%H%x00%s%x00%B%x00%P",
    `${baseSha}..${targetSha}`,
  ]);
  const fields = text.split("\0");
  if (fields.pop() !== "" || fields.length % 4)
    throw new Error("Malformed Git release history");
  const commits = [];
  for (let index = 0; index < fields.length; index += 4) {
    commits.push({
      sha: sha.parse(fields[index]),
      subject: fields[index + 1],
      body: fields[index + 2],
      parents: fields[index + 3].split(" ").filter(Boolean),
    });
  }
  return { base: baseSha, target: targetSha, commits };
}

// GitHub maps these coding-agent trailers to ordinary User actors.
// Keep those source identities in the inventory while excluding automation credit.
const AGENT_ACCOUNTS = new Set(["claude", "cursoragent", "codex", "copilot"]);
// REA's maintainer requested external-contributor thanks without self-credit.
const MAINTAINER_ACCOUNTS = new Set(["morluto"]);
const human = (value) =>
  value?.__typename === "User" &&
  !value.login.endsWith("[bot]") &&
  !AGENT_ACCOUNTS.has(value.login.toLowerCase()) &&
  !MAINTAINER_ACCOUNTS.has(value.login.toLowerCase())
    ? value.login
    : undefined;
const unique = (values) =>
  [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );

function prCredits(inventory, pr) {
  return unique([
    human(pr.author),
    ...pr.issues.map((item) => human(item.author)),
    ...inventory.commits
      .filter(
        (item) =>
          item.parents.length === 1 && item.pullRequests.includes(pr.number),
      )
      .flatMap((item) => item.authors.map((identity) => human(identity.user))),
  ]);
}

function thanks(handles) {
  return handles.length
    ? ` Thanks ${handles.map((handle) => `@${handle}`).join(", ")}.`
    : "";
}

export function contributionRecord(raw) {
  const inventory = releaseInventorySchema.parse(raw);
  const lines = [
    "### Complete contribution record",
    "",
    `History: \`${inventory.base}..${inventory.target}\`; ${inventory.pullRequests.length} merged PRs, ${inventory.commits.length} commits examined.`,
    "",
  ];
  for (const pr of inventory.pullRequests) {
    const issues = pr.issues
      .map(
        (item) =>
          `[${item.repository.nameWithOwner}#${item.number}](${item.url})`,
      )
      .join(", ");
    lines.push(
      `- **PR [#${pr.number}](${pr.url})**${issues ? ` Related ${issues}.` : ""}${thanks(prCredits(inventory, pr))}`,
    );
  }
  const direct = inventory.commits.filter(
    (item) => item.pullRequests.length === 0 && item.parents.length <= 1,
  );
  if (direct.length) {
    lines.push("", "#### Direct contributions", "");
    for (const item of direct)
      lines.push(
        `- [${item.sha.slice(0, 7)}](https://github.com/${inventory.repository}/commit/${item.sha})${thanks(unique(item.authors.map((identity) => human(identity.user))))}`,
      );
  }
  return `${lines.join("\n")}\n`;
}

/** Keep the full authorship snapshot available without duplicating public thanks. */
export function contributionSummary(raw) {
  const inventory = releaseInventorySchema.parse(raw);
  return `Full contribution record: [${inventory.commits.length} commits and ${inventory.pullRequests.length} merged PR${inventory.pullRequests.length === 1 ? "" : "s"}](https://github.com/${inventory.repository}/blob/rea-agents-${inventory.version}/docs/releases/${inventory.version}.contributions.json).\n`;
}

export function selectedReleaseNotes(text, version) {
  const headings = [...text.matchAll(/^## \[([^\]]+)\].*$/gmu)];
  if (headings[0]?.[1] !== version)
    throw new Error(`Notes must start with release [${version}]`);
  return text
    .slice(headings[0].index, headings[1]?.index ?? text.length)
    .trim();
}

// Notes have one Markdown list item per line; fenced examples are never credit sources.
function proseBullets(text) {
  let fence;
  return text.split("\n").filter((line) => {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      return false;
    }
    return !fence && /^[-*] /u.test(line);
  });
}

function bulletPrs(bullet, repository) {
  // Resolve explicit links first so cross-repository numbers cannot acquire local credit.
  const local = [];
  const withoutLinks = bullet.replace(
    /\[([^\]]*)\]\(https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)\)/gu,
    (_match, _label, repo, number) => {
      if (repo.toLowerCase() === repository.toLowerCase())
        local.push(Number(number));
      return "";
    },
  );
  for (const match of withoutLinks.matchAll(/(?<![\w/])#(\d+)\b/gu))
    local.push(Number(match[1]));
  return new Set(local);
}

function requiredCredits(inventory, bullet, references) {
  const required = [];
  for (const pr of inventory.pullRequests.filter((item) =>
    references.has(item.number),
  )) {
    for (const handle of prCredits(inventory, pr))
      required.push({ handle, context: `PR #${pr.number}` });
  }
  for (const issue of inventory.pullRequests.flatMap((item) => item.issues)) {
    const mentioned =
      (issue.repository.nameWithOwner.toLowerCase() ===
        inventory.repository.toLowerCase() &&
        references.has(issue.number)) ||
      bullet.includes(`](${issue.url})`);
    const handle = human(issue.author);
    if (mentioned && handle)
      required.push({
        handle,
        context: `issue ${issue.repository.nameWithOwner}#${issue.number}`,
      });
  }
  for (const match of bullet.matchAll(
    /https:\/\/github\.com\/([^/]+\/[^/]+)\/commit\/([a-f0-9]{7,40})\b/gu,
  )) {
    if (match[1].toLowerCase() !== inventory.repository.toLowerCase()) continue;
    const matches = inventory.commits.filter((item) =>
      item.sha.startsWith(match[2]),
    );
    if (matches.length !== 1)
      throw new Error(`Unknown or ambiguous release commit ${match[2]}`);
    if (matches[0].parents.length > 1) continue;
    for (const identity of matches[0].authors) {
      const handle = human(identity.user);
      if (handle)
        required.push({ handle, context: `commit ${matches[0].sha}` });
    }
  }
  return required;
}

function verifyEditorialCredits(inventory, prose) {
  const known = new Set(inventory.pullRequests.map((pr) => pr.number));
  const issues = new Set(
    inventory.pullRequests.flatMap((pr) =>
      pr.issues
        .filter(
          (item) =>
            item.repository.nameWithOwner.toLowerCase() ===
            inventory.repository.toLowerCase(),
        )
        .map((item) => item.number),
    ),
  );
  const eligible = new Set(
    unique([
      ...inventory.pullRequests.flatMap((pr) => prCredits(inventory, pr)),
      ...inventory.commits.flatMap((item) =>
        item.authors.map((identity) => human(identity.user)),
      ),
    ]).map((handle) => handle.toLowerCase()),
  );
  const errors = [];
  const requiredByContext = new Map();
  const thankedByContext = new Map();
  for (const bullet of proseBullets(prose)) {
    const references = bulletPrs(bullet, inventory.repository);
    const start = bullet.indexOf("Thanks ");
    const thanked = new Set(
      [
        ...bullet
          .slice(start < 0 ? bullet.length : start)
          .matchAll(/@([A-Za-z0-9-]+(?:\[bot\])?)/gu),
      ].map((match) => match[1].toLowerCase()),
    );
    for (const number of references)
      if (!known.has(number) && !issues.has(number))
        errors.push(`Unknown release reference #${number}`);
    for (const { handle, context } of requiredCredits(
      inventory,
      bullet,
      references,
    )) {
      const required = requiredByContext.get(context) ?? new Set();
      required.add(handle);
      requiredByContext.set(context, required);
      const credited = thankedByContext.get(context) ?? new Set();
      for (const login of thanked) credited.add(login);
      thankedByContext.set(context, credited);
    }
    for (const handle of thanked)
      if (!eligible.has(handle))
        errors.push(`Unverified human credit @${handle}`);
  }
  for (const [context, required] of requiredByContext)
    for (const handle of required)
      if (!thankedByContext.get(context)?.has(handle.toLowerCase()))
        errors.push(`Missing Thanks @${handle} for ${context}`);
  return errors;
}

export function verifyReleaseNotes(raw, text, body) {
  const inventory = releaseInventorySchema.parse(raw);
  const notes = selectedReleaseNotes(text, inventory.version);
  // Release Please's inline issue/PR body limit (pull-request-overflow-handler).
  if (notes.length > 65_536 || (body !== undefined && body.length > 65_536))
    throw new Error(
      "Release notes exceed GitHub's inline PR body limit; overflow-link bodies are not supported by this checker",
    );
  if (notes.length > 125_000 || Buffer.byteLength(notes) > 125_000)
    throw new Error(
      "Release notes exceed GitHub's body budget; shorten prose without dropping credit",
    );
  const record = contributionRecord(inventory).trim();
  const summary = contributionSummary(inventory).trim();
  const start = notes.endsWith(summary)
    ? notes.length - summary.length
    : notes.indexOf("### Complete contribution record");
  if (
    start < 0 ||
    (notes.slice(start).trim() !== record &&
      notes.slice(start).trim() !== summary)
  )
    throw new Error(
      "Contribution record differs from inventory; regenerate it with release-notes record",
    );
  const prose = notes.slice(0, start);
  const errors = verifyEditorialCredits(inventory, prose);
  for (const heading of ["Highlights", "Changes", "Fixes"])
    if (!prose.includes(`### ${heading}\n`))
      errors.push(`Missing ${heading} section`);
  if (body !== undefined) {
    const bodyNotes = selectedReleaseNotes(body, inventory.version)
      .replace(
        /\n---\nThis PR was generated with \[Release Please\][\s\S]*$/u,
        "",
      )
      .trim();
    if (bodyNotes !== notes)
      errors.push("Release PR body differs from CHANGELOG.md");
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return {
    version: inventory.version,
    pullRequests: inventory.pullRequests.length,
    commits: inventory.commits.length,
    unresolvedAuthors: inventory.commits.flatMap((item) =>
      item.authors
        .filter((identity) => identity.user === null)
        .map((identity) => ({ sha: item.sha, ...identity })),
    ),
  };
}

const VERSION_ONLY_PLUGIN_METADATA = new Set([
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".codex-plugin/mcp.json",
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
]);

/** Serialize plugin metadata with only its release-owned version fields blanked. */
function pluginMetadataWithoutVersions(path, text) {
  const manifest = JSON.parse(text);
  if (manifest === null || typeof manifest !== "object") return text;
  if (path.endsWith("marketplace.json")) {
    if (Array.isArray(manifest.plugins))
      for (const plugin of manifest.plugins)
        if (
          plugin?.name === "rea" &&
          plugin?.source?.source === "npm" &&
          plugin.source.package === "rea-agents" &&
          typeof plugin.source.version === "string"
        )
          plugin.source.version = "";
    return JSON.stringify(manifest);
  }
  if ("version" in manifest) manifest.version = "";
  const launch = manifest.mcpServers?.rea?.args;
  // Only the scalar pinned version is release-owned; the launcher owns the
  // fixed package name and the executable/path remain product behavior.
  if (Array.isArray(launch) && typeof launch[1] === "string") launch[1] = "";
  return JSON.stringify(manifest);
}

/**
 * Plugin metadata also carries behavior, so a release may change only
 * its version, pinned server launch, and exact REA marketplace version. Any other difference, an unreadable
 * side, or a manifest added by the release counts as a product change.
 */
async function changesOnlyPluginVersions(run, path, from, to) {
  try {
    return (
      pluginMetadataWithoutVersions(
        path,
        await run("git", ["show", `${from}:${path}`]),
      ) ===
      pluginMetadataWithoutVersions(
        path,
        await run("git", ["show", `${to}:${path}`]),
      )
    );
  } catch {
    return false;
  }
}

/** Reject stale inventories and product changes made after the editorial target. */
export async function verifyInventoryHistory(run, raw, source) {
  const inventory = releaseInventorySchema.parse(raw);
  const history = await readReleaseHistory(
    run,
    inventory.base,
    inventory.target,
  );
  const original = inventory.commits.map(
    ({ authors: _authors, pullRequests: _prs, ...item }) => item,
  );
  if (JSON.stringify(history.commits) !== JSON.stringify(original))
    throw new Error("Inventory does not match complete local Git history");
  const shas = new Set(history.commits.map((item) => item.sha));
  const numbers = new Set();
  for (const pr of inventory.pullRequests) {
    if (numbers.has(pr.number) || !shas.has(pr.mergeCommit.oid))
      throw new Error(`Duplicate or out-of-range PR #${pr.number}`);
    numbers.add(pr.number);
  }
  for (const item of inventory.commits)
    for (const number of item.pullRequests)
      if (!numbers.has(number))
        throw new Error(`Commit refers to missing PR #${number}`);
  if (source !== undefined) {
    const resolved = sha.parse(
      (
        await run("git", [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${source}^{commit}`,
        ])
      ).trim(),
    );
    const parent = (await run("git", ["rev-parse", `${resolved}^1`])).trim();
    if (parent !== inventory.target)
      throw new Error(
        "Release base moved after notes target; regenerate inventory for the reviewed merge's first parent",
      );
    await run("git", [
      "merge-base",
      "--is-ancestor",
      inventory.target,
      resolved,
    ]);
    const allowed = new Set([
      "CHANGELOG.md",
      ".release-please-manifest.json",
      "package.json",
      "package-lock.json",
      "server.json",
      "src/generatedPackageMetadata.ts",
      "docs/installation.md",
      `docs/releases/${inventory.version}.contributions.json`,
    ]);
    const paths = (
      await run("git", [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        inventory.target,
        resolved,
      ])
    )
      .split("\0")
      .filter(Boolean);
    const product = [];
    for (const path of paths) {
      if (allowed.has(path)) continue;
      if (
        VERSION_ONLY_PLUGIN_METADATA.has(path) &&
        (await changesOnlyPluginVersions(run, path, inventory.target, resolved))
      )
        continue;
      product.push(path);
    }
    if (product.length)
      throw new Error(
        `Product changed after notes target; regenerate inventory: ${product.join(", ")}`,
      );
  }
}
