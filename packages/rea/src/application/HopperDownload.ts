/** Download result; HTTP failures may carry their observed status for diagnostics. */
export interface HopperDownload {
  readonly ok: boolean;
  readonly bytes: Uint8Array;
  readonly httpStatus?: number;
}

/** Maximum admitted vendor response bytes, shared by Hopper setup adapters. */
export const HOPPER_DOWNLOAD_BYTES = 100_000_000;

/** Bound observed response bytes before retaining them, including chunked bodies. */
export const downloadHopperPackage = async (
  url: string,
  options: {
    readonly signal?: AbortSignal;
    readonly maxBytes?: number;
    readonly timeoutMs?: number;
  } = {},
): Promise<HopperDownload> => {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000)
    throw new RangeError("Invalid Hopper response time budget");
  const deadline = AbortSignal.timeout(timeoutMs);
  const maxBytes = options.maxBytes ?? HOPPER_DOWNLOAD_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > HOPPER_DOWNLOAD_BYTES
  )
    throw new RangeError("Invalid Hopper response byte budget");
  const response = await fetchHopperResponse(
    url,
    options.signal === undefined
      ? deadline
      : AbortSignal.any([options.signal, deadline]),
  );
  const refused = { ok: false, bytes: new Uint8Array() };
  if (response === undefined) return refused;
  if (!response.ok) {
    await response.body?.cancel();
    return Number.isInteger(response.status) &&
      response.status >= 300 &&
      response.status <= 599
      ? { ...refused, httpStatus: response.status }
      : refused;
  }
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    return refused;
  }
  if (response.body === null) return { ok: true, bytes: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return { ok: true, bytes: Buffer.concat(chunks, bytes) };
      if (chunk.value.byteLength > maxBytes - bytes) {
        await reader.cancel();
        return refused;
      }
      chunks.push(chunk.value);
      bytes += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
};

// HTTP-redirect fetch admits at most 20 redirects; retain that existing Fetch
// bound while checking each destination before the next request.
const FETCH_REDIRECT_LIMIT = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const fetchHopperResponse = async (
  url: string,
  signal: AbortSignal,
): Promise<Response | undefined> => {
  let selected: URL;
  try {
    selected = new URL(url);
  } catch {
    return undefined;
  }
  let requested = url;
  for (let redirects = 0; ; redirects++) {
    if (selected.protocol !== "https:") return undefined;
    const response = await fetch(requested, {
      redirect: "manual",
      headers: { accept: "application/json", "user-agent": "rea-installer" },
      signal,
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (location === null || redirects === FETCH_REDIRECT_LIMIT)
      return undefined;
    let next: URL;
    try {
      next = new URL(location, selected);
    } catch {
      return undefined;
    }
    // Fetch inherits the previous fragment when Location has none.
    if (!location.includes("#")) next.hash = selected.hash;
    selected = next;
    requested = next.href;
  }
};
