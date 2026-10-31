import { z } from "zod";

/** Native producer facts about the exact reported symbol, independent of display spelling. */
export const nativeSymbolMetadataSchema = z.object({
  primary: z.boolean(),
  dynamic: z.boolean(),
  external: z.boolean(),
  type: z.string(),
  source: z.enum(["default", "analysis", "ai", "imported", "user_defined"]),
});
export type NativeSymbolMetadata = z.infer<typeof nativeSymbolMetadataSchema>;

export const nativeSymbolOrigin = (
  symbol: NativeSymbolMetadata | null | undefined,
): "generated" | "named" | "unknown" =>
  symbol == null
    ? "unknown"
    : symbol.dynamic || symbol.source === "default"
      ? "generated"
      : "named";

/** Unknown origin never makes an arbitrary display label a cross-artifact identity. */
export const hasStableNativeSymbol = (
  name: string,
  symbol: NativeSymbolMetadata | null | undefined,
): boolean => name.length > 0 && nativeSymbolOrigin(symbol) === "named";
