import type { ProductCatalog } from "./product-catalog.mjs";

export function skillReferenceIssues(
  skillRoot: string,
): Promise<readonly string[]>;

export function documentationFactIssues(
  root: string,
  catalog: ProductCatalog,
): Promise<readonly string[]>;
export function assertDocumentationFacts(
  root: string,
  catalog: ProductCatalog,
): Promise<void>;
