export interface StaticTaskContext {
  readonly version: 1;
  readonly sourceSha: string;
  readonly sourceClean: boolean;
  readonly prHeadSha?: string;
  readonly nodeVersion: string;
  readonly npmVersion: string;
  readonly turboVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly taskHashes: Readonly<Record<string, string>>;
}
export function parseStaticTaskContext(value: unknown): StaticTaskContext;
export function recordStaticTaskContext(options?: {
  root?: string;
  npmCli?: string;
  outputDirectory?: string;
  script?: string;
}): Promise<StaticTaskContext>;
