/** Numeric admission contracts shared by environment parsing and runtime tools.
 * Timer maxima follow signed 32-bit scheduling. ASAR's 256 MiB maximum and
 * worker 16 GiB maxima are REA policies, not claims about format/host capacity.
 * Regex's 7 MiB floor is measured; decoder's 8 MiB floor matches its semi-space.
 */
/** Header/index bytes admitted when the setting is unset. */
export const DEFAULT_ASAR_MAX_HEADER_BYTES = 16 * 1024 * 1024;

/**
 * Largest configurable admission. The header JSON is decoded into one string
 * and parsed in memory; 256 MiB keeps that text and its parse copy well below
 * Node's single-string ceiling of about 512 Mi UTF-16 code units. A lower value
 * only refuses more archives, so the setting has no floor.
 */
export const MAXIMUM_ASAR_MAX_HEADER_BYTES = 256 * 1024 * 1024;

/** Native function-matching representation admitted when the setting is unset. */
export const DEFAULT_NATIVE_MATCHING_REPRESENTATION_BYTES = 96 * 1024 * 1024;

/**
 * Largest configurable matching admission. This is an REA policy ceiling, not
 * a claim about host capacity: the allowance approximates the heap
 * representation matching retains, and peak heap during a request can exceed
 * it. A lower value only refuses more requests, so the setting has no floor.
 */
export const MAXIMUM_NATIVE_MATCHING_REPRESENTATION_BYTES = 1024 * 1024 * 1024;

/** Default absolute deadline for Ghidra import, analysis, bridge, and readiness. */
export const DEFAULT_GHIDRA_STARTUP_TIMEOUT_MS = 330_000;

/** Default absolute deadline for Hopper launch, analysis, bridge, and readiness. */
export const DEFAULT_HOPPER_STARTUP_TIMEOUT_MS = 120_000;

/**
 * Default wall-clock budget for one Hopper caller-scan reconciliation, in
 * milliseconds. The first page always runs; a later page is not requested
 * after this budget.
 */
export const DEFAULT_HOPPER_CALLER_SCAN_BUDGET_MS = 2_000;

/** Smallest caller-scan budget. Zero is not a deadline. */
export const MINIMUM_HOPPER_CALLER_SCAN_BUDGET_MS = 1;

/**
 * Largest delay Node schedules exactly. Delays above this signed 32-bit
 * boundary become a 1 ms timer, so startup and swiftc timeouts stop here.
 */
export const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Ghidra 12.1.4 converts whole seconds to a signed int millisecond delay.
 * Keep that multiplication positive and exact rather than imposing a day cap.
 */
export const MAX_GHIDRA_DECOMPILE_TIMEOUT_SECONDS = Math.floor(
  MAX_NODE_TIMER_DELAY_MS / 1000,
);

/** Matching deadline used when the setting is unset. Today's fixed constant. */
export const DEFAULT_REGEX_MATCHING_DEADLINE_MS = 5_000;

/**
 * Largest delay Node schedules exactly. A `setTimeout` delay above this
 * signed 32-bit bound is clamped to 1 ms, so a matching deadline past it
 * would expire immediately. The setting stops here instead of growing
 * without a bound. The floor is 1 ms: zero and negative values are not a
 * deadline.
 */
export const MAXIMUM_REGEX_MATCHING_DEADLINE_MS = 2_147_483_647;

/** Worker old-generation request used when the setting is unset. Today's constant. */
export const DEFAULT_REGEX_WORKER_HEAP_REQUEST_MIB = 128;

/**
 * Smallest request that completes a trivial regex match on supported Node.
 * Linux runs of the production worker (`^a` against `["a"]`, no
 * `NODE_OPTIONS`) return `ERR_WORKER_OUT_OF_MEMORY` at 6 MiB on Node 24.21.0
 * and 24.22.1, and on most runs of 24.11.0, 24.18.0, and 26.0.0. 7 MiB
 * returned that match on Node 22.19.0, 22.23.4, 24.11.0, 24.18.0, 24.21.0,
 * 24.22.1, 26.0.0, and 26.12.1. A lower accepted value passes configuration
 * and then fails the search.
 */
export const MINIMUM_REGEX_WORKER_HEAP_REQUEST_MIB = 7;

/**
 * Largest request one regex worker may make. 16 GiB is the same ceiling REA
 * already uses for an isolated JavaScript analysis worker. A positive Node
 * `--max-old-space-size` can still set a different effective heap; this
 * maximum bounds only the REA request.
 */
export const MAXIMUM_REGEX_WORKER_HEAP_REQUEST_MIB = 16_384;

/** Old-generation mebibytes used when the setting is unset. Today's constant. */
export const DEFAULT_CAPTURE_DECODER_OLD_GENERATION_MIB = 192;

/**
 * Semi-space the owned decoder always passes. It is not a setting. An old
 * generation smaller than this semi-space aborts Node during isolate startup
 * instead of enforcing a heap limit, so the setting's floor is this value.
 */
export const CAPTURE_DECODER_SEMI_SPACE_MIB = 8;

/**
 * Largest old generation one owned decoder may request. 16 GiB is the same
 * ceiling REA already uses for an isolated JavaScript analysis worker. Node
 * will start with a larger flag; this maximum is REA's refusal, so one
 * decoder cannot ask for an unbounded old generation.
 */
export const MAXIMUM_CAPTURE_DECODER_OLD_GENERATION_MIB = 16_384;
export const DEFAULT_JADX_OPERATION_TIMEOUT_MS = 120_000;

/**
 * Shared GDB and Rizin command deadline used when the setting is unset.
 * Today's fixed 120 s constant.
 */
export const DEFAULT_DEBUGGER_COMMAND_DEADLINE_MS = 120_000;

/**
 * Smallest command deadline. Zero is not a deadline. The maximum is the
 * largest delay Node schedules exactly; a `setTimeout` delay above that
 * signed 32-bit bound becomes 1 ms.
 */
export const MINIMUM_DEBUGGER_COMMAND_DEADLINE_MS = 1;
export const MAXIMUM_DEBUGGER_COMMAND_DEADLINE_MS = 2_147_483_647;

/** Debugger sessions admitted when the setting is unset. Today's constant. */
export const DEFAULT_DEBUGGER_MAX_SESSIONS = 8;

/**
 * Smallest useful session cap. Zero admits no session. 64 is REA's refusal
 * so one process cannot spawn an unbounded set of debugger processes; it is
 * not a measurement of host process capacity.
 */
export const MINIMUM_DEBUGGER_MAX_SESSIONS = 1;
export const MAXIMUM_DEBUGGER_MAX_SESSIONS = 64;

/** Queued commands admitted on one session when the setting is unset. */
export const DEFAULT_DEBUGGER_MAX_PENDING_COMMANDS = 16;

/**
 * Smallest useful queue. Zero admits no command. 256 is REA's refusal so
 * one session cannot retain an unbounded command queue. Each queued command
 * can also retain output up to the command-output cap.
 */
export const MINIMUM_DEBUGGER_MAX_PENDING_COMMANDS = 1;
export const MAXIMUM_DEBUGGER_MAX_PENDING_COMMANDS = 256;

/** Command output retained when the setting is unset. Today's 16 MiB cap. */
export const DEFAULT_DEBUGGER_MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;

/**
 * Node's single-string ceiling, in UTF-16 code units. This is the same V8
 * bound `MAXIMUM_BRIDGE_MAX_REQUEST_BYTES` leaves room under.
 */
const NODE_MAX_STRING_LENGTH = 536_870_888;

/**
 * `JSON.stringify` encodes U+0000–U+001F as `\uXXXX` (6 code units). Evidence
 * hashing stringifies the retained command output as one string. One mebibyte
 * is reserved for the surrounding evidence document.
 */
const DEBUGGER_OUTPUT_JSON_ESCAPE_CODE_UNITS = 6;
const DEBUGGER_OUTPUT_EVIDENCE_ENVELOPE_CODE_UNITS = 1024 * 1024;

/**
 * Largest configurable command-output retention. A lower value only retains
 * less caller command output, so the floor is one byte. The maximum keeps
 * the worst-case JSON expansion of that text under Node's string ceiling.
 */
export const MINIMUM_DEBUGGER_MAX_COMMAND_OUTPUT_BYTES = 1;
export const MAXIMUM_DEBUGGER_MAX_COMMAND_OUTPUT_BYTES = Math.floor(
  (NODE_MAX_STRING_LENGTH - DEBUGGER_OUTPUT_EVIDENCE_ENVELOPE_CODE_UNITS) /
    DEBUGGER_OUTPUT_JSON_ESCAPE_CODE_UNITS,
);

/**
 * Bytes reserved for debugger control replies (Rizin cleanup readback and
 * GDB startup or detach MI). This is not `REA_DEBUGGER_MAX_COMMAND_OUTPUT_BYTES`:
 * a caller cap below this budget must not truncate those required replies.
 */
export const DEBUGGER_CONTROL_REPLY_BYTES = 16 * 1024 * 1024;
