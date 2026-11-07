/**
 * True when the URL spells a query or fragment, including an empty one.
 * `URL.search` and `URL.hash` are empty both when that component is absent
 * and when it is present but empty, so href is the spelling that keeps them apart.
 */
export const urlDeclaresQueryOrFragment = (url: URL): boolean =>
  url.href.includes("?") || url.href.includes("#");
