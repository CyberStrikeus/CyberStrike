import type * as t from "@babel/types";
import type { JavaScriptSemanticPropertyPath as PropertyPath } from "./javascriptSemanticPropertyPaths.js";

/** One selected object or class property, including prototype and copy facts. */
export interface JavaScriptSemanticObjectReference {
  readonly node: t.Node;
  readonly path: PropertyPath;
  /** This selection crossed the object's prototype, rather than an own slot. */
  readonly inherited?: true;
  /** A shallow copy selects this prefix now while retaining its child identity. */
  readonly capturedSelectionAt?: t.Node;
  readonly ownEnumerable?: true;
  readonly iterableFallbackPath?: PropertyPath;
  readonly escapes?: true;
  /** A retry omitted suffixes, so escaping constructed children must cover them. */
  readonly widenedGetterResult?: true;
  /** The allocation owned by this binding, rather than a read of its prior value. */
  readonly ownerInitializer?: t.Node;
}
