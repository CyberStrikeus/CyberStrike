import { $ } from "bun"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerResponse } from "effect/http"
import { Api } from "@cyberstrike-io/api-v2"
import { Directory } from "@cyberstrike-io/api-v2/middleware/location"
import { ConflictError, InvalidRequestError, ServiceUnavailableError } from "@opencode/protocol/errors"
import { Vcs } from "../../project/vcs"
import { Instance } from "../../project/instance"
import { inInstance } from "../instance"

// Git's empty tree, the base of a working-copy diff in a repository that has no commits yet.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbe8"

const git = async (directory: string, args: string[]) => {
  const out = await $`git -c core.quotepath=false ${args}`.cwd(directory).quiet().nothrow()
  return { ok: out.exitCode === 0, text: out.text() }
}

// Read from git on every call. The cached Vcs state can hold "HEAD" from before the first commit.
const currentBranch = async (directory: string) => {
  const out = await git(directory, ["symbolic-ref", "--quiet", "--short", "HEAD"])
  return out.ok ? out.text.trim() : undefined
}

const hasHead = async (directory: string) => (await git(directory, ["rev-parse", "--verify", "--quiet", "HEAD"])).ok

// The default branch as the remote advertises it. Absent when there is no origin or its HEAD is unset.
const defaultBranch = async (directory: string) => {
  const out = await git(directory, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
  if (!out.ok) return undefined
  return out.text.trim().replace(/^origin\//, "") || undefined
}

// The branch a local branch was created from, read from its reflog ("branch: Created from <name>").
const createdFrom = async (directory: string, branch: string) => {
  const out = await git(directory, ["reflog", "show", "--format=%gs", `refs/heads/${branch}`])
  if (!out.ok) return undefined
  const names = out.text.split("\n").flatMap((line) => {
    const match = line.match(/^branch: Created from (.+)$/)
    return match && match[1] !== "HEAD" ? [match[1].replace(/^refs\/heads\//, "")] : []
  })
  // Reflog lists newest first, so the creation entry is the last match.
  return names.at(-1)
}

// The review base: the default branch when it is checked out, otherwise the branch this one was created from.
const reviewBase = async (directory: string, current: string | undefined) => {
  if (!(await hasHead(directory))) return null
  const fallback = await defaultBranch(directory)
  if (current && fallback && current === fallback) return { name: fallback, ref: fallback, source: "default" as const }
  if (!current) return null
  const created = await createdFrom(directory, current)
  if (created) return { name: created, ref: created, source: "reflog" as const }
  return null
}

// Splits `git diff -p` output into one entry per file.
const parseDiff = (text: string) =>
  text.split(/^(?=diff --git )/m).flatMap((patch) => {
    const file = patch.match(/^\+\+\+ b\/(.+)$/m)?.[1] ?? patch.match(/^--- a\/(.+)$/m)?.[1]
    if (!file) return []
    const hunks = patch.search(/^@@/m)
    const body = hunks < 0 ? [] : patch.slice(hunks).split("\n")
    const status = /^new file mode/m.test(patch) ? "added" : /^deleted file mode/m.test(patch) ? "deleted" : "modified"
    return [
      {
        file,
        patch,
        additions: body.filter((line) => line.startsWith("+")).length,
        deletions: body.filter((line) => line.startsWith("-")).length,
        status,
      },
    ]
  })

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  handlers
    .handle(
      "vcs.init",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const provider = ctx.query.provider ?? "git"
        if (provider !== "git")
          return yield* new InvalidRequestError({ message: `Unknown VCS provider: ${provider}`, field: "provider" })
        const existing = yield* inInstance(directory, () => Instance.project.vcs)
        if (existing)
          return yield* new ConflictError({
            message: "Directory is already under version control",
            resource: directory,
          })
        const out = yield* Effect.promise(() => git(directory, ["init"]))
        if (!out.ok) return yield* new ServiceUnavailableError({ message: "git init failed", service: "git" })
        // Drop the cached instance so the next request re-detects the project's VCS state.
        yield* inInstance(directory, () => Instance.dispose())
        return HttpServerResponse.empty({ status: 204 })
      }),
    )
    .handle(
      "vcs.get",
      Effect.fn(function* () {
        const directory = yield* Directory
        const provider = yield* inInstance(directory, () => Instance.project.vcs)
        const current = yield* Effect.promise(() => currentBranch(directory))
        const fallback = yield* Effect.promise(() => defaultBranch(directory))
        return HttpServerResponse.jsonUnsafe({
          location: { directory },
          data: { provider, branch: { current, default: fallback } },
        })
      }),
    )
    .handle(
      "vcs.base",
      Effect.fn(function* () {
        const directory = yield* Directory
        const current = yield* Effect.promise(() => currentBranch(directory))
        const data = yield* Effect.promise(() => reviewBase(directory, current))
        return HttpServerResponse.jsonUnsafe({ location: { directory }, data })
      }),
    )
    .handle(
      "vcs.status",
      Effect.fn(function* () {
        const directory = yield* Directory
        const branch = yield* inInstance(directory, () => Vcs.branch())
        // Answered as plain JSON until the status projection lands; the contract only needs a JSON body.
        return HttpServerResponse.jsonUnsafe({ branch: branch ?? null })
      }),
    )
    .handle(
      "vcs.branch.list",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const refs = yield* Effect.promise(() =>
          git(directory, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]),
        )
        const names = refs.text.split("\n").flatMap((ref) => {
          if (!ref) return []
          if (ref.startsWith("refs/remotes/") && ref.endsWith("/HEAD")) return []
          return [ref.replace(/^refs\/(heads|remotes)\//, "")]
        })
        const search = ctx.query.search?.toLowerCase()
        const matched = search ? names.filter((name) => name.toLowerCase().includes(search)) : names
        const data = ctx.query.limit ? matched.slice(0, ctx.query.limit) : matched
        return HttpServerResponse.jsonUnsafe({ location: { directory }, data })
      }),
    )
    .handle(
      "vcs.diff",
      Effect.fn(function* (ctx) {
        const directory = yield* Directory
        const context = ctx.query.context === undefined ? [] : [`-U${ctx.query.context}`]
        const diffArgs = ["diff", "--no-ext-diff", "--no-renames", "-p", ...context]
        const { mode } = ctx.query

        if (mode === "working") {
          const head = yield* Effect.promise(() => hasHead(directory))
          const out = yield* Effect.promise(() => git(directory, [...diffArgs, head ? "HEAD" : EMPTY_TREE]))
          return HttpServerResponse.jsonUnsafe({ location: { directory }, data: parseDiff(out.text) })
        }

        const current = yield* Effect.promise(() => currentBranch(directory))
        const base = ctx.query.base ?? (yield* Effect.promise(() => reviewBase(directory, current)))?.name
        if (!base)
          return yield* new InvalidRequestError({ message: "No review base; pass base explicitly", field: "base" })
        const mergeBase = yield* Effect.promise(() => git(directory, ["merge-base", base, "HEAD"]))
        if (!mergeBase.ok)
          return yield* new InvalidRequestError({
            message: `Base does not resolve to a commit: ${base}`,
            field: "base",
          })
        const anchor = mergeBase.text.trim()
        const args = mode === "committed" ? [...diffArgs, anchor, "HEAD"] : [...diffArgs, anchor]
        const out = yield* Effect.promise(() => git(directory, args))
        return HttpServerResponse.jsonUnsafe({ location: { directory }, data: parseDiff(out.text) })
      }),
    ),
)
