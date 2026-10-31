import { it } from "vitest";

import { probeProcessCaptureCapability } from "../../../src/process/capture/ProcessCaptureCapability.js";

/**
 * Process-capture tests need real native PTY authority. Probing once at module
 * scope lets the suite declare the requirement declaratively, so an
 * unavailable host reports a visible skip instead of a silent pass with zero
 * assertions. A bare `if (!available) return;` inside the test body made an
 * entire lane report green without executing anything.
 */
export const CAPTURE_CAPABILITY = await probeProcessCaptureCapability();

/** Reason reported for every skipped process-capture test on this host. */
export const CAPTURE_SKIP_REASON = CAPTURE_CAPABILITY.available
  ? false
  : `requires native process-capture authority: ${CAPTURE_CAPABILITY.reason}`;

/** `it` that reports a named skip when the host lacks PTY authority. */
export const itWithCaptureCapability = CAPTURE_CAPABILITY.available
  ? it
  : it.skipIf(CAPTURE_SKIP_REASON);
