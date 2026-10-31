import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_PAGES = 10;
const PAGE_SIZE = 100;

// Keep the newest snapshots, not only the key just saved. A concurrent job may
// still be restoring the previous generation; deleting that id fails its restore.
// The following trusted run drops anything older than those two.
const RETAINED_CACHE_GENERATIONS = 2;

const PREFIX_PATTERNS = [
  /^rea-static-v1-[A-Za-z0-9]+-[A-Za-z0-9]+-$/u,
  /^rea-static-deep-v1-[A-Za-z0-9]+-[A-Za-z0-9]+-$/u,
  /^rea-portable-build-v2-[A-Za-z0-9]+-[A-Za-z0-9]+-$/u,
  /^knip-meta-v1-[A-Za-z0-9]+-$/u,
];

/** Reject prefixes that could match npm downloads or another platform. */
export function assertRetentionPrefix(prefix) {
  if (
    typeof prefix !== "string" ||
    !PREFIX_PATTERNS.some((pattern) => pattern.test(prefix))
  )
    throw new Error(
      "Cache retention prefix must be one Turbo family for one OS and architecture, or one Knip metadata family for one OS",
    );
}

function normalizeCache(cache, index) {
  if (typeof cache !== "object" || cache === null || Array.isArray(cache))
    throw new Error(`Cache entry ${String(index + 1)} is malformed`);
  const { id, key, size_in_bytes: size } = cache;
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error(`Cache entry ${String(index + 1)} has an invalid id`);
  if (typeof key !== "string" || key.length === 0 || /[\r\n]/u.test(key))
    throw new Error(`Cache entry ${String(index + 1)} has an invalid key`);
  const createdAt = Date.parse(cache.created_at);
  const accessedAt = Date.parse(cache.last_accessed_at ?? cache.created_at);
  if (!Number.isFinite(createdAt) || !Number.isFinite(accessedAt))
    throw new Error(
      `Cache entry ${String(index + 1)} has an invalid timestamp`,
    );
  if (!Number.isSafeInteger(size) || size < 0)
    throw new Error(`Cache entry ${String(index + 1)} has an invalid size`);
  // actions/cache restores a key only when this metadata hash matches.
  const version = cache.version;
  if (typeof version !== "string" || !/^[a-f0-9]{64}$/u.test(version))
    throw new Error(`Cache entry ${String(index + 1)} has an invalid version`);
  // The git ref is the cache's access scope. Another branch cannot use it.
  const ref = cache.ref;
  if (typeof ref !== "string" || !/^refs\/[^\s]+$/u.test(ref))
    throw new Error(`Cache entry ${String(index + 1)} has an invalid ref`);
  return { id, key, version, ref, createdAt, accessedAt, size };
}

function sameStableIdentity(left, right) {
  return (
    left.key === right.key &&
    left.version === right.version &&
    left.ref === right.ref &&
    left.size === right.size &&
    left.createdAt === right.createdAt
  );
}

// The list API orders by last access. A restore between pages can place one
// id on two pages. That is still one cache: collapse it, or abort when the
// pages disagree, before any id can be both kept and deleted.
function uniqueById(entries) {
  const byId = new Map();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (existing === undefined) {
      byId.set(entry.id, entry);
      continue;
    }
    if (!sameStableIdentity(existing, entry))
      throw new Error(
        `Cache id ${String(entry.id)} was listed with inconsistent fields`,
      );
    if (entry.accessedAt > existing.accessedAt) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

function byNewest(left, right) {
  if (left.createdAt !== right.createdAt)
    return right.createdAt - left.createdAt;
  return right.id - left.id;
}

/**
 * Choose Turbo snapshot ids to delete. `keepKey` is protected even when it is
 * older than the retained generations. Keys outside the prefix abort retention.
 */
export function selectPrefixDeletions(
  caches,
  { prefix, keepKey } = {},
  keepGenerations = RETAINED_CACHE_GENERATIONS,
) {
  assertRetentionPrefix(prefix);
  if (!Number.isSafeInteger(keepGenerations) || keepGenerations < 1)
    throw new Error("Cache retention must keep at least one generation");
  if (keepKey !== undefined) {
    if (
      typeof keepKey !== "string" ||
      !keepKey.startsWith(prefix) ||
      keepKey === prefix
    )
      throw new Error("Cache retention keep key must extend its prefix");
  }
  const entries = uniqueById(caches.map(normalizeCache));
  for (const entry of entries)
    if (!entry.key.startsWith(prefix))
      throw new Error(
        `Refusing to evaluate a cache outside ${prefix}: ${entry.key}`,
      );
  const protectedIds = new Set(
    [...entries]
      .sort(byNewest)
      .slice(0, keepGenerations)
      .map((entry) => entry.id),
  );
  if (keepKey !== undefined)
    for (const entry of entries)
      if (entry.key === keepKey) protectedIds.add(entry.id);
  return entries.filter((entry) => !protectedIds.has(entry.id));
}

/**
 * Drop extra copies of one npm restore target. Records that share a user key
 * but differ by cache version or git ref stay, because a workflow can restore
 * only a matching version inside its visible scope.
 */
export function selectNpmDownloadDuplicateDeletions(caches) {
  const entries = uniqueById(caches.map(normalizeCache));
  for (const entry of entries)
    if (!entry.key.startsWith("npm-download-"))
      throw new Error(
        `Refusing to evaluate a non-download cache: ${entry.key}`,
      );
  const groups = new Map();
  for (const entry of entries) {
    const identity = `${entry.version}\n${entry.ref}\n${entry.key}`;
    const group = groups.get(identity) ?? [];
    group.push(entry);
    groups.set(identity, group);
  }
  const deletions = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ranked = [...group].sort((left, right) => {
      if (left.accessedAt !== right.accessedAt)
        return right.accessedAt - left.accessedAt;
      if (left.createdAt !== right.createdAt)
        return right.createdAt - left.createdAt;
      return right.id - left.id;
    });
    deletions.push(...ranked.slice(1));
  }
  return deletions;
}

export async function listAllCaches(request, repository, prefix) {
  const caches = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await request(
      "GET",
      `repos/${repository}/actions/caches?per_page=${String(PAGE_SIZE)}&page=${String(page)}&key=${encodeURIComponent(prefix)}`,
    );
    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      !Array.isArray(body.actions_caches)
    )
      throw new Error("GitHub cache list is malformed");
    caches.push(...body.actions_caches);
    if (body.actions_caches.length < PAGE_SIZE) return caches;
  }
  throw new Error(
    `Cache list for ${prefix} exceeded ${String(MAX_PAGES)} pages; deleted nothing`,
  );
}

/**
 * List every requested family before deleting. A malformed list or an unsafe
 * prefix leaves the repository caches unchanged.
 */
export async function retainCaches({
  repository,
  request,
  deleteCache,
  families = [],
  dedupeNpmDownloads = false,
  dryRun = false,
}) {
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
  )
    throw new Error(
      "CI_REPOSITORY must be an owner/name repository identifier",
    );
  for (const family of families) {
    assertRetentionPrefix(family.prefix);
    if (
      family.keepKey !== undefined &&
      (typeof family.keepKey !== "string" ||
        !family.keepKey.startsWith(family.prefix) ||
        family.keepKey === family.prefix)
    )
      throw new Error("Cache retention keep key must extend its prefix");
  }
  const plan = [];
  for (const family of families) {
    const caches = await listAllCaches(request, repository, family.prefix);
    plan.push({
      prefix: family.prefix,
      deletions: selectPrefixDeletions(caches, family),
    });
  }
  const npmDeletions = dedupeNpmDownloads
    ? selectNpmDownloadDuplicateDeletions(
        await listAllCaches(request, repository, "npm-download-"),
      )
    : [];
  if (!dryRun)
    for (const entry of [
      ...plan.flatMap((family) => family.deletions),
      ...npmDeletions,
    ])
      await deleteCache(entry.id);
  return { dryRun, plan, npmDeletions };
}

function repositoryFromEnv(env) {
  const repository = env.CI_REPOSITORY;
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
  )
    throw new Error(
      "CI_REPOSITORY must be an owner/name repository identifier",
    );
  return repository;
}

function familyWithKeepKey(env, prefixName, keepName) {
  const prefix = env[prefixName];
  const keepKey = env[keepName];
  const hasPrefix = typeof prefix === "string" && prefix.length > 0;
  const hasKeepKey = typeof keepKey === "string" && keepKey.length > 0;
  if (!hasPrefix && !hasKeepKey) return undefined;
  if (!hasPrefix || !hasKeepKey)
    throw new Error(`${keepName} is required with ${prefixName}`);
  return { prefix, keepKey };
}

function familiesFromEnv(env) {
  const families = [
    familyWithKeepKey(env, "CACHE_PREFIX", "CACHE_KEEP_KEY"),
    familyWithKeepKey(env, "CACHE_DEEP_PREFIX", "CACHE_DEEP_KEEP_KEY"),
    familyWithKeepKey(env, "CACHE_KNIP_PREFIX", "CACHE_KNIP_KEEP_KEY"),
    typeof env.CACHE_PORTABLE_PREFIX === "string" &&
    env.CACHE_PORTABLE_PREFIX.length > 0
      ? { prefix: env.CACHE_PORTABLE_PREFIX }
      : undefined,
  ].filter((family) => family !== undefined);
  if (families.length === 0 && env.DEDUPE_NPM_DOWNLOADS !== "true")
    throw new Error(
      "Cache retention requires CACHE_PREFIX or CACHE_PORTABLE_PREFIX or npm dedupe",
    );
  return families;
}

function failureText(error) {
  if (typeof error !== "object" || error === null) return String(error);
  const stderr =
    "stderr" in error && error.stderr !== undefined ? String(error.stderr) : "";
  const message = error instanceof Error ? error.message : "";
  return `${message}\n${stderr}`;
}

async function githubRequest(method, endpoint, env) {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--method", method, endpoint],
    {
      env,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      timeout: REQUEST_TIMEOUT_MS,
    },
  );
  if (method === "DELETE") return undefined;
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new Error("GitHub cache API returned malformed JSON", { cause });
  }
}

async function main() {
  const env = process.env;
  const dryRun = env.CACHE_RETENTION_DRY_RUN === "true";
  const report = await retainCaches({
    repository: repositoryFromEnv(env),
    request: (method, endpoint) => githubRequest(method, endpoint, env),
    deleteCache: async (id) => {
      try {
        await githubRequest(
          "DELETE",
          `repos/${repositoryFromEnv(env)}/actions/caches/${String(id)}`,
          env,
        );
      } catch (error) {
        if (/404|not found/iu.test(failureText(error))) return;
        throw error;
      }
    },
    families: familiesFromEnv(env),
    dedupeNpmDownloads: env.DEDUPE_NPM_DOWNLOADS === "true",
    dryRun,
  });
  const summary = {
    dryRun: report.dryRun,
    families: report.plan.map((family) => ({
      prefix: family.prefix,
      deleteCount: family.deletions.length,
      deleteBytes: family.deletions.reduce((sum, entry) => sum + entry.size, 0),
    })),
    npmDuplicateDeleteCount: report.npmDeletions.length,
    npmDuplicateDeleteBytes: report.npmDeletions.reduce(
      (sum, entry) => sum + entry.size,
      0,
    ),
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) await main();
