/** One static import or re-export specifier and its source line. */
export interface ImportSpecifierFact {
  readonly specifier: string;
  readonly line: number;
}

/** Static string specifier on one import or re-export node, when it has one. */
export function importSpecifier(node: {
  readonly type: string;
}): string | undefined;

/**
 * Static import and re-export specifiers in source order.
 * Comments and string literals are not imports.
 */
export function readImportSpecifiers(
  source: string,
): readonly ImportSpecifierFact[];
