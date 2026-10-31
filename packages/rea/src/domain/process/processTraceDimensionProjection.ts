import type { ProcessCapture } from "./processCaptureParsing.js";
import type { ProcessObservationSource } from "./processObservation.js";
import type { ProcessComparisonDimension } from "./processComparison.js";
import { processSourceTruncated } from "./processCaptureCoverage.js";

/** Map declared trace sources to process-comparison dimensions. */
export const dimensionsForTraceSources = (
  sources: ReadonlySet<ProcessObservationSource>,
): ReadonlySet<ProcessComparisonDimension> => {
  const dimensions = new Set<ProcessComparisonDimension>();
  for (const source of sources) {
    if (source.startsWith("terminal_")) dimensions.add("terminal");
    else if (source === "interaction") dimensions.add("interaction");
    else if (source === "lifecycle") dimensions.add("exit");
    else if (source === "filesystem") dimensions.add("filesystem");
    else if (source === "process") dimensions.add("process");
  }
  return dimensions;
};

/** Whether a trace specification covers every observed source in a dimension. */
export const traceCoversObservedDimension = (
  dimension: ProcessComparisonDimension,
  sources: ReadonlySet<ProcessObservationSource>,
  left: ProcessCapture,
  right: ProcessCapture,
): boolean => {
  const any = <Value>(
    leftValues: readonly Value[],
    rightValues: readonly Value[],
  ): boolean => leftValues.length > 0 || rightValues.length > 0;
  switch (dimension) {
    case "terminal":
      return (
        (!(
          any(left.frames, right.frames) ||
          processSourceTruncated(left, "terminal_raw") ||
          processSourceTruncated(right, "terminal_raw")
        ) ||
          sources.has("terminal_raw")) &&
        (!(
          any(left.rendered_frames, right.rendered_frames) ||
          processSourceTruncated(left, "terminal_rendered") ||
          processSourceTruncated(right, "terminal_rendered")
        ) ||
          sources.has("terminal_rendered"))
      );
    case "interaction":
      return sources.has("interaction");
    case "exit":
      return sources.has("lifecycle");
    case "filesystem":
      return sources.has("filesystem");
    case "process":
      return sources.has("process");
  }
};
