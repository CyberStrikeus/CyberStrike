export type NpmReleaseState =
  | { status: "absent" }
  | {
      status: "published";
      integrity: string;
      tag: "latest" | "next";
      taggedVersion: string | null;
      stableVersion: string | null;
    };
export function readQualifiedNpmRelease(
  version: string,
  tag: "latest" | "next",
  request?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<NpmReleaseState>;
export function requireMatchingNpmRelease(
  tarball: string,
  version: string,
  published: NpmReleaseState,
): Promise<void>;
