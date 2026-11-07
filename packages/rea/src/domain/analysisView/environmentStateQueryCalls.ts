import type { StateRecordChronology } from "./StateRecordChronology.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { identifierWords } from "./environmentStateWords.js";
import type { JsonValue } from "../jsonValue.js";
import {
  changesState,
  isObject,
  isParam,
  isStateWrite,
  QUERY_SEGMENTS,
  segmentsOf,
  type StateRecordFacts,
  type StateToolFacts,
} from "./environmentStateRules.js";
import { isAbsence } from "./environmentStateWriteChecks.js";
import { prefixRelated } from "./environmentStateWriteRules.js";
import { ENTRY_BYTES, textBytes } from "./webNetworkRouteTemplates.js";

/** The words of a segment or operation name. */
const words = identifierWords;

/** Path words that name a lookup rather than a change. */
const QUERY_WORDS = new Set([
  ...[...QUERY_SEGMENTS].flatMap(words),
  "ids",
  "selection",
  "discover",
]);
/** Trailing words that only qualify what a segment names, so the word before them decides. */
const NEUTRAL_WORDS = new Set(["data", "info", "results"]);
/** Whole path segments that renew or open a session rather than change state. */
const SESSION_SEGMENTS = new Set([
  "auth-refresh",
  "auth-with-password",
  "login",
  "logout",
  "refresh",
  "token",
]);
const READ_OPERATION_WORDS = new Set([
  "list",
  "get",
  "count",
  "aggregate",
  "info",
  "search",
  "find",
  "read",
  "query",
  "schema",
  "describe",
  "fetch",
  "lookup",
]);
const WRITE_OPERATION_WORDS = new Set([
  "create",
  "insert",
  "update",
  "modify",
  "replace",
  "delete",
  "remove",
  "upsert",
  "add",
  "set",
  "save",
  "patch",
  "put",
  "post",
  "write",
  "move",
  "copy",
  "duplicate",
  "import",
  "run",
  "execute",
  "trigger",
  "send",
  "reset",
  "clear",
  "archive",
  "restore",
]);
/** Operation names that only wrap the operations a request body names. */
const OPERATION_CONTAINERS = new Set(["batch", "bulk", "multi"]);
const OPERATION_PARAMETERS = ["operation", "op", "action"];

/** What deciding read-only calls reads besides the tools and the timeline. */
export interface QueryCallIo {
  /** Parse one response body and hand it to `use` while its parse is charged; unusable bodies arrive undefined. */
  readonly withBody: <T>(
    ordinal: number,
    use: (body: JsonValue | undefined) => T,
  ) => T;
  readonly request: (ordinal: number) => JsonValue | undefined;
  readonly retain: (bytes: number) => void;
}

/** Each response body's canonical digest, taken once while its parse is charged and charged itself once kept; undefined when unusable. */
const responseDigests = (
  io: QueryCallIo,
): ((ordinal: number) => string | undefined) => {
  const digests = new Map<number, string | undefined>();
  return (ordinal) => {
    if (digests.has(ordinal)) return digests.get(ordinal);
    const digest = io.withBody(ordinal, (body) =>
      body === undefined
        ? undefined
        : digestCanonicalValue(body, "Environment state"),
    );
    io.retain(ENTRY_BYTES + textBytes(digest?.length ?? 0));
    digests.set(ordinal, digest);
    return digest;
  };
};

const succeeded = (record: StateRecordFacts): boolean =>
  record.status !== null && record.status >= 200 && record.status < 300;

/** A call that may have changed state without a 2xx answer saying what it did: redirected or unanswered. */
const unresolved = (record: StateRecordFacts): boolean =>
  isStateWrite(record) && !succeeded(record);

/** Whether a name is an operation's: a string that is no container wrapping others. */
const isOperation = (name: JsonValue | undefined): name is string =>
  typeof name === "string" && !OPERATION_CONTAINERS.has(name.toLowerCase());

/** The names among these that are operations rather than containers wrapping them. */
const realOperations = (names: readonly (JsonValue | undefined)[]): string[] =>
  names.filter(isOperation);

/**
 * The operations an RPC call names: its body's `operation` or `operations[].operation`, else its
 * query's, containers aside. Undefined when `operations` is no list or one of its entries names no
 * operation of its own: no string, or another container.
 */
const operationsOf = (
  record: StateRecordFacts,
  body: JsonValue | undefined,
): string[] | undefined => {
  const listed = isObject(body) ? body.operations : undefined;
  const entries = Array.isArray(listed)
    ? listed.map((entry) => (isObject(entry) ? entry.operation : undefined))
    : [];
  if (
    (listed !== undefined && !Array.isArray(listed)) ||
    !entries.every(isOperation)
  )
    return undefined;
  const named = isObject(body)
    ? realOperations([body.operation, ...entries])
    : [];
  if (named.length > 0) return named;
  const query = new URLSearchParams(record.query ?? "");
  return realOperations(
    OPERATION_PARAMETERS.flatMap((name) => query.getAll(name)),
  );
};

/** An operation that reads: it names a read word and no write word. */
const readsOnly = (operation: string): boolean => {
  const named = words(operation);
  return (
    named.some((word) => READ_OPERATION_WORDS.has(word)) &&
    !named.some((word) => WRITE_OPERATION_WORDS.has(word))
  );
};

/**
 * POST tools whose recorded calls read state rather than change it, by the strongest evidence that
 * applies: a response repeating the latest read of the same path finished before it, with no write
 * between, an RPC tunnel naming only read operations, a last path word naming a lookup, or a session
 * segment. A tool with a redirected or unanswered call stays a write, as does one a read line its
 * path relates to changes across or finds gone after, no write but the other read-only tools' calls between.
 */
export const readOnlyTools = (
  tools: readonly StateToolFacts[],
  records: readonly StateRecordFacts[],
  io: QueryCallIo,
  chronology: StateRecordChronology,
): Set<string> => {
  const position = chronology.positions;
  const response = responseDigests(io);
  /** The timeline indexes of the nearest state writes either side of an index, the skipped calls aside: -1 and the length when none, found in one pass each way. */
  const nearestWrites = (
    skip: ReadonlySet<number>,
  ): Pick<Timeline, "writes" | "isWrite"> => {
    const writes = records.map(
      (record) => !skip.has(record.ordinal) && isStateWrite(record),
    );
    const before: number[] = [];
    const after: number[] = Array.from({ length: records.length });
    for (let index = 0, last = -1; index < records.length; index += 1) {
      before.push(last);
      if (writes[index]) last = index;
    }
    for (
      let index = records.length - 1, next = records.length;
      index >= 0;
      index -= 1
    ) {
      after[index] = next;
      if (writes[index]) next = index;
    }
    return {
      writes: (at) => ({ before: before[at]!, after: after[at]! }),
      isWrite: (index) => writes[index]!,
    };
  };
  const candidates = new Map<string, readonly StateRecordFacts[]>();
  for (const tool of tools) {
    if (
      tool.method !== "POST" ||
      !changesState(tool.method, tool.path_template)
    )
      continue;
    const calls = tool.record_ordinals
      .map((ordinal) => records[position.get(ordinal) ?? -1])
      .filter((record): record is StateRecordFacts => record !== undefined);
    if (!calls.some(succeeded) || calls.some(unresolved)) continue;
    const timeline = {
      position,
      chronology,
      ...nearestWrites(new Set(tool.record_ordinals)),
      response,
    };
    if (
      repeatsRead(calls, records, timeline) ||
      namesReadOperations(calls, io) ||
      namesLookup(tool.path_template)
    )
      candidates.set(tool.name, calls);
  }
  // No candidate's call explains a read change across another's, so drop vetoed candidates until none is.
  for (let vetoed = true; vetoed;) {
    const timeline = {
      position,
      chronology,
      ...nearestWrites(
        new Set([...candidates.values()].flat().map((call) => call.ordinal)),
      ),
      response,
    };
    vetoed = false;
    for (const [name, calls] of candidates)
      if (changesReadsAcross(calls, records, timeline)) {
        candidates.delete(name);
        vetoed = true;
      }
  }
  return new Set(candidates.keys());
};

interface Timeline {
  readonly chronology: StateRecordChronology;
  readonly position: ReadonlyMap<number, number>;
  /** The nearest other writes either side of a timeline index. */
  readonly writes: (at: number) => {
    readonly before: number;
    readonly after: number;
  };
  /** Whether the record at a timeline index is another write. */
  readonly isWrite: (index: number) => boolean;
  /** A response body's canonical digest; undefined when unusable. */
  readonly response: (ordinal: number) => string | undefined;
}

/** Of these reads, the one that finished last before `call` began, a later one on a tie; records come in start order. */
const lastFinishedBefore = (
  reads: readonly StateRecordFacts[],
  call: StateRecordFacts,
  chronology: StateRecordChronology,
): StateRecordFacts | undefined => {
  let latest: StateRecordFacts | undefined;
  for (const read of reads)
    if (
      chronology.completedBefore(read, call) &&
      (latest === undefined ||
        chronology.endMs(read)! >= chronology.endMs(latest)!)
    )
      latest = read;
  return latest;
};

/** Every successful call answers as the successful GET of its path that finished last before it began, of those since the last other write, did. */
const repeatsRead = (
  calls: readonly StateRecordFacts[],
  records: readonly StateRecordFacts[],
  { position, isWrite, response, chronology }: Timeline,
): boolean => {
  const answering = calls.filter(succeeded);
  const reads = lastReads(answering, records, position, isWrite, chronology);
  return answering.every((call) => {
    const read = reads.get(call.ordinal);
    if (read === undefined) return false;
    const answered = response(call.ordinal);
    return answered !== undefined && answered === response(read.ordinal);
  });
};

/**
 * Each call's successful GET of its path that finished last before it began, of those since the last
 * other write, in one sweep: a path's reads wait by end time until a call's start passes them.
 */
const lastReads = (
  calls: readonly StateRecordFacts[],
  records: readonly StateRecordFacts[],
  position: ReadonlyMap<number, number>,
  isWrite: (index: number) => boolean,
  chronology: StateRecordChronology,
): Map<number, StateRecordFacts> => {
  const paths = new Set(calls.map((call) => call.path));
  const callAt = new Map(
    calls.map((call) => [position.get(call.ordinal)!, call]),
  );
  const lastCall = calls.reduce(
    (latest, call) => Math.max(latest, position.get(call.ordinal)!),
    -1,
  );
  const waiting = new Map<string, ReadsByEnd>();
  const latest = new Map<string, StateRecordFacts>();
  const found = new Map<number, StateRecordFacts>();
  for (let index = 0; index <= lastCall; index += 1) {
    const record = records[index]!;
    const call = callAt.get(index);
    if (call !== undefined && chronology.startMs(call) !== undefined) {
      const ready = waiting.get(call.path);
      for (
        let read = ready?.popEndedBy(chronology.startMs(call)!);
        read !== undefined;
        read = ready?.popEndedBy(chronology.startMs(call)!)
      )
        latest.set(call.path, read);
      const read = latest.get(call.path);
      if (read !== undefined) found.set(call.ordinal, read);
    } else if (isWrite(index)) {
      waiting.clear();
      latest.clear();
    } else if (
      record.method === "GET" &&
      succeeded(record) &&
      paths.has(record.path) &&
      chronology.endMs(record) !== undefined
    ) {
      const heap =
        waiting.get(record.path) ?? new ReadsByEnd(position, chronology);
      heap.push(record);
      waiting.set(record.path, heap);
    }
  }
  return found;
};

/** Reads in a binary heap by end time, then timeline position, so the one that finished first comes out first. */
class ReadsByEnd {
  readonly #reads: StateRecordFacts[] = [];

  constructor(
    private readonly position: ReadonlyMap<number, number>,
    private readonly chronology: StateRecordChronology,
  ) {}

  #before(left: StateRecordFacts, right: StateRecordFacts): boolean {
    return (
      this.chronology.endMs(left)! < this.chronology.endMs(right)! ||
      (this.chronology.endMs(left) === this.chronology.endMs(right) &&
        this.position.get(left.ordinal)! < this.position.get(right.ordinal)!)
    );
  }

  push(read: StateRecordFacts): void {
    const reads = this.#reads;
    reads.push(read);
    for (let at = reads.length - 1; at > 0;) {
      const parent = (at - 1) >>> 1;
      if (!this.#before(reads[at]!, reads[parent]!)) break;
      [reads[at], reads[parent]] = [reads[parent]!, reads[at]!];
      at = parent;
    }
  }

  /** The read that finished first, when it finished by `time`. */
  popEndedBy(time: number): StateRecordFacts | undefined {
    const reads = this.#reads;
    const first = reads[0];
    if (first === undefined || this.chronology.endMs(first)! > time)
      return undefined;
    const last = reads.pop()!;
    if (reads.length > 0) {
      reads[0] = last;
      for (let at = 0; ;) {
        const [left, right] = [at * 2 + 1, at * 2 + 2];
        let next = at;
        if (left < reads.length && this.#before(reads[left]!, reads[next]!))
          next = left;
        if (right < reads.length && this.#before(reads[right]!, reads[next]!))
          next = right;
        if (next === at) break;
        [reads[at], reads[next]] = [reads[next]!, reads[at]!];
        at = next;
      }
    }
    return first;
  }
}

/** Every call names only read operations. */
const namesReadOperations = (
  calls: readonly StateRecordFacts[],
  io: QueryCallIo,
): boolean =>
  calls.every((call) => {
    const operations = operationsOf(call, io.request(call.ordinal));
    return (
      operations !== undefined &&
      operations.length > 0 &&
      operations.every(readsOnly)
    );
  });

/** The path's last literal segment is a session segment, or names a lookup by its last meaningful word and no write word. */
const namesLookup = (template: string): boolean => {
  const last = segmentsOf(template).findLast((segment) => !isParam(segment));
  if (last === undefined) return false;
  return (
    SESSION_SEGMENTS.has(last.toLowerCase()) ||
    (QUERY_WORDS.has(lastMeaningfulWord(last) ?? "") &&
      !words(last).some((word) => WRITE_OPERATION_WORDS.has(word)))
  );
};

/** A segment's last word that is not a trailing neutral word: `selection_data` names a selection, `query-history` a history. */
const lastMeaningfulWord = (segment: string): string | undefined =>
  words(segment).findLast((word) => !NEUTRAL_WORDS.has(word));

/**
 * A GET line whose path a call's path relates to reads differently, or finds its entity present on one
 * side only, just before and just after it, with no other write between: the read that finished last
 * before it began and the first begun after it ended, since one overlapping it may show either state.
 * Calls in one write-free stretch under one path share a pass over it, and only lines whose reads
 * there disagree can change across a call.
 */
const changesReadsAcross = (
  calls: readonly StateRecordFacts[],
  records: readonly StateRecordFacts[],
  { position, writes, response, chronology }: Timeline,
): boolean => {
  const stretches = new Map<
    string,
    { from: number; to: number; path: string; calls: StateRecordFacts[] }
  >();
  for (const call of calls.filter(succeeded)) {
    const { before, after } = writes(position.get(call.ordinal)!);
    const key = JSON.stringify([before, after, call.path]);
    const stretch = stretches.get(key);
    if (stretch === undefined)
      stretches.set(key, {
        from: before,
        to: after,
        path: call.path,
        calls: [call],
      });
    else stretch.calls.push(call);
  }
  for (const stretch of stretches.values())
    if (changesInStretch(stretch, records, { position, response, chronology }))
      return true;
  return false;
};

/** Whether a related line changes across one of these calls, all between the same two writes under one path. */
const changesInStretch = (
  stretch: {
    readonly from: number;
    readonly to: number;
    readonly path: string;
    readonly calls: readonly StateRecordFacts[];
  },
  records: readonly StateRecordFacts[],
  {
    position,
    response,
    chronology,
  }: Pick<Timeline, "position" | "response" | "chronology">,
): boolean => {
  const shown = (record: StateRecordFacts): string | symbol =>
    succeeded(record) ? (response(record.ordinal) ?? UNKNOWN) : ABSENT;
  const lines = new Map<string, StateRecordFacts[]>();
  for (let index = stretch.from + 1; index < stretch.to; index += 1) {
    const record = records[index]!;
    if (
      record.method !== "GET" ||
      !(succeeded(record) || isAbsence(record.status)) ||
      !prefixRelated(stretch.path, record.path)
    )
      continue;
    const line = `${record.path}${record.query ?? ""}`;
    const reads = lines.get(line);
    if (reads === undefined) lines.set(line, [record]);
    else reads.push(record);
  }
  // A line whose reads all show one thing cannot change across any call.
  const changing = [...lines.values()].filter((reads) => {
    const first = shown(reads[0]!);
    return reads.some((read) => shown(read) !== first);
  });
  return stretch.calls.some((call) => {
    const at = position.get(call.ordinal)!;
    return changing.some((reads) => {
      const earlier = lastFinishedBefore(
        reads.filter((read) => position.get(read.ordinal)! < at),
        call,
        chronology,
      );
      const later = reads.find(
        (read) =>
          position.get(read.ordinal)! > at &&
          chronology.completedBefore(call, read),
      );
      if (earlier === undefined || later === undefined) return false;
      const [was, now] = [shown(earlier), shown(later)];
      // Presence on one side only is a change even when a body is unusable.
      if ((was === ABSENT) !== (now === ABSENT)) return true;
      return was !== UNKNOWN && now !== UNKNOWN && was !== now;
    });
  });
};

/** A read that found its entity gone, and one whose body is unusable. */
const ABSENT = Symbol("absent");
const UNKNOWN = Symbol("unknown");

/** The timeline's state writes, less the calls of tools whose calls only read, and those tools. */
export const stateWritesOf = (
  tools: readonly StateToolFacts[],
  records: readonly StateRecordFacts[],
  io: QueryCallIo,
  chronology: StateRecordChronology,
): {
  readonly readOnly: ReadonlySet<string>;
  readonly writes: readonly StateRecordFacts[];
} => {
  const readOnly = readOnlyTools(tools, records, io, chronology);
  const reads = new Set(
    tools
      .filter((tool) => readOnly.has(tool.name))
      .flatMap((tool) => tool.record_ordinals),
  );
  return {
    readOnly,
    writes: records.filter(
      (record) => isStateWrite(record) && !reads.has(record.ordinal),
    ),
  };
};
