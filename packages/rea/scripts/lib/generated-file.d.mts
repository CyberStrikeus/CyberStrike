export interface GeneratedFileOptions {
  readonly path: string;
  readonly source: string;
  readonly check: boolean;
  readonly generateCommand: string;
}

export function ensureGeneratedFile(
  options: GeneratedFileOptions,
): Promise<{ readonly changed: boolean }>;
