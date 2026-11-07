/**
 * Selectable tool-family ids in catalog order.
 *
 * Kept separate from the contract definitions so startup configuration can
 * validate `REA_MCP_TOOL_FAMILIES` without loading the canonical schema graph
 * that the deferred MCP runtime deliberately avoids.
 */
export const TOOL_FAMILY_IDS = [
  "direct",
  "enhanced",
  "native",
  "artifact",
  "managed",
  "firmware",
  "android",
  "pcap",
  "flutter",
  "frida",
  "apktool",
  "jeb",
  "adb",
  "browser",
  "electron",
  "javascript-runtime",
  "application",
  "session",
] as const;

export type ToolFamilyId = (typeof TOOL_FAMILY_IDS)[number];

/** Whether a parsed selection value names a published tool family. */
export const isToolFamilyId = (value: string): value is ToolFamilyId =>
  (TOOL_FAMILY_IDS as readonly string[]).includes(value);

/**
 * Invoke one registrar per published family, in {@link TOOL_FAMILY_IDS} order.
 * Both CLI and MCP pass a complete map; a new id fails those call sites.
 * This module stays free of contract schemas so CLI startup can walk the list
 * without loading every tool definition.
 */
export const registerToolFamilies = (registrars: {
  readonly [Id in ToolFamilyId]: () => void;
}): void => {
  for (const id of TOOL_FAMILY_IDS) registrars[id]();
};
