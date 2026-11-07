import type { WebPageInspection } from "../domain/browserObservationSchemas.js";
import { sanitizeBrowserUrl } from "../domain/browserObservation.js";
import type { CdpResponseFacts } from "./CdpNetworkEventFacts.js";
import { structuredFieldToken } from "./StructuredFieldToken.js";

type ResponseMetadata = WebPageInspection["metadata"]["responses"][number];
type LinkMetadata = ResponseMetadata["links"][number];
type AgentHint = WebPageInspection["metadata"]["agent_hints"][number];
type LinkParameter = { readonly name: string; readonly value: string };
type ParsedLink = {
  readonly metadata: LinkMetadata;
  readonly contextMatchesResponse: boolean;
};

/** Normalize an allowlisted subset of response metadata and discard raw headers. */
export const safeResponseMetadata = (
  requestId: string,
  url: string,
  response: CdpResponseFacts,
  allowedOrigins: ReadonlySet<string>,
): {
  readonly response: ResponseMetadata;
  readonly agentHints: AgentHint[];
} => {
  const headers = normalizedHeaders(response.headers);
  // RFC 9110 section 5.3: repeated field lines combine as one comma-separated value.
  const field = (name: string): string | undefined =>
    headers.get(name)?.join(", ");
  const responseUrl = response.url?.source ?? url;
  const parsedLinks = parseLinks(
    headers.get("link"),
    responseUrl,
    allowedOrigins,
  );
  const links = parsedLinks.map(({ metadata }) => metadata);
  const csp = parseCsp(
    headers.get("content-security-policy"),
    url,
    allowedOrigins,
  );
  const agentHints = [
    ...parsedLinks.flatMap(({ metadata, contextMatchesResponse }) =>
      contextMatchesResponse && metadata.rel.some(isAgentRel)
        ? [agentHint("link_rel", metadata.rel.join(" "), metadata.href)]
        : [],
    ),
    ...agentHeaderNames.flatMap((name) =>
      headers.has(name) ? [agentHint("response_header", name, null)] : [],
    ),
    ...wellKnownHint(url),
  ];
  return {
    response: {
      request_id: requestId,
      url,
      mime_type: mediaTypeDeclaration(response.mimeType),
      content_length: contentLength(field("content-length")),
      content_encoding: boundedHeader(field("content-encoding")),
      csp,
      links,
      policies: {
        coop: structuredFieldToken(field("cross-origin-opener-policy")),
        coep: structuredFieldToken(field("cross-origin-embedder-policy")),
        corp: policyToken(field("cross-origin-resource-policy")),
        referrer_policy: referrerPolicy(field("referrer-policy")),
        x_content_type_options: policyToken(field("x-content-type-options")),
        permissions_policy_features: permissionFeatures(
          field("permissions-policy"),
        ),
      },
    },
    agentHints,
  };
};

/**
 * Lowercase header names and keep each field line. CDP joins repeated field
 * lines with LF, so each line is parsed on its own.
 */
const normalizedHeaders = (
  value: unknown,
): ReadonlyMap<string, readonly string[]> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return new Map();
  const headers = new Map<string, string[]>();
  for (const [name, raw] of Object.entries(value)) {
    const normalized = name.toLowerCase();
    const header =
      typeof raw === "string"
        ? raw
        : typeof raw === "number" && Number.isFinite(raw)
          ? String(raw)
          : undefined;
    if (header !== undefined)
      headers.set(normalized, [
        ...(headers.get(normalized) ?? []),
        ...header.split(/\r?\n/u),
      ]);
  }
  return headers;
};

/**
 * Each field line is a CSP3 serialized policy list, with policies separated by
 * commas. Directives of every policy are returned in order; the schema does not
 * record which policy a directive came from. Within one policy, CSP3 keeps the
 * first directive of each name and ignores its repeats.
 */
const parseCsp = (
  lines: readonly string[] | undefined,
  baseUrl: string,
  allowedOrigins: ReadonlySet<string>,
): ResponseMetadata["csp"] => {
  const directives: ResponseMetadata["csp"]["directives"] = [];
  let nonceCount = 0;
  let hashCount = 0;
  const policies = (lines ?? []).flatMap((line) => line.split(","));
  for (const policy of policies) {
    const names = new Set<string>();
    for (const rawDirective of policy.split(";")) {
      // CSP3 rejects non-ASCII directives and uses Infra ASCII whitespace.
      if (/[^\x00-\x7f]/u.test(rawDirective)) continue;
      const [rawName, ...tokens] = rawDirective
        .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, "")
        .split(/[\t\n\f\r ]+/u);
      const name = (rawName ?? "").toLowerCase();
      if (!/^[a-z][a-z0-9\x2d]*$/u.test(name) || names.has(name)) continue;
      names.add(name);
      const sources: ResponseMetadata["csp"]["directives"][number]["sources"] =
        [];
      for (const token of tokens) {
        const lower = token.toLowerCase();
        if (lower.startsWith("'nonce-")) {
          nonceCount += 1;
          continue;
        }
        if (
          lower.startsWith("'sha256-") ||
          lower.startsWith("'sha384-") ||
          lower.startsWith("'sha512-")
        ) {
          hashCount += 1;
          continue;
        }
        sources.push(cspSource(token, baseUrl, allowedOrigins));
      }
      directives.push({ name, sources });
    }
  }
  return { directives, nonce_count: nonceCount, hash_count: hashCount };
};

const cspSource = (
  token: string,
  baseUrl: string,
  allowedOrigins: ReadonlySet<string>,
): ResponseMetadata["csp"]["directives"][number]["sources"][number] => {
  const lower = token.toLowerCase();
  if (/^'[a-z0-9\x2d]+'$/u.test(lower))
    return { kind: "keyword", value: lower };
  if (/^[a-z][a-z0-9+.\x2d]*:$/u.test(lower))
    return { kind: "scheme", value: lower };
  const hostOrigin = cspHostSourceOrigin(token, baseUrl);
  if (hostOrigin === undefined) return { kind: "other", value: null };
  return hostOrigin !== null && allowedOrigins.has(hostOrigin)
    ? { kind: "approved_origin", value: hostOrigin }
    : { kind: "external_origin", value: null };
};

/**
 * Resolve a CSP host-source (CSP3 §2.3.1) to the single origin it names. A
 * scheme-less source inherits the protected resource's scheme instead of being
 * resolved as a page-relative path. Returns `null` for a recognized wildcard
 * host or port, which denotes a set of origins rather than one origin, and
 * `undefined` when the token is not a host-source at all.
 */
const cspHostSourceOrigin = (
  token: string,
  baseUrl: string,
): string | null | undefined => {
  const match =
    /^(?:([a-z][a-z0-9+.\x2d]*):\/\/)?([^\x2f?#]+)(?:\/[^?#]*)?$/iu.exec(token);
  const authority = match?.[2];
  if (authority === undefined || authority.length === 0) return undefined;
  const scheme = (match?.[1] ?? schemeOf(baseUrl))?.toLowerCase();
  if (scheme === undefined || !/^[a-z][a-z0-9+.\x2d]*$/u.test(scheme))
    return undefined;
  if (
    !/^(?:\*|(?:\*\.)?[a-z0-9\x2d]+(?:\.[a-z0-9\x2d]+)*\.?)(?::(?:\*|\d+))?$/iu.test(
      authority,
    )
  )
    return undefined;
  if (authority.includes("*")) return null;
  try {
    const parsed = new URL(`${scheme}://${authority}`);
    return parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.origin !== "null"
      ? parsed.origin
      : undefined;
  } catch (cause: unknown) {
    // Authorities that are not a bare host[:port] are classified as other.
    void cause;
    return undefined;
  }
};

const schemeOf = (baseUrl: string): string | undefined => {
  try {
    return new URL(baseUrl).protocol.replace(/:$/u, "");
  } catch (cause: unknown) {
    // An unparseable protected-resource URL cannot lend a scheme.
    void cause;
    return undefined;
  }
};

const parseLinks = (
  lines: readonly string[] | undefined,
  responseUrl: string,
  allowedOrigins: ReadonlySet<string>,
): ParsedLink[] => {
  const links: ParsedLink[] = [];
  // Keep resolved identity separate from the credential-redacted display URL.
  const response = safeDestination(responseUrl, responseUrl, allowedOrigins);
  // Quoted delimiters belong to one field line.
  for (const line of lines ?? []) {
    for (const entry of splitLinkHeader(line)) {
      const match = /^[\t ]*<([^>]*)>(.*)$/u.exec(entry);
      if (match === null) continue;
      const parameters = linkParameters(match[2] ?? "");
      const anchor = firstLinkParameter(parameters, "anchor");
      const destination = safeDestination(
        match[1] ?? "",
        responseUrl,
        allowedOrigins,
      );
      const context =
        anchor === undefined
          ? response
          : safeDestination(anchor.value, responseUrl, allowedOrigins);
      // RFC 8288 assigns first-occurrence semantics to rel, anchor, and type.
      const rel = firstLinkParameter(parameters, "rel")?.value ?? "";
      links.push({
        metadata: {
          href: destination.url,
          destination_scope: destination.scope,
          context_url: context.url,
          context_scope: context.scope,
          // RFC 8288 Appendix B.2 uses HTTP RWS (SP / HTAB), not HTML whitespace.
          rel: rel
            .toLowerCase()
            .split(/[\t ]+/u)
            .filter(Boolean),
          as: boundedHeader(lastLinkParameter(parameters, "as")?.value),
          type: mediaTypeDeclaration(
            firstLinkParameter(parameters, "type")?.value,
          ),
          crossorigin: boundedHeader(
            lastLinkParameter(parameters, "crossorigin")?.value,
          ),
        },
        contextMatchesResponse:
          response.identity !== undefined &&
          context.identity === response.identity,
      });
    }
  }
  return links;
};

const splitLinkHeader = (
  value: string,
  delimiter: "," | ";" = ",",
): string[] => {
  const entries: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  let target = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"' && !target) quoted = true;
    else if (delimiter === "," && character === "<") target = true;
    else if (delimiter === "," && character === ">") target = false;
    else if (character === delimiter && !target) {
      entries.push(value.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(value.slice(start));
  return entries;
};

// HTTP OWS/BWS never includes Unicode or HTML-only whitespace.
const trimHttpWhitespace = (value: string): string =>
  value.replace(/^[\t ]+|[\t ]+$/gu, "");

const linkParameters = (value: string): readonly LinkParameter[] => {
  const parameters: LinkParameter[] = [];
  for (const raw of splitLinkHeader(value, ";").slice(1)) {
    const separator = raw.indexOf("=");
    const name = trimHttpWhitespace(
      separator < 0 ? raw : raw.slice(0, separator),
    ).toLowerCase();
    if (!/^[a-z][a-z0-9\x2d]*$/u.test(name)) continue;
    const parameter =
      separator < 0 ? "" : trimHttpWhitespace(raw.slice(separator + 1));
    parameters.push({ name, value: decodeLinkParameter(parameter) });
  }
  return parameters;
};

const firstLinkParameter = (
  parameters: readonly LinkParameter[],
  name: string,
): LinkParameter | undefined =>
  parameters.find((parameter) => parameter.name === name);

const lastLinkParameter = (
  parameters: readonly LinkParameter[],
  name: string,
): LinkParameter | undefined => {
  for (let index = parameters.length - 1; index >= 0; index -= 1) {
    const parameter = parameters[index];
    if (parameter?.name === name) return parameter;
  }
  return undefined;
};

const safeDestination = (
  value: string,
  baseUrl: string,
  allowedOrigins: ReadonlySet<string>,
): {
  readonly identity: string | undefined;
  readonly url: string | null;
  readonly scope: LinkMetadata["destination_scope"];
} => {
  try {
    const parsed = new URL(value, baseUrl);
    const identity = parsed.href;
    const sanitized = sanitizeBrowserUrl(identity).url;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return { identity, url: sanitized, scope: "unsupported" };
    if (!allowedOrigins.has(parsed.origin))
      return { identity, url: sanitized, scope: "outside_policy" };
    return { identity, url: sanitized, scope: "approved" };
  } catch (cause: unknown) {
    // Unparseable link values keep their raw text for the analyst.
    void cause;
    return { identity: undefined, url: value, scope: "unsupported" };
  }
};

const permissionFeatures = (value: string | undefined): string[] =>
  [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((entry) =>
          trimHttpWhitespace(entry.split("=", 1)[0] ?? "").toLowerCase(),
        )
        .filter((feature) => /^[a-z][a-z0-9\x2d]*$/u.test(feature)),
    ),
  ].sort();

const wellKnownHint = (url: string): AgentHint[] => {
  try {
    const path = new URL(url).pathname;
    return wellKnownAgentPaths.has(path)
      ? [agentHint("well_known_resource", path, sanitizeBrowserUrl(url).url)]
      : [];
  } catch (cause: unknown) {
    // Non-URL input yields no well-known hint.
    void cause;
    return [];
  }
};

const agentHint = (
  mechanism: AgentHint["mechanism"],
  declaration: string,
  url: string | null,
): AgentHint => ({
  mechanism,
  declaration,
  url,
  trust: "page-declared-untrusted",
});

const isAgentRel = (value: string): boolean =>
  ["mcp", "model-context", "ai-plugin", "service-desc"].includes(value);

const referrerPolicies = new Set([
  "no-referrer",
  "no-referrer-when-downgrade",
  "same-origin",
  "origin",
  "strict-origin",
  "origin-when-cross-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url",
]);

const referrerPolicy = (value: string | undefined): string | null => {
  let policy: string | null = null;
  for (const raw of (value ?? "").split(",")) {
    const token = trimHttpWhitespace(raw);
    if (token === "") continue;
    // Fetch header extraction first validates Referrer-Policy's ABNF;
    // only syntactically valid extension tokens can be ignored as unknown.
    if (!/^[A-Za-z\x2d]+$/u.test(token)) return null;
    if (referrerPolicies.has(token)) policy = token;
  }
  return policy;
};

const policyToken = (value: string | undefined): string | null => {
  const token = trimHttpWhitespace(value ?? "").toLowerCase();
  return /^[a-z][a-z0-9_.\x2d]*$/u.test(token) ? token : null;
};

// RFC 9110 section 8.6: Content-Length = 1*DIGIT. Other spellings declare no length.
const contentLength = (value: string | undefined): number | null => {
  const token = trimHttpWhitespace(value ?? "");
  if (!/^[0-9]+$/u.test(token)) return null;
  const length = Number(token);
  return Number.isSafeInteger(length) ? length : null;
};

const boundedHeader = (value: string | undefined): string | null =>
  value === undefined ? null : trimHttpWhitespace(value).toLowerCase();

// RFC 9110 section 8.3.1: type/subtype are case-insensitive; parameters may not be.
const mediaTypeDeclaration = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const declaration = trimHttpWhitespace(value);
  const separator = declaration.indexOf(";");
  return separator < 0
    ? declaration.toLowerCase()
    : declaration.slice(0, separator).toLowerCase() +
        declaration.slice(separator);
};

const decodeLinkParameter = (value: string): string => {
  if (!value.startsWith('"')) return value;
  let decoded = "";
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      index += 1;
      if (index >= value.length) return decoded;
      decoded += value[index];
    } else if (character === '"') {
      return decoded;
    } else {
      decoded += character;
    }
  }
  return decoded;
};

const agentHeaderNames = ["x-model-context", "x-webmcp", "mcp-server"] as const;
const wellKnownAgentPaths: ReadonlySet<string> = new Set([
  "/.well-known/ai-plugin.json",
  "/.well-known/mcp",
  "/.well-known/model-context",
]);
