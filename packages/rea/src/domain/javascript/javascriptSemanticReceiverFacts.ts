/** Lexical receiver identities that select static endpoint interpretations. */
export type JavaScriptOpenReceiverFact =
  | "window"
  | "indexed-db"
  | "cache-storage"
  | "local"
  | "local-indexed-db"
  | "local-cache-storage"
  | "configuration"
  | "extension-state";
