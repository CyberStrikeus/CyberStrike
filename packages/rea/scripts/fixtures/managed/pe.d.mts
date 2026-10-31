export interface ManagedPeFixtureMethod {
  readonly body?: Buffer;
  readonly flags?: number;
  readonly implFlags?: number;
  readonly name: string;
  /** An explicit metadata RVA; zero represents a method without an IL body. */
  readonly rva?: number;
}

export interface ManagedPeFixtureOptions {
  readonly cliFlags?: number;
  readonly corruptMetadataSignature?: boolean;
  readonly fieldName?: string;
  readonly fields?: readonly {
    readonly name: string;
    readonly flags?: number;
    readonly signature?: Buffer;
  }[];
  /** Constant rows: HasConstant parent defaults to Field row 1. */
  readonly constants?: readonly {
    readonly typeCode: number;
    readonly padding?: number;
    readonly parentRaw?: number;
    readonly value: Buffer;
  }[];
  readonly ilBody?: Buffer;
  readonly machine?: number;
  readonly metadataValidMaskExtra?: bigint;
  readonly methodImplFlags?: number;
  readonly methodName?: string;
  readonly methods?: readonly ManagedPeFixtureMethod[];
  readonly mvid?: Buffer;
  readonly pinvoke?: {
    readonly importName?: string;
    readonly mappingFlags?: number;
    readonly memberRow?: number;
    readonly moduleName?: string;
  };
  readonly readyToRun?: boolean;
  readonly references?: readonly string[];
  readonly resourceData?: Buffer;
  readonly targetFramework?: string;
  readonly typeName?: string;
  readonly typeNamespace?: string;
}

export const alternateMvid: Buffer;
export function buildManagedPeFixture(
  options?: ManagedPeFixtureOptions,
): Buffer;
export function buildNativePeFixture(): Buffer;
