export interface ProductCatalog {
  readonly package: {
    readonly name: string;
    readonly version: string;
    readonly sdk: Readonly<Record<string, string>>;
    readonly skill_version: string;
  };
  readonly tools: {
    readonly total: number;
    readonly families: readonly {
      readonly id: string;
      readonly surface: string;
      readonly count: number;
      readonly tools: readonly string[];
    }[];
  };
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly version: string | null;
    readonly capabilities: readonly string[];
  }[];
  readonly setup_clients: readonly {
    readonly id: string;
    readonly display_name: string;
    readonly format: string;
    readonly configuration: string;
  }[];
  readonly cli: {
    readonly primary_count: number;
    readonly commands: readonly string[];
    readonly aliases: readonly {
      readonly name: string;
      readonly target: string;
    }[];
  };
  readonly runtime_catalog: {
    readonly counts: Readonly<Record<string, number>>;
    readonly digests: Readonly<Record<string, string>>;
  };
}

export function createProductCatalog(root: string): Promise<ProductCatalog>;
export function serializeProductCatalog(
  catalog: ProductCatalog,
): Promise<string>;
