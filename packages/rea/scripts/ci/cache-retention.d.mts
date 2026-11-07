export interface RetainedCacheEntry {
  readonly id: number;
  readonly key: string;
  readonly createdAt: number;
  readonly accessedAt: number;
  readonly size: number;
}

export interface CacheListRecord {
  readonly id: number;
  readonly key: string;
  readonly version: string;
  readonly ref: string;
  readonly created_at: string;
  readonly last_accessed_at?: string;
  readonly size_in_bytes: number;
}

export interface RetentionFamily {
  readonly prefix: string;
  readonly keepKey?: string;
}

export type CacheRequest = (
  method: string,
  endpoint: string,
) => Promise<unknown>;

export function assertRetentionPrefix(prefix: string): void;

export function selectPrefixDeletions(
  caches: readonly unknown[],
  family?: RetentionFamily,
  keepGenerations?: number,
): RetainedCacheEntry[];

export function selectNpmDownloadDuplicateDeletions(
  caches: readonly unknown[],
): RetainedCacheEntry[];

export function listAllCaches(
  request: CacheRequest,
  repository: string,
  prefix: string,
): Promise<readonly CacheListRecord[]>;

export function retainCaches(options: {
  repository: string;
  request: CacheRequest;
  deleteCache: (id: number) => Promise<void>;
  families?: readonly RetentionFamily[];
  dedupeNpmDownloads?: boolean;
  dryRun?: boolean;
}): Promise<{
  dryRun: boolean;
  plan: readonly {
    prefix: string;
    deletions: readonly RetainedCacheEntry[];
  }[];
  npmDeletions: readonly RetainedCacheEntry[];
}>;
