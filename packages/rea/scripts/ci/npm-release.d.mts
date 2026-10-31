import type { NpmReleaseState } from "./npm-release-state.mjs";

export function readNpmRelease(
  version: string,
  request?: (url: string, init: RequestInit) => Promise<Response>,
): Promise<NpmReleaseState>;
export function stableUpdateVersion(
  version: string,
  published: NpmReleaseState,
): string;
export function waitForNpmRelease(
  version: string,
  lookup?: (version: string) => Promise<NpmReleaseState>,
  pause?: (milliseconds: number) => Promise<unknown>,
): Promise<Extract<NpmReleaseState, { status: "published" }>>;
