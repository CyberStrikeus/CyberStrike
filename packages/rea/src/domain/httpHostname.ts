import { isIPv6 } from "node:net";
import { z } from "zod";

/** Parse a complete hostname/IP, never URL components, into the SDK's hostname identity. */
export const normalizeHttpHostname = (host: string): string | undefined => {
  const unbracketed =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const ipv6 = isIPv6(unbracketed);
  // URL parsing alone discards userinfo, paths and default ports, and decodes escapes.
  if (
    /[\s\x00-\x1F\x7F%\x2F\x5C?#@]/u.test(host) ||
    (!ipv6 && host.includes(":"))
  )
    return undefined;
  try {
    return new URL(`http://${ipv6 ? `[${unbracketed}]` : host}`).hostname;
  } catch {
    return undefined;
  }
};

/** Canonical HTTP hostname identity, parsed before consumers use it for lookup or matching. */
export const httpHostnameSchema = z
  .string()
  .transform((source, context) => {
    const hostname = normalizeHttpHostname(source);
    if (hostname !== undefined) return hostname;
    context.addIssue({
      code: "custom",
      message:
        "Expected a host name or IP address without URL components or ports",
    });
    return z.NEVER;
  })
  .brand<"HttpHostname">();

export type HttpHostname = z.infer<typeof httpHostnameSchema>;
