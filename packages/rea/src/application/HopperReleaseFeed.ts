import { createHash } from "node:crypto";
import { z } from "zod";

import { jsonObjectSchema, type JsonValue } from "../domain/jsonValue.js";
import {
  safeParseUtf8Json,
  type SafeJsonParseResult,
} from "../domain/safeJson.js";
import { err, ok, type Result } from "../domain/result.js";
import { HOPPER_DOWNLOAD_BYTES } from "./HopperDownload.js";
import { urlDeclaresQueryOrFragment } from "../domain/urlComponents.js";

/** Vendor endpoints, shared by installation and existing-build inspection. */
export const HOPPER_RELEASES_URL =
  "https://www.hopperapp.com/include/files-api.php?request=releases&public=true";
export const HOPPER_PUBLIC_KEY_URL =
  "https://www.hopperapp.com/hopper-public-key.asc";
export const HOPPER_DOWNLOAD_PREFIX =
  "https://www.hopperapp.com:443/downloader/public/";

/** Decode vendor/cache JSON while retaining their established initial UTF-8 BOM tolerance. */
export const parseHopperReleaseJson = (
  bytes: Uint8Array,
): SafeJsonParseResult =>
  safeParseUtf8Json(
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes,
  );

/** Package identity is shared by the platform-specific publisher verification workflows. */
export const hopperArchiveIntegrityMatches = (
  bytes: Uint8Array,
  release: Readonly<{ file_length: string; file_hash: string }>,
): boolean =>
  bytes.byteLength === Number(release.file_length) &&
  bytes.byteLength <= HOPPER_DOWNLOAD_BYTES &&
  createHash("sha1").update(bytes).digest("hex") === release.file_hash;

const archiveReleaseSchema = z.object({
  filename: z.string().url(),
  file_length: z.string().regex(/^\d+$/u),
  file_hash: z.string().regex(/^[a-f0-9]{40}$/u),
});
export type MacHopperRelease = z.infer<typeof archiveReleaseSchema> &
  Record<string, JsonValue>;

const selectedPlatformsSchema = z.object({
  "OS X": z.unknown().optional(),
  "Ubuntu / Mint": z.unknown().optional(),
  Fedora: z.unknown().optional(),
  Arch: z.unknown().optional(),
});

/** Interpret channel identity once using the same URL semantics as the downloader. */
const isPublicHopperDownload = (url: URL): boolean =>
  url.origin === "https://www.hopperapp.com" &&
  url.username === "" &&
  url.password === "" &&
  !urlDeclaresQueryOrFragment(url) &&
  url.pathname.startsWith("/downloader/public/");

/** Admit the selected macOS row without projecting away vendor release metadata. */
export const parseMacHopperReleases = (
  raw: unknown,
): Result<MacHopperRelease, HopperReleaseError> => {
  const root = selectedPlatformsSchema.safeParse(raw);
  const release = jsonObjectSchema.safeParse(
    root.success ? root.data["OS X"] : undefined,
  );
  if (!release.success || !archiveReleaseSchema.safeParse(release.data).success)
    return err(
      new HopperReleaseError(
        "release_metadata",
        "The Hopper macOS release metadata is malformed.",
      ),
    );
  const retained = release.data as MacHopperRelease;
  if (!isPublicHopperDownload(new URL(retained.filename)))
    return err(
      new HopperReleaseError(
        "release_metadata",
        "The Hopper macOS release is outside the official download channel.",
      ),
    );
  return ok(retained);
};

/** Stable publisher identity; signing subkeys are admitted through this primary. */
export const HOPPER_LINUX_PRIMARY_FINGERPRINT =
  "7C2D73BAFAF5B9A710A69DA1A26DF815099B1BCD";

export type LinuxPackageFamily = "deb" | "rpm" | "arch";
const platforms = {
  deb: "Ubuntu / Mint",
  rpm: "Fedora",
  arch: "Arch",
} as const;
const suffixes = { deb: ".deb", rpm: ".rpm", arch: ".pkg.tar.xz" } as const;

export class HopperReleaseError extends Error {
  readonly _tag = "HopperReleaseError";
  constructor(
    readonly reason:
      | "release_metadata"
      | "download"
      | "integrity"
      | "publisher_verification_failed"
      | "verification_unavailable"
      | "unsupported_hopper_build"
      | "cancelled"
      | "cleanup_failed"
      | "cache_missing",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = this._tag;
  }
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const releaseSchema = archiveReleaseSchema.extend({
  version: z.string().min(1),
  file_length: z
    .string()
    .regex(/^[1-9]\d*$/u)
    .refine((text) => {
      const count = Number(text);
      return Number.isSafeInteger(count) && count <= HOPPER_DOWNLOAD_BYTES;
    }),
  main_exe_hash: sha256,
  signature: z
    .string()
    .min(1)
    .refine((text) => Buffer.from(text, "base64").toString("base64") === text),
  public: z.literal("1"),
  beta: z.literal("0"),
});

/** Parsed once at the feed boundary; preserve the vendor's complete release row. */
export type LinuxHopperRelease = z.infer<typeof releaseSchema> &
  Record<string, JsonValue>;
export type LinuxHopperReleaseFeed = Readonly<
  Record<LinuxPackageFamily, Result<LinuxHopperRelease, HopperReleaseError>>
>;

export const parseLinuxHopperRelease = (
  raw: unknown,
  family: LinuxPackageFamily,
): Result<LinuxHopperRelease, HopperReleaseError> => {
  const retained = jsonObjectSchema.safeParse(raw);
  const parsed = releaseSchema.safeParse(
    retained.success ? retained.data : undefined,
  );
  if (!retained.success || !parsed.success)
    return err(
      new HopperReleaseError(
        "release_metadata",
        "The Hopper release omitted valid package identity or signature metadata.",
      ),
    );
  const url = new URL(parsed.data.filename);
  if (
    !isPublicHopperDownload(url) ||
    !url.pathname.startsWith("/downloader/public/Hopper-") ||
    !url.pathname.endsWith(`-Linux-demo${suffixes[family]}`)
  )
    return err(
      new HopperReleaseError(
        "release_metadata",
        "The Hopper release is outside the official public Linux demo channel.",
      ),
    );
  return ok(retained.data as LinuxHopperRelease);
};

export const parseLinuxHopperReleases = (
  raw: unknown,
): Result<LinuxHopperReleaseFeed, HopperReleaseError> => {
  const feed = selectedPlatformsSchema.safeParse(raw);
  if (!feed.success)
    return err(
      new HopperReleaseError(
        "release_metadata",
        "The Hopper releases response is not an object.",
      ),
    );
  return ok({
    deb: parseLinuxHopperRelease(feed.data[platforms.deb], "deb"),
    rpm: parseLinuxHopperRelease(feed.data[platforms.rpm], "rpm"),
    arch: parseLinuxHopperRelease(feed.data[platforms.arch], "arch"),
  });
};
