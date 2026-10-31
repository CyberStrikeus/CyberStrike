import { createHash } from "node:crypto";

import type {
  CapturedWebScript,
  ExportedWebScript,
} from "./webScriptExport.js";
import { urlDeclaresQueryOrFragment } from "./urlComponents.js";

const hash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
// Literal URL path characters that are also portable filename characters.
// Percent escapes remain isolated: decoding them could change path identity.
const PORTABLE_SEGMENT = /^[A-Za-z0-9_~.!$&'()+,;=@-]+$/u;
const RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

/** One planned file, or an explicit missing source with no filesystem effect. */
export interface PlannedWebScript {
  readonly script: CapturedWebScript;
  readonly record: ExportedWebScript;
}

/** Stable isolated identity shared by planning and destination collision fallback. */
export const isolatedWebScriptPath = (
  source: CapturedWebScript["source"],
  index: number,
): string => `isolated/source-${index + 1}-${hash(JSON.stringify(source))}.js`;

/** Preserve safe URL layouts only when every captured path is unambiguous. */
export const planWebScriptExport = (
  scripts: readonly CapturedWebScript[],
): readonly PlannedWebScript[] => {
  const candidates = scripts.map(candidatePath);
  const conflicts = conflictingPaths(candidates);
  return scripts.map((script, index) => {
    if (script.content.state === "unavailable")
      return {
        script,
        record: {
          source: script.source,
          url: script.url,
          content: script.content,
        },
      };
    const candidate = candidates[index];
    const reason = conflicts.has(index)
      ? "Captured paths collide by content version or file/directory prefix."
      : (candidate?.reason ?? null);
    const path = reason === null ? candidate?.path : undefined;
    return {
      script,
      record: {
        source: script.source,
        url: script.url,
        content: {
          state: "exported",
          relative_path: path ?? isolatedWebScriptPath(script.source, index),
          layout: path === undefined ? "isolated" : "url-path",
          layout_reason: reason,
          sha256: script.content.sha256,
          bytes: script.content.bytes.length,
          media_type: script.content.media_type,
          redacted: script.content.redacted,
          representation: script.content.representation,
        },
      },
    };
  });
};

interface CandidatePath {
  readonly path?: string;
  readonly reason: string | null;
}

const candidatePath = (script: CapturedWebScript): CandidatePath => {
  let url: URL;
  try {
    url = new URL(script.url);
  } catch {
    return {
      reason: "Source has no absolute HTTP URL (for example an inline script).",
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { reason: "Source URL scheme has no local module layout mapping." };
  const parts = url.pathname.slice(1).split("/");
  if (
    !/\.(?:js|mjs|cjs)$/u.test(url.pathname) ||
    parts.some(
      (part) =>
        !PORTABLE_SEGMENT.test(part) ||
        part === "." ||
        part === ".." ||
        part.endsWith(".") ||
        RESERVED_SEGMENT.test(part),
    )
  )
    return {
      reason: "URL path is not an ordinary portable JavaScript module path.",
    };
  return {
    path: `origins/${hash(url.origin)}/${parts.join("/")}`,
    reason:
      urlDeclaresQueryOrFragment(url) ||
      url.username !== "" ||
      url.password !== ""
        ? "URL query, fragment, or credentials cannot select a canonical local module."
        : null,
  };
};

// Register every exact prefix so a repeated path, or a file that is also a
// directory prefix, isolates every affected source. Case-distinct spellings
// stay distinct until the destination filesystem reports a collision.
const conflictingPaths = (
  candidates: readonly CandidatePath[],
): Set<number> => {
  const prefixes = new Map<string, { indices: number[]; files: number[] }>();
  candidates.forEach(({ path }, index) => {
    if (path === undefined) return;
    const parts = path.split("/");
    parts.forEach((_, position) => {
      const spelling = parts.slice(0, position + 1).join("/");
      const entry = prefixes.get(spelling) ?? { indices: [], files: [] };
      entry.indices.push(index);
      if (position === parts.length - 1) entry.files.push(index);
      prefixes.set(spelling, entry);
    });
  });
  const conflicts = new Set<number>();
  for (const entry of prefixes.values())
    if (
      entry.files.length > 1 ||
      (entry.files.length > 0 && entry.indices.length > entry.files.length)
    )
      for (const index of entry.indices) conflicts.add(index);
  return conflicts;
};
