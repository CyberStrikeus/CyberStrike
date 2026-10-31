import { constants as bufferConstants } from "node:buffer";
import { getHeapStatistics } from "node:v8";
import { jsonStringByteLength } from "../domain/jsonStringByteLength.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  MAX_SAVED_RESPONSE_CHARACTERS,
  MAX_SAVED_RESPONSE_BYTES,
  responsePointerValue,
  parseScenarioValueJson,
  readResponseValues,
  readBoundedResponseBody,
} from "./BrowserScenarioResponseValues.js";
import type { Page, Request, Route } from "playwright-core";

import {
  HEADER_FIELD_VALUE,
  SAVED_PLACEHOLDER,
  validBasicCredentialUsername,
  type BrowserScenarioAction,
  type BrowserScenarioCredentialPart,
  type BrowserScenarioRequestHeader,
  type BrowserScenarioSaveEntry,
  type BrowserScenarioSaveResponse,
} from "../domain/browserScenarioValues.js";
import type { BrowserScenarioSecrets } from "./BrowserScenarioSecrets.js";

type RequestAction = Extract<BrowserScenarioAction, { action: "request" }>;

/** What the page's fetch returned; a redirect is not followed, so its status is unknown. */
type PageResponse =
  | { readonly status: number; readonly body?: string }
  | { readonly redirected: true }
  | { readonly left: string }
  | { readonly error: string };

/** A request step that could not be sent or did not answer as expected. */
export class ScenarioRequestError extends Error {
  override readonly name = "ScenarioRequestError";
}

const originOf = (url: string): string | undefined => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

interface PageValueStep {
  readonly page: Page;
  readonly url: URL;
  readonly stepId: string;
  readonly secrets: BrowserScenarioSecrets;
}

/** Read a value from the page, a cookie or a local storage entry, and redact it from later records under a label. */
const readPageValue = async (
  step: PageValueStep,
  value: Extract<
    BrowserScenarioCredentialPart,
    { source: "cookie" | "local_storage" }
  >,
  label: string,
): Promise<string> => {
  const { page, url, stepId, secrets } = step;
  let read: string | undefined;
  if (value.source === "cookie") {
    const cookies = await page.context().cookies(url.href);
    read = cookies.find((cookie) => cookie.name === value.name)?.value;
    if (read === undefined)
      throw new ScenarioRequestError(
        `Request step ${stepId}: cookie ${value.name} is not set for ${url.origin}.`,
      );
  } else {
    const stored = await page.evaluate(
      ({ key, origin }) => {
        if (
          (globalThis as { readonly location?: { origin: string } }).location
            ?.origin !== origin
        )
          throw new Error(
            "The page moved off the start origin before its local storage was read.",
          );
        return (
          (
            globalThis as {
              readonly localStorage?: { getItem(key: string): string | null };
            }
          ).localStorage?.getItem(key) ?? null
        );
      },
      { key: value.key, origin: url.origin },
    );
    if (stored === null)
      throw new ScenarioRequestError(
        `Request step ${stepId}: local storage has no ${value.key} on ${url.origin}.`,
      );
    if (value.json_pointer === undefined) read = stored;
    else {
      const parsed = parseScenarioValueJson(stored);
      if (!parsed.ok) {
        throw new ScenarioRequestError(
          `Request step ${stepId}: local storage ${value.key} is not JSON.`,
        );
      }
      const selected = responsePointerValue(parsed.value, value.json_pointer);
      if (typeof selected === "number" && !Number.isFinite(selected))
        throw new ScenarioRequestError(
          `Request step ${stepId}: local storage ${value.key} has a number at ${value.json_pointer} that cannot be read exactly.`,
        );
      read =
        typeof selected === "string" || typeof selected === "number"
          ? String(selected)
          : undefined;
      if (read === undefined)
        throw new ScenarioRequestError(
          `Request step ${stepId}: local storage ${value.key} has no string or number at ${value.json_pointer}.`,
        );
    }
  }
  secrets.admitPageValue(label, read);
  return read;
};

/** One part of Basic credentials: a literal, secret or saved value, or a value read from the page. */
const credentialPart = (
  step: PageValueStep,
  part: BrowserScenarioCredentialPart,
  label: string,
): Promise<string> | string =>
  part.source === "cookie" || part.source === "local_storage"
    ? readPageValue(step, part, label)
    : step.secrets.value(part);

/** Resolve one header value; values read from the page, and credentials built from them, are redacted from later records. */
const headerValue = async (
  step: PageValueStep,
  header: BrowserScenarioRequestHeader,
): Promise<string> => {
  const { stepId, secrets } = step;
  const { value } = header;
  const label = `${stepId}.${header.name}`;
  if (
    value.source === "literal" ||
    value.source === "secret" ||
    value.source === "saved"
  )
    return secrets.value(value);
  if (value.source === "basic_credentials") {
    const [username, password] = value.parts;
    const user = await credentialPart(step, username!, `${label}.username`);
    if (!validBasicCredentialUsername(user))
      throw new ScenarioRequestError(
        `Request step ${stepId} has a Basic username with a colon, which the server would read as the end of the username.`,
      );
    const pass = await credentialPart(step, password!, `${label}.password`);
    return secrets.basicCredential(label, user, pass);
  }
  return readPageValue(step, value, label);
};

/** Append declared query entries after any literal query the path carries, leaving that query as written. */
const withQuery = (
  url: URL,
  entries: readonly (readonly [string, string])[],
): string => {
  if (entries.length === 0) return url.href;
  const added = entries
    .map(
      ([name, value]) =>
        `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    )
    .join("&");
  // fetch drops the fragment; cut it at its "#" even when nothing follows it.
  const hash = url.href.indexOf("#");
  const base = hash < 0 ? url.href : url.href.slice(0, hash);
  const separator = !base.includes("?")
    ? "?"
    : base.endsWith("?") || base.endsWith("&")
      ? ""
      : "&";
  return `${base}${separator}${added}`;
};

/** What a request step sends: the URL, the origin it must be sent from, and the call. */
interface PageRequest {
  readonly url: string;
  readonly origin: string;
  readonly method: string;
  readonly headers: [string, string][];
  readonly body: string | undefined;
  readonly deadline: number | undefined;
  /** Return the response text up to this many characters, for a step that saves values from it. */
  readonly readLimit: number | undefined;
}

/** Send the request with the page's own fetch, from the page's main world, and read the whole answer. */
const sendFromPage = (
  page: Page,
  request: PageRequest,
): Promise<PageResponse> =>
  page.evaluate(async (request): Promise<PageResponse> => {
    // The page may have navigated since the origin check; never send from another origin.
    const here = (globalThis as { readonly location?: { origin: string } })
      .location?.origin;
    if (here !== request.origin) return { left: String(here) };
    if (
      (
        globalThis as {
          readonly navigator?: { serviceWorker?: { controller?: unknown } };
        }
      ).navigator?.serviceWorker?.controller
    )
      return {
        error:
          "Request steps require a page without a controlling service worker so cancellation can guard dispatch.",
      };
    const remaining =
      request.deadline === undefined
        ? undefined
        : request.deadline - Date.now();
    if (remaining !== undefined && remaining <= 0)
      return { error: "The request ran out of time before it was sent." };
    const controller = new AbortController();
    const timer =
      remaining === undefined
        ? undefined
        : setTimeout(() => controller.abort(), remaining);
    try {
      const answer = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        credentials: "same-origin",
        redirect: "manual",
        signal: controller.signal,
        ...(request.body === undefined ? {} : { body: request.body }),
      });
      if (answer.type === "opaqueredirect") return { redirected: true };
      if (request.readLimit !== undefined) {
        // Keep the text only up to the limit, so a large answer is never held whole.
        const reader = answer.body?.getReader();
        if (reader === undefined) return { status: answer.status, body: "" };
        const decoder = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        });
        let text = "";
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            text += decoder.decode(chunk.value, { stream: true });
            if (text.length > request.readLimit) {
              await reader.cancel();
              return { status: answer.status };
            }
          }
        } finally {
          reader.releaseLock();
        }
        return { status: answer.status, body: text + decoder.decode() };
      }
      const reader = answer.body?.getReader();
      if (reader !== undefined)
        try {
          while (!(await reader.read()).done) {
            // Wait for completion without retaining a second response body.
          }
        } finally {
          reader.releaseLock();
        }
      return { status: answer.status };
    } catch (cause: unknown) {
      controller.abort();
      return {
        error: cause instanceof Error ? cause.message : String(cause),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }, request);

/**
 * Send one request from the page with its own fetch, cookies and session, as
 * the application's frontend would, and read the whole response so the
 * capture can record it. The page must be on the scenario's start origin.
 */
export const performScenarioRequest = async (input: {
  readonly page: Page;
  readonly action: RequestAction;
  readonly secrets: BrowserScenarioSecrets;
  readonly startOrigin: string;
  readonly signal?: AbortSignal | undefined;
  readonly onOpaqueRedirect?: (() => void) | undefined;
}): Promise<void> => {
  const { page, action, secrets, startOrigin, signal } = input;
  const deadline =
    action.timeout_ms === undefined
      ? undefined
      : Date.now() + action.timeout_ms;
  const pageOrigin = originOf(page.url());
  if (pageOrigin !== startOrigin)
    throw new ScenarioRequestError(
      `Request step ${action.step_id} runs from a page on the start origin ${startOrigin}; navigate back to it with a goto step first.`,
    );
  const url = new URL(withSavedPlaceholders(action.path, secrets), startOrigin);
  if (url.origin !== startOrigin)
    throw new ScenarioRequestError(
      `Request step ${action.step_id} must stay on the start origin ${startOrigin}.`,
    );
  const target = withQuery(
    url,
    action.query.map(({ name, value }) => [name, secrets.value(value)]),
  );
  const step = { page, url, stepId: action.step_id, secrets };
  const headers: [string, string][] = [];
  const envelopeLimit = requestSerializationAllowance();
  let headerBytes = 2;
  const headerValues = new Map<string, number>();
  const appendHeader = (name: string, value: string): void => {
    const knownSize = headerValues.get(value);
    const size =
      knownSize ?? jsonStringByteLength(value, envelopeLimit - headerBytes);
    headerBytes +=
      (headers.length === 0 ? 0 : 1) +
      jsonValueByteLength([name, null], envelopeLimit - headerBytes) -
      4 +
      size;
    if (headerBytes > envelopeLimit) throw requestEnvelopeError();
    if (knownSize === undefined) {
      if (!HEADER_FIELD_VALUE.test(value))
        throw new ScenarioRequestError(
          `Request step ${action.step_id}: the ${name} value holds characters a header cannot carry, such as a line break.`,
        );
      headerValues.set(value, size);
    }
    headers.push([name, value]);
  };
  for (const header of action.headers)
    appendHeader(
      header.name,
      `${header.prefix ?? ""}${await headerValue(step, header)}`,
    );
  const hasContentType = headers.some(
    ([name]) => name.toLowerCase() === "content-type",
  );
  if (action.json !== undefined && !hasContentType)
    appendHeader("content-type", "application/json");
  // A step the boundary abandoned, or whose time ran out while values were read, sends nothing.
  const remaining = deadline === undefined ? undefined : deadline - Date.now();
  if (signal?.aborted === true || (remaining !== undefined && remaining <= 0))
    throw new ScenarioRequestError(
      `Request step ${action.step_id} ran out of time before its request was sent.`,
    );
  if (action.json !== undefined) admitSavedJson(action.json, secrets);
  const json =
    action.json === undefined ? undefined : withSavedJson(action.json, secrets);
  const request = {
    url: target,
    origin: startOrigin,
    method: action.method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    deadline,
    readLimit:
      action.save.length > 0 ? MAX_SAVED_RESPONSE_CHARACTERS : undefined,
  };
  if (
    jsonValueByteLength(
      {
        url: target,
        origin: startOrigin,
        method: action.method,
        headers: [],
        body: request.body ?? null,
        deadline: deadline ?? null,
        readLimit: request.readLimit ?? null,
      },
      envelopeLimit,
    ) +
      headerBytes -
      2 >
    envelopeLimit
  )
    throw requestEnvelopeError();
  // The browser can queue evaluate behind a busy page. Keep a host-side gate
  // until that evaluation settles, including after the step boundary stops
  // waiting. A queued fetch then observes live cancellation at dispatch.
  const dispatchUrl = new URL(target);
  dispatchUrl.hash = "";
  const matches = (url: URL): boolean => url.href === dispatchUrl.href;
  const protectResponse = secrets.responseProtector(
    action.step_id,
    action.save,
  );
  const matchesRequest = (sent: Request): boolean =>
    sent.method() === request.method &&
    sent.postData() === (request.body ?? null);
  let observedRequest: Request | undefined;
  let ambiguousRequest = false;
  const watch = (sent: Request): void => {
    if (sent.url() === dispatchUrl.href && matchesRequest(sent)) {
      if (observedRequest === undefined) observedRequest = sent;
      else if (observedRequest !== sent) ambiguousRequest = true;
      protectResponse?.(sent);
    }
  };
  const gate = async (route: Route): Promise<void> => {
    const sent = route.request();
    if (!matchesRequest(sent)) {
      await route.fallback();
      return;
    }
    if (
      signal?.aborted === true ||
      (deadline !== undefined && Date.now() >= deadline)
    )
      await route.abort("aborted");
    else {
      await route.fallback();
    }
  };
  await page.route(matches, gate);
  if (protectResponse !== undefined) page.on("request", watch);
  let primaryFailure: { readonly cause: unknown } | undefined;
  let response: PageResponse;
  try {
    response = await sendFromPage(page, request);
    if ("error" in response)
      throw new ScenarioRequestError(
        `Request step ${action.step_id} failed in the page: ${response.error}`,
      );
    if ("left" in response)
      throw new ScenarioRequestError(
        `Request step ${action.step_id} runs from a page on the start origin ${startOrigin}; the page moved before the request was sent.`,
      );
    if ("redirected" in response) {
      input.onOpaqueRedirect?.();
      throw new ScenarioRequestError(
        `Request step ${action.step_id} was answered with a redirect, which request steps do not follow; a write may already have been applied. The browser may withhold the redirect status and Location from network capture.`,
      );
    }
    if (
      action.expected_status !== undefined &&
      !action.expected_status.includes(response.status)
    )
      throw new ScenarioRequestError(
        `Request step ${action.step_id} answered ${String(response.status)}; expected ${action.expected_status.join(" or ")}.`,
      );
  } catch (cause: unknown) {
    primaryFailure = { cause };
    throw cause;
  } finally {
    if (protectResponse !== undefined) page.off("request", watch);
    try {
      await page.unroute(matches, gate);
    } catch (cause: unknown) {
      if (primaryFailure !== undefined)
        throw new AggregateError(
          [primaryFailure.cause, cause],
          `Scenario request failed: ${primaryFailure.cause instanceof Error ? primaryFailure.cause.message : String(primaryFailure.cause)}; route cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause: primaryFailure.cause },
        );
      throw cause;
    }
  }
  if (action.save.length > 0) {
    saveValues(action.step_id, response.body, action.save, secrets);
    if (observedRequest !== undefined && !ambiguousRequest)
      secrets.markResponseSecretsReady(observedRequest);
  }
};

/** A URL path segment a URL parser drops or folds into its parent: `.`, `..` or a percent-encoded spelling of one. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/iu;

/** A path or URL with its `placeholder`s filled, each value percent-encoded; a request path's are spelled as written. A filled path segment a URL path would drop as a dot segment fails the step. */
export const withSavedPlaceholders = (
  text: string,
  secrets: BrowserScenarioSecrets,
  placeholder: RegExp = SAVED_PLACEHOLDER,
): string => {
  const limit = requestSerializationAllowance();
  let expandedUnits = text.length;
  if (expandedUnits > limit)
    throw new ScenarioRequestError(
      "Saved URL exceeds the current heap/string serialization allowance.",
    );
  const encoded = new Map<string, string>();
  const fill = (part: string): string =>
    part.replace(placeholder, (matched, name: string) => {
      let replacement = encoded.get(name);
      if (replacement === undefined) {
        const raw = String(secrets.savedValue(name));
        // A UTF-16 unit needs at most nine ASCII characters under URI encoding.
        if (raw.length * 9 > limit)
          throw new ScenarioRequestError(
            "Saved URL encoding exceeds the current heap/string serialization allowance.",
          );
        replacement = encodeURIComponent(raw);
        encoded.set(name, replacement);
      }
      expandedUnits += replacement.length - matched.length;
      if (expandedUnits > limit)
        throw new ScenarioRequestError(
          "Expanded saved URL exceeds the current heap/string serialization allowance.",
        );
      return replacement;
    });
  const pathEnd = text.search(/[?#]/u);
  const path = pathEnd < 0 ? text : text.slice(0, pathEnd);
  // WHATWG special URLs treat literal backslashes as path separators too.
  const filledPath = path.replace(/[^/\\]+/gu, (segment) => {
    const filled = fill(segment);
    if (filled !== segment && DOT_SEGMENT.test(filled))
      throw new Error(
        `A saved value makes the path segment ${JSON.stringify(segment)} a dot segment, which a URL path drops, so the step cannot send it.`,
      );
    return filled;
  });
  return filledPath + (pathEnd < 0 ? "" : fill(text.slice(pathEnd)));
};

/** Whether a request a UI step triggered is the one its `save_response` names: method, start origin, and path with `{*}` matching one segment. */
/** A `save_response` path's segments as a browser spells a URL path, percent-encoded as its URL parser would, `{*}` kept. */
const pathPattern = (path: string): readonly string[] => {
  const pathname = path.split("?")[0]!;
  let wildcard = "~rea-wildcard~";
  while (pathname.includes(wildcard)) wildcard += "~";
  const marked = pathname
    .split(/[\\/]/u)
    .map((segment) => (segment === "{*}" ? wildcard : segment))
    .join("/");
  return new URL(marked, "http://path.invalid").pathname
    .split("/")
    .map((segment) => (segment === wildcard ? "{*}" : segment));
};

const namesResponse = (
  spec: BrowserScenarioSaveResponse,
  pattern: readonly string[],
  startOrigin: string,
  request: { readonly method: string; readonly url: string },
): boolean => {
  if (request.method !== spec.method) return false;
  const url = URL.parse(request.url);
  if (url === null || url.origin !== startOrigin) return false;
  const segments = url.pathname.split("/");
  return (
    segments.length === pattern.length &&
    pattern.every((part, index) => part === "{*}" || part === segments[index])
  );
};

/** Settle as the work does, or fail the step once its deadline passes or it is cancelled, so late work saves nothing. */
const beforeStepEnds = <T>(
  work: Promise<T>,
  stepId: string,
  deadline: number | undefined,
  signal: AbortSignal | undefined,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", end);
    };
    const end = (): void => {
      settle();
      reject(
        new ScenarioRequestError(
          `Step ${stepId} ended before its saved response was read, so nothing was saved.`,
        ),
      );
    };
    work.catch(() => undefined);
    const remaining =
      deadline === undefined ? undefined : deadline - Date.now();
    if (
      signal?.aborted === true ||
      (remaining !== undefined && remaining <= 0)
    ) {
      end();
      return;
    }
    if (remaining !== undefined) timer = setTimeout(end, remaining);
    signal?.addEventListener("abort", end, { once: true });
    work.then(
      (value) => {
        settle();
        resolve(value);
      },
      (cause: unknown) => {
        settle();
        reject(cause);
      },
    );
  });

/** A UI step's wait for the response its `save_response` names: `saved` waits and saves, `stop` stops watching requests. */
export interface SavedResponseWait {
  readonly saved: () => Promise<void>;
  readonly stop: () => void;
}

/**
 * Observe a new matching response while the UI step waits; matching does not prove action causality.
 * Requests already running are excluded. Competing requests observed before binding are ambiguous.
 * The step still requires a 2xx JSON response within its timeout or the page's default timeout.
 */
export const awaitSavedResponse = (
  page: Page,
  step: {
    readonly stepId: string;
    readonly spec: BrowserScenarioSaveResponse;
    readonly startOrigin: string;
    readonly timeout: number | undefined;
    readonly secrets: BrowserScenarioSecrets;
    readonly signal?: AbortSignal | undefined;
  },
): SavedResponseWait => {
  const { stepId, spec, startOrigin, timeout, secrets, signal } = step;
  const deadline = timeout === undefined ? undefined : Date.now() + timeout;
  const pattern = pathPattern(spec.path);
  const started = new Set<Request>();
  const protectResponse = secrets.responseProtector(stepId, spec.save);
  const watch = (request: Request): void => {
    if (
      namesResponse(spec, pattern, startOrigin, {
        method: request.method(),
        url: request.url(),
      })
    ) {
      if (started.size < 2) started.add(request);
      protectResponse?.(request);
    }
  };
  page.on("request", watch);
  const waiting = page.waitForResponse(
    (response) => started.has(response.request()),
    timeout === undefined ? {} : { timeout },
  );
  // The step may fail before it waits; the rejection is reported by the wait, or not at all.
  waiting.catch(() => undefined);
  const saved = async (): Promise<void> => {
    let response: Awaited<typeof waiting>;
    try {
      response = await beforeStepEnds(waiting, stepId, deadline, signal);
    } catch {
      throw new ScenarioRequestError(
        `Step ${stepId}: no ${spec.method} ${spec.path} response arrived before the step's timeout, so nothing was saved.`,
      );
    }
    const assertUnambiguous = (): void => {
      if (started.size !== 1)
        throw new ScenarioRequestError(
          `Step ${stepId}: multiple matching requests make the response ambiguous, so nothing was saved. Narrow the response path or record without competing background requests.`,
        );
    };
    assertUnambiguous();
    if (response.status() < 200 || response.status() > 299)
      throw new ScenarioRequestError(
        `Step ${stepId}: the ${spec.method} ${spec.path} response answered ${String(response.status())}; values are saved only from a 2xx response.`,
      );
    const body = await beforeStepEnds(
      readBoundedResponseBody(response, MAX_SAVED_RESPONSE_BYTES),
      stepId,
      deadline,
      signal,
    );
    if (!body.ok)
      throw new ScenarioRequestError(`Step ${stepId}: ${body.error.message}`);
    assertUnambiguous();
    saveValues(stepId, body.value, spec.save, secrets);
    secrets.markResponseSecretsReady(response.request());
  };
  return { saved, stop: () => page.off("request", watch) };
};

const requestEnvelopeError = (): ScenarioRequestError =>
  new ScenarioRequestError(
    "Expanded request envelope exceeds the current heap/string serialization allowance; reduce repeated values or raise the parent Node heap and restart.",
  );

/** Allow for the expanded tree, stringify, Playwright transport and browser-side copies. */
const REQUEST_JSON_ALLOCATION_FACTOR = 16;
const requestSerializationAllowance = (): number =>
  Math.min(
    bufferConstants.MAX_STRING_LENGTH,
    Math.floor(
      getHeapStatistics().total_available_size / REQUEST_JSON_ALLOCATION_FACTOR,
    ),
  );

/** Count serialization expansion without allocating substituted strings or their serialized copies. */
const admitSavedJson = (
  value: JsonValue,
  secrets: BrowserScenarioSecrets,
): void => {
  const limit = requestSerializationAllowance();
  let bytes = 0;
  const savedSizes = new Map<string, number>();
  const charge = (size: number): void => {
    bytes += size;
    if (bytes > limit)
      throw new ScenarioRequestError(
        `Expanded request JSON exceeds its ${String(limit)}-byte serialization allowance, derived from current V8 heap headroom and the string limit. Reduce payload/repeated saved references, or raise the parent Node heap and restart.`,
      );
  };
  const stringPart = (text: string): void =>
    charge(jsonStringByteLength(text, limit - bytes + 2) - 2);
  const visit = (item: JsonValue): void => {
    if (typeof item === "string") {
      const first = item.matchAll(SAVED_PLACEHOLDER).next().value;
      if (first !== undefined && first[0] === item) {
        const saved = secrets.savedValue(first[1]!);
        if (typeof saved === "number") {
          charge(jsonValueByteLength(saved));
          return;
        }
      }
      charge(2);
      let offset = 0;
      for (const match of item.matchAll(SAVED_PLACEHOLDER)) {
        stringPart(item.slice(offset, match.index));
        const name = match[1]!;
        let size = savedSizes.get(name);
        if (size === undefined) {
          size =
            jsonStringByteLength(
              String(secrets.savedValue(name)),
              limit - bytes + 2,
            ) - 2;
          savedSizes.set(name, size);
        }
        charge(size);
        offset = match.index + match[0].length;
      }
      stringPart(item.slice(offset));
    } else if (Array.isArray(item)) {
      charge(2 + Math.max(0, item.length - 1));
      for (const child of item) visit(child);
    } else if (item !== null && typeof item === "object") {
      charge(2);
      let count = 0;
      for (const key in item) {
        if (!Object.hasOwn(item, key)) continue;
        charge(
          (count++ === 0 ? 0 : 1) +
            jsonStringByteLength(key, limit - bytes) +
            1,
        );
        visit(item[key]!);
      }
    } else charge(jsonValueByteLength(item));
  };
  visit(value);
};

/**
 * The step's JSON body with its `{saved:name}` placeholders filled: a string that is only a placeholder becomes the
 * saved value, keeping its JSON type, and a placeholder inside a longer string is filled as text.
 */
const withSavedJson = (
  value: unknown,
  secrets: BrowserScenarioSecrets,
): unknown => {
  if (typeof value === "string") {
    const [whole] = [...value.matchAll(SAVED_PLACEHOLDER)];
    if (whole !== undefined && whole[0] === value)
      return secrets.savedValue(whole[1]!);
    return value.replace(SAVED_PLACEHOLDER, (_placeholder, name: string) =>
      String(secrets.savedValue(name)),
    );
  }
  if (Array.isArray(value))
    return value.map((item) => withSavedJson(item, secrets));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        withSavedJson(item, secrets),
      ]),
    );
  return value;
};

/** Save the values a step names from a JSON response, for later steps. */
const saveValues = (
  stepId: string,
  body: string | Uint8Array | undefined,
  entries: readonly BrowserScenarioSaveEntry[],
  secrets: BrowserScenarioSecrets,
): void => {
  const selected = readResponseValues(body, entries, "fail");
  if (!selected.ok)
    throw new ScenarioRequestError(`Step ${stepId}: ${selected.error.message}`);
  for (const {
    entry: { name, secret },
    value,
  } of selected.value.values) {
    try {
      secrets.save(`${stepId}.${name}`, name, value, secret);
    } catch (cause) {
      throw new ScenarioRequestError(
        `Step ${stepId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
};
