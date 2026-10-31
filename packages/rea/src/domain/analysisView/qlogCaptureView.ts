import { z } from "zod";
import {
  qlogCaptureFactsSchema,
  type QlogCaptureFacts,
} from "../qlogCapture.js";
import { err, ok, type Result } from "../result.js";
import type { AnalysisError } from "../analysisErrorBase.js";
import { analysisViewInputError } from "./analysisViewErrors.js";
import { pageViewCoverage } from "./analysisViewCoverage.js";

const traceSchema = qlogCaptureFactsSchema.shape.traces.element;
const streamSchema = traceSchema.shape.streams.element;
export const qlogViewContextSchema = qlogCaptureFactsSchema.omit({
  traces: true,
});
export const qlogSummarySchema = qlogViewContextSchema.extend({
  trace_count: z.int().nonnegative(),
  retained_stream_count: z.int().nonnegative(),
  loss_declaration_count: z.int().nonnegative(),
  incomplete_fact_record_count: z.int().nonnegative(),
});

/** Select retained trace facts without copying event inventories or every contribution. */
const pageRequestShape = {
  kind: z.literal("qlog"),
  offset: z.int().nonnegative().default(0),
  limit: z.int().positive().default(64),
};
const traceSelectorShape = { trace_index: z.int().nonnegative() };
const streamSelectorShape = {
  ...traceSelectorShape,
  stream_id: streamSchema.shape.stream_id,
  direction: streamSchema.shape.direction,
};
export const qlogViewRequestSchema = z.discriminatedUnion("facet", [
  z.strictObject({ ...pageRequestShape, facet: z.literal("traces") }),
  z.strictObject({
    ...pageRequestShape,
    ...traceSelectorShape,
    facet: z.literal("streams"),
  }),
  z.strictObject({
    ...pageRequestShape,
    ...traceSelectorShape,
    facet: z.literal("loss-declarations"),
  }),
  z.strictObject({
    ...pageRequestShape,
    ...traceSelectorShape,
    facet: z.literal("incomplete-records"),
  }),
  z.strictObject({
    ...pageRequestShape,
    ...streamSelectorShape,
    facet: z.literal("contributions"),
  }),
  z.strictObject({
    ...pageRequestShape,
    ...streamSelectorShape,
    facet: z.literal("ranges"),
  }),
  z.strictObject({
    ...pageRequestShape,
    ...streamSelectorShape,
    facet: z.literal("final-sizes"),
  }),
]);
export type QlogViewRequest = z.output<typeof qlogViewRequestSchema>;

const traceSummarySchema = traceSchema
  .omit({
    streams: true,
    loss_declarations: true,
    incomplete_fact_records: true,
  })
  .extend({
    stream_count: z.int().nonnegative(),
    loss_declaration_count: z.int().nonnegative(),
    incomplete_fact_record_count: z.int().nonnegative(),
  });
const streamSummarySchema = streamSchema
  .omit({
    contributions: true,
    covered_ranges: true,
    reported_final_sizes: true,
  })
  .extend({
    contribution_count: z.int().nonnegative(),
    covered_range_count: z.int().nonnegative(),
    reported_final_size_count: z.int().nonnegative(),
  });
/** Each page advertises exactly the retained item contract for its facet. */
export const qlogViewPageSchema = z.discriminatedUnion("facet", [
  z.strictObject({
    facet: z.literal("traces"),
    items: z.array(traceSummarySchema),
  }),
  z.strictObject({
    facet: z.literal("streams"),
    items: z.array(streamSummarySchema),
  }),
  z.strictObject({
    facet: z.literal("loss-declarations"),
    items: traceSchema.shape.loss_declarations,
  }),
  z.strictObject({
    facet: z.literal("incomplete-records"),
    items: traceSchema.shape.incomplete_fact_records,
  }),
  z.strictObject({
    facet: z.literal("contributions"),
    items: streamSchema.shape.contributions,
  }),
  z.strictObject({
    facet: z.literal("ranges"),
    items: streamSchema.shape.covered_ranges,
  }),
  z.strictObject({
    facet: z.literal("final-sizes"),
    items: streamSchema.shape.reported_final_sizes,
  }),
]);
type QlogViewPage = z.output<typeof qlogViewPageSchema>;

export const summarizeQlogCapture = (qlog: QlogCaptureFacts) => {
  const { traces, ...context } = qlog;
  return {
    ...context,
    trace_count: traces.length,
    retained_stream_count: traces.reduce(
      (sum, trace) => sum + trace.streams.length,
      0,
    ),
    loss_declaration_count: traces.reduce(
      (sum, trace) => sum + trace.loss_declarations.length,
      0,
    ),
    incomplete_fact_record_count: traces.reduce(
      (sum, trace) => sum + trace.incomplete_fact_records.length,
      0,
    ),
  };
};

const summarizeTrace = ({
  streams,
  loss_declarations,
  incomplete_fact_records,
  ...trace
}: QlogCaptureFacts["traces"][number]) => ({
  ...trace,
  stream_count: streams.length,
  loss_declaration_count: loss_declarations.length,
  incomplete_fact_record_count: incomplete_fact_records.length,
});
const summarizeStream = ({
  contributions,
  covered_ranges,
  reported_final_sizes,
  ...stream
}: QlogCaptureFacts["traces"][number]["streams"][number]) => ({
  ...stream,
  contribution_count: contributions.length,
  covered_range_count: covered_ranges.length,
  reported_final_size_count: reported_final_sizes.length,
});

/** Array offsets refer to retained facts, whose scope remains all recorded events. */
export const projectQlogCapturePage = (
  qlog: QlogCaptureFacts,
  view: QlogViewRequest,
): Result<
  {
    context: z.output<typeof qlogViewContextSchema>;
    page: QlogViewPage;
    coverage: ReturnType<typeof pageViewCoverage>;
  },
  AnalysisError
> => {
  const invalid = (field: string, message: string) =>
    err(
      analysisViewInputError([
        { path: ["view", field], reason: "invalid_value", message },
      ]),
    );
  const slice = <T>(items: readonly T[]) =>
    items.slice(view.offset, view.offset + view.limit);
  let page: QlogViewPage;
  let total: number;
  if (view.facet === "traces") {
    total = qlog.traces.length;
    page = {
      facet: "traces",
      items: slice(qlog.traces).map(summarizeTrace),
    };
  } else {
    const matches = qlog.traces.filter(
      (trace) => trace.trace_index === view.trace_index,
    );
    if (matches.length !== 1)
      return invalid(
        "trace_index",
        "Select one unambiguous retained trace index.",
      );
    const trace = matches[0]!;
    if (view.facet === "streams") {
      total = trace.streams.length;
      page = {
        facet: "streams",
        items: slice(trace.streams).map(summarizeStream),
      };
    } else if (view.facet === "loss-declarations") {
      total = trace.loss_declarations.length;
      page = { facet: view.facet, items: slice(trace.loss_declarations) };
    } else if (view.facet === "incomplete-records") {
      total = trace.incomplete_fact_records.length;
      page = { facet: view.facet, items: slice(trace.incomplete_fact_records) };
    } else {
      const matches = trace.streams.filter(
        (stream) =>
          stream.stream_id === view.stream_id &&
          stream.direction === view.direction,
      );
      if (matches.length !== 1)
        return invalid(
          "stream_id",
          "Select one unambiguous retained stream ID and direction within the trace.",
        );
      const stream = matches[0]!;
      if (view.facet === "contributions") {
        total = stream.contributions.length;
        page = { facet: view.facet, items: slice(stream.contributions) };
      } else if (view.facet === "ranges") {
        total = stream.covered_ranges.length;
        page = { facet: view.facet, items: slice(stream.covered_ranges) };
      } else {
        total = stream.reported_final_sizes.length;
        page = { facet: view.facet, items: slice(stream.reported_final_sizes) };
      }
    }
  }
  const { traces: _traces, ...context } = qlog;
  return ok({
    context,
    page,
    coverage: pageViewCoverage(view.offset, page.items.length, total),
  });
};
