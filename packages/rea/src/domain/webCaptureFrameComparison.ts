import type { WebPageInspection } from "./browserObservationSchemas.js";
import { digestCanonicalValue } from "./canonicalDigest.js";

/** Frame-forest invariant. The code is the stable identity. */
class WebCaptureFrameError extends Error {
  readonly _tag = "WebCaptureFrameError";

  constructor(readonly code: "missing_ready_frame" | "missing_parent_frame") {
    super(code);
    this.name = "WebCaptureFrameError";
  }
}

/** Compare complete frame forests without treating capture-local IDs as identity. */
export const fingerprintWebCaptureFrames = (
  frames: WebPageInspection["frames"],
): string | null => {
  const byId = new Map(frames.map((frame) => [frame.frame_id, frame]));
  if (byId.size !== frames.length) return null;
  const remaining = new Map(frames.map((frame) => [frame.frame_id, 0]));
  for (const frame of frames) {
    if (frame.parent_frame_id === null) continue;
    const count = remaining.get(frame.parent_frame_id);
    if (count === undefined) return null;
    remaining.set(frame.parent_frame_id, count + 1);
  }
  const ready = frames.filter((frame) => remaining.get(frame.frame_id) === 0);
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  let examined = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const frame = ready[index];
    if (frame === undefined)
      throw new WebCaptureFrameError("missing_ready_frame");
    const fingerprint = digestCanonicalValue({
      url: frame.url,
      origin: frame.origin,
      children: (children.get(frame.frame_id) ?? []).sort(),
    });
    examined += 1;
    const parentId = frame.parent_frame_id;
    if (parentId === null) {
      roots.push(fingerprint);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(fingerprint);
    children.set(parentId, siblings);
    const count = (remaining.get(parentId) ?? 0) - 1;
    remaining.set(parentId, count);
    if (count === 0) {
      const parent = byId.get(parentId);
      if (parent === undefined)
        throw new WebCaptureFrameError("missing_parent_frame");
      ready.push(parent);
    }
  }
  // Cyclic ancestry never reaches the leaf queue and cannot prove equality.
  return examined === frames.length ? digestCanonicalValue(roots.sort()) : null;
};
