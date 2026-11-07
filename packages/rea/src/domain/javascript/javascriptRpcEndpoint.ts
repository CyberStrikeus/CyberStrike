import type * as t from "@babel/types";

/** One RPC operation or transport URL recovered from client-side syntax. */
export interface JavaScriptRpcEndpoint {
  readonly value: string;
  readonly mechanism: string;
}

/** Feed every AST node in pre-order, then drain finish() for Source findings. */
export interface JavaScriptRpcScan {
  inspect(node: t.Node): JavaScriptRpcEndpoint | undefined;
  finish(): Iterable<
    (JavaScriptRpcEndpoint & { readonly node: t.Node }) | void
  >;
}
