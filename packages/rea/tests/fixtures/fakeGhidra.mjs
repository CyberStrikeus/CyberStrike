import { rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";

const configuration = JSON.parse(
  process.env.REA_GHIDRA_FIXTURE_CONFIG ?? "null",
);
const {
  endpointPath,
  token,
  runId,
  providerVersion,
  profileDigest,
  targetSha256,
  transport,
  mode = "success",
} = configuration ?? {};

if (
  endpointPath === undefined ||
  token === undefined ||
  runId === undefined ||
  providerVersion === undefined ||
  profileDigest === undefined ||
  targetSha256 === undefined ||
  !["unix-socket", "authenticated-loopback-tcp"].includes(transport)
) {
  process.exit(64);
}

const OOME_LINE =
  "ERROR Abort due to Headless analyzer error: Java heap space (HeadlessAnalyzer) java.lang.OutOfMemoryError: Java heap space\n";
// Exceeds the 8 MiB diagnostic retention budget in many small chunks.
const floodStdout = async () => {
  const line = "INFO  fixture analyzer progress line\n";
  const block = line.repeat(Math.ceil((64 * 1024) / line.length));
  for (let written = 0; written < 10.5 * 1024 * 1024;) {
    if (!process.stdout.write(block))
      await new Promise((resolve) => process.stdout.once("drain", resolve));
    written += block.length;
  }
};

// The retention boundary ends exactly at the class-name prefix of a different identifier.
const cutIdentifierAtBudget = async () => {
  const marker = "java.lang.OutOfMemoryError";
  let remaining = 8 * 1024 * 1024 - marker.length;
  const block = Buffer.alloc(64 * 1024, 0x70);
  while (remaining > 0) {
    const part = block.subarray(0, Math.min(remaining, block.length));
    if (!process.stdout.write(part))
      await new Promise((resolve) => process.stdout.once("drain", resolve));
    remaining -= part.length;
  }
  await new Promise((resolve, reject) =>
    process.stdout.write(`${marker}Custom\n`, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  process.exit(74);
};

const writeThen = (stream, text, then) =>
  stream.write(text, () => setTimeout(then, 10));

if (mode === "remote_error" || mode === "remote_startup_error")
  await new Promise((resolve) =>
    process.stdout.write("Fixture launcher startup output\n", resolve),
  );

let endpointPublication;
if (mode === "exit") process.exit(73);
if (mode === "flood_silent") {
  await floodStdout();
  setInterval(() => undefined, 1_000);
} else if (mode === "silent") setInterval(() => undefined, 1_000);
else {
  await rm(endpointPath, { force: true });
  const sockets = new Set();
  let rejectedConnections = 0;
  const server = createServer((socket) => {
    if (
      mode === "reject_all_connections" ||
      (mode === "reject_first_connection" && rejectedConnections++ === 0)
    ) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setEncoding("utf8");
    const state = {
      buffer: { value: "" },
      pings: { value: 0 },
      emittedOome: false,
      mode,
      token,
      runId,
      providerVersion,
      profileDigest,
      targetSha256,
    };
    socket.on("data", (chunk) => onSocketData(socket, server, chunk, state));
  });
  process.on("message", (message) => {
    if (message !== "disconnect") return;
    for (const socket of sockets) socket.destroy();
    process.send?.({ event: "disconnected" });
  });
  if (transport === "unix-socket") server.listen(endpointPath);
  else {
    endpointPublication = (async () => {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (address === null || typeof address === "string") process.exit(65);
      const pending = `${endpointPath}.pending`;
      await writeFile(
        pending,
        `${JSON.stringify({
          host: "127.0.0.1",
          port: address.port,
        })}\n`,
        { flag: "wx" },
      );
      await rename(pending, endpointPath);
    })();
  }
}

const onSocketData = (socket, server, chunk, state) => {
  state.buffer.value += chunk;
  let newline = state.buffer.value.indexOf("\n");
  while (newline >= 0) {
    const line = state.buffer.value.slice(0, newline);
    state.buffer.value = state.buffer.value.slice(newline + 1);
    newline = state.buffer.value.indexOf("\n");
    const request = JSON.parse(line);
    process.send?.({ method: request.method });
    if (request.token !== state.token) {
      socket.end(
        `${JSON.stringify({
          id: request.id,
          ok: false,
          error: { code: "auth", message: "Authentication failed" },
        })}\n`,
      );
      continue;
    }
    handleRequest(socket, server, request, state);
  }
};

/** Tool-request failures that follow process output, as the Ghidra JVM prints them. */
const handleOutputFailure = (socket, state) => {
  const oome = () =>
    writeThen(process.stderr, OOME_LINE, () => process.exit(1));
  if (state.mode === "prefix_cut_identifier_exit_tools")
    void cutIdentifierAtBudget();
  else if (state.mode === "oom_exit_tools") oome();
  else if (state.mode === "sigkill_tools")
    writeThen(process.stdout, "WARN Decompiling 14005c790, pcode error\n", () =>
      process.kill(process.pid, "SIGKILL"),
    );
  else if (state.mode === "flood_then_oom_exit_tools")
    void floodStdout().then(oome);
  else if (state.mode === "flood_then_exit_tools")
    void floodStdout().then(() => process.exit(74));
  else if (state.mode === "flood_then_malformed")
    void floodStdout().then(() => socket.write("{invalid\n"));
  else return false;
  return true;
};

const handleRequest = (socket, server, request, state) => {
  if (request.method === "ping") {
    handlePing(socket, request, state);
    return;
  }
  if (
    state.mode === "old_oom_then_malformed" &&
    request.method === "list_documents" &&
    !state.emittedOome
  ) {
    state.emittedOome = true;
    process.stderr.write(
      "ERROR Abort due to Headless analyzer error: Java heap space (HeadlessAnalyzer) java.lang.OutOfMemoryError:\n",
      () => setTimeout(() => handleRequest(socket, server, request, state), 10),
    );
    return;
  }
  if (
    state.mode === "old_oom_then_malformed" &&
    request.method === "list_procedures" &&
    state.emittedOome
  ) {
    process.stderr.write("Current operation diagnostic: 雪\n", () =>
      setTimeout(() => socket.write("{invalid\n"), 10),
    );
    return;
  }
  if (state.mode === "remote_error" && request.method === "list_procedures") {
    writeThen(
      process.stdout,
      "Fixture request rejected: missing procedure\n",
      () =>
        socket.write(
          `${JSON.stringify({
            id: request.id,
            ok: false,
            error: {
              code: "not_found",
              message: "Unknown Ghidra procedure name",
            },
          })}\n`,
        ),
    );
    return;
  }
  if (state.mode === "exit_tools" && request.method !== "shutdown")
    process.exit(74);
  if (
    state.mode === "sigkill_after_first_tool" &&
    request.method !== "shutdown" &&
    (state.toolRequests = (state.toolRequests ?? 0) + 1) > 1
  )
    process.kill(process.pid, "SIGKILL");
  if (request.method !== "shutdown" && handleOutputFailure(socket, state))
    return;
  if (state.mode === "hang_tools" && request.method !== "shutdown") return;
  if (
    state.mode === "unicode_search" &&
    ["search_procedures", "search_strings"].includes(request.method)
  ) {
    const params = request.params;
    const insensitiveLiteral =
      params.mode === "literal" && params.case_sensitive === false;
    // Fixed producer expectations deliberately do not reuse the host derivation.
    const candidates = new Map([
      ["source", "source"],
      ["ſOURCE", "source"],
      ["Σ", null],
    ]);
    const valid = insensitiveLiteral
      ? candidates.has(params.pattern) &&
        Object.hasOwn(params, "literal_ascii_candidate") &&
        params.literal_ascii_candidate === candidates.get(params.pattern)
      : !Object.hasOwn(params, "literal_ascii_candidate");
    if (!valid) {
      socket.write(
        `${JSON.stringify({
          id: request.id,
          ok: false,
          error: {
            code: "invalid_request",
            message: "Literal candidate wire fields drifted",
          },
        })}\n`,
      );
      return;
    }
  }
  if (request.method === "address_to_file_offset") {
    socket.write(
      `${JSON.stringify({ id: request.id, ...fileOffsetReply(request.params.address) })}\n`,
    );
    return;
  }
  const inventory =
    request.method === "list_strings" && state.mode === "fragmented"
      ? [stringItem("0x2000", "fixture 雪🦊")]
      : request.method === "list_strings" && state.mode === "oversized_result"
        ? [stringItem("0x2000", "x".repeat(64 * 1024 * 1024 + 1))]
        : state.mode === "unicode_search" &&
            ["search_procedures", "search_strings"].includes(request.method)
          ? [
              { address: "0x1000", value: "ſource" },
              { address: "0x1001", value: "SOURCE" },
              { address: "0x1002", value: "İource" },
              { address: "0x1003", value: "unrelated" },
            ]
          : inventoryResultFor(request.method, request.params);
  if (inventory !== undefined) {
    const response = `${JSON.stringify({ id: request.id, ok: true, result: inventory })}\n`;
    if (state.mode === "fragmented") {
      const bytes = Buffer.from(response, "utf8");
      const unicodeOffset = bytes.indexOf(Buffer.from("雪", "utf8"));
      const midpoint =
        unicodeOffset >= 0 ? unicodeOffset + 1 : Math.floor(bytes.length / 2);
      socket.write(bytes.subarray(0, midpoint));
      setTimeout(() => socket.write(bytes.subarray(midpoint)), 5);
    } else socket.write(response);
    return;
  }
  if (request.method === "shutdown") {
    socket.end(
      `${JSON.stringify({
        id: request.id,
        ...(state.mode === "shutdown_error"
          ? {
              ok: false,
              error: {
                code: "shutdown_fixture_failure",
                message: `Shutdown denied for ${state.token}: /tmp/password-fixture http://localhost/secret?token=public-value`,
              },
            }
          : {
              ok: true,
              result: {
                shutdown: state.mode !== "invalid_shutdown_ack",
                project_ephemeral: true,
              },
            }),
      })}\n`,
    );
    server.close(() => process.exit(0));
  }
};

const handlePing = (socket, request, state) => {
  if (state.mode === "remote_startup_error") {
    socket.write(
      `${JSON.stringify({
        id: request.id,
        ok: false,
        error: {
          code: "invalid_request",
          message: "Fixture rejected startup handshake",
        },
      })}\n`,
    );
    return;
  }
  state.pings.value += 1;
  if (state.mode === "diagnostic_output" && state.pings.value === 1) {
    const retainedTokenPrefixBytes = Math.floor(state.token.length / 2);
    const preservedMarker = "source=/tmp/local-evidence.bin?cursor=keep&";
    const fillLength = 8 * 1024 * 1024 - retainedTokenPrefixBytes;
    const fill = "x".repeat(fillLength - Buffer.byteLength(preservedMarker));
    process.stderr.write(`${fill}${preservedMarker}`);
    setImmediate(() => {
      process.stderr.write(state.token);
    });
  }
  if (state.mode === "malformed") {
    socket.write("{invalid\n");
    return;
  }
  if (state.mode === "contradictory") {
    socket.write(
      `${JSON.stringify({
        id: request.id,
        ok: false,
        result: { unexpected: true },
        error: { code: "failure", message: "Failed" },
      })}\n`,
    );
    return;
  }
  if (state.mode === "future_id") {
    socket.write(
      `${JSON.stringify({ id: request.id + 10, ok: true, result: null })}\n`,
    );
    return;
  }
  if (state.mode === "hang_after_start" && state.pings.value > 1) return;
  const result = sessionInfo({
    runId: state.runId,
    providerVersion:
      state.mode === "wrong_identity" ? "0.0.0" : state.providerVersion,
    profileDigest: state.profileDigest,
    targetSha256: state.targetSha256,
    timedOut: state.mode === "analysis_timeout",
  });
  const response = `${JSON.stringify({ id: request.id, ok: true, result })}\n`;
  if (state.mode === "fragmented") {
    const split = Math.floor(response.length / 2);
    socket.write(response.slice(0, split));
    setTimeout(() => socket.write(response.slice(split)), 5);
  } else socket.write(response);
};

const sessionInfo = ({
  runId: sessionRunId,
  providerVersion: version,
  profileDigest: digest,
  targetSha256: sha256,
  timedOut,
}) => ({
  name: "REA Ghidra bridge",
  run_id: sessionRunId,
  profile_digest: digest,
  provider: { id: "ghidra", version },
  read_only: transport !== "unix-socket",
  analysis_complete: !timedOut,
  analysis_timed_out: timedOut,
  capabilities: [
    "read_binary_inventory_summary",
    "ping",
    "shutdown",
    "inspect_native_load_image",
    "read_bytes",
    "search_bytes",
    "address_to_file_offset",
    "address_name",
    "list_documents",
    "list_names",
    "list_procedures",
    "list_segments",
    "list_strings",
    "procedure_address",
    "resolve_containing_procedure",
    "search_procedures",
    "search_strings",
    "set_address_name",
    "set_addresses_names",
    "annotate_native_function",
    "inspect_native_data_type",
    "inspect_native_instruction",
    "resolve_native_call_targets",
    "analyze_function",
    "procedure_assembly",
    "procedure_callees",
    "procedure_callers",
    "procedure_info",
    "procedure_pseudo_code",
    "read_function_instructions",
    "procedure_references",
    "xrefs",
  ].filter(
    (value) =>
      transport === "unix-socket" ||
      ![
        "annotate_native_function",
        "set_address_name",
        "set_addresses_names",
      ].includes(value),
  ),
  target: {
    name: "fixture",
    language_id: "x86:LE:64:default",
    compiler_spec_id: "gcc",
    image_base: "0x1000",
    default_address_space: "ram",
    sha256,
  },
});

const inventoryResultFor = (method, params) => {
  switch (method) {
    case "read_binary_inventory_summary":
      return {
        document: "fixture",
        segments: inventoryResultFor("list_segments", {}),
        procedure_count: inventoryResultFor("list_procedures", {}).length,
        string_count: inventoryResultFor("list_strings", {}).length,
      };
    case "search_bytes": {
      const continued = params.cursor === "fixture-second-page";
      const paged = params.limit === 1 && !continued;
      const addresses = continued
        ? ["0x1005"]
        : paged
          ? ["0x1000"]
          : ["0x1000", "0x1005"];
      return {
        matches: addresses.map((address) => ({
          address,
          segment: ".text",
          file_offset: address === "0x1000" ? 0 : 5,
          procedure: { address: "0x1000", name: "fixture_main" },
        })),
        searched: {
          blocks: [
            {
              segment: ".text",
              start: continued ? "0x1005" : "0x1000",
              end: "0x1009",
              bytes: continued ? 5 : 10,
            },
          ],
          bytes: continued ? 5 : 10,
          skipped_uninitialized: [
            {
              segment: BSS_BLOCK.name,
              start: hex(BSS_BLOCK.start),
              end: hex(BSS_BLOCK.start + BSS_BLOCK.size - 1n),
              bytes: Number(BSS_BLOCK.size),
            },
          ],
          skipped_not_loaded: [],
        },
        complete: !paged,
        next_cursor: paged ? "fixture-second-page" : null,
      };
    }
    case "address_name":
      return "fixture_main";
    case "list_documents":
      return ["fixture"];
    case "list_names":
      return [nameItem()];
    case "list_procedures":
      return [procedureItem()];
    case "list_segments":
      return [segmentItem()];
    case "list_strings":
      return [stringItem("0x2000", "fixture value")];
    case "procedure_address":
      return "0x1000";
    case "resolve_containing_procedure":
      return containingProcedureResult();
    case "search_procedures":
      return [procedureSearchItem()];
    case "search_strings":
      return [stringSearchItem()];
    default:
      return undefined;
  }
};

// One owner for the fixture's memory blocks. Each reply uses the production
// bridge's end convention: list_segments reports an exclusive end, byte-search
// coverage an inclusive one, and address_to_file_offset tests containment.
const TEXT_BLOCK = {
  name: ".text",
  start: 0x1000n,
  size: 0x100n,
  fileOffset: 0n,
};
const BSS_BLOCK = {
  name: ".bss",
  start: 0x2000n,
  size: 0x10n,
  fileOffset: null,
};
const FIXTURE_BLOCKS = [TEXT_BLOCK, BSS_BLOCK];
const hex = (value) => `0x${value.toString(16)}`;

const fileOffsetReply = (address) => {
  const digits = /^(?:0[xX])?([0-9a-fA-F]+)$/u.exec(address)?.[1];
  const failure = (code, message) => ({ ok: false, error: { code, message } });
  if (digits === undefined)
    return failure("invalid_request", `Invalid address: ${address}`);
  const value = BigInt(`0x${digits}`);
  const at = hex(value);
  const block = FIXTURE_BLOCKS.find(
    ({ start, size }) => value >= start && value < start + size,
  );
  if (block === undefined)
    return failure(
      "address_unmapped",
      `Address ${at} is outside every Ghidra memory block`,
    );
  if (block.fileOffset === null)
    return failure(
      "address_uninitialized",
      `Address ${at} is in uninitialized Ghidra memory block ${block.name}`,
    );
  return {
    ok: true,
    result: {
      address: at,
      file_offset: Number(block.fileOffset + value - block.start),
    },
  };
};

const nameItem = () => ({
  address: "0x1000",
  value: "fixture_main",
  symbol: {
    primary: true,
    dynamic: false,
    external: false,
    type: "function",
    source: "analysis",
  },
});

const procedureItem = () => ({
  address: "0x1000",
  value: "fixture_main",
  procedure: { external: false, thunk: false, thunk_target: null },
});

const segmentItem = () => ({
  name: TEXT_BLOCK.name,
  start: hex(TEXT_BLOCK.start),
  end: hex(TEXT_BLOCK.start + TEXT_BLOCK.size),
  readable: true,
  writable: false,
  executable: true,
  permissions: { available: true, source: "ghidra-memory-block" },
  provenance: "ghidra-memory-block",
  address_space: "ram",
  image_base: "0x1000",
  initialized: true,
  overlay: false,
  sections: [],
});

const stringItem = (address, value) => ({
  address,
  value,
  string: {
    encoding: "UTF-8",
    termination: "present_or_not_required",
    byte_length: Buffer.byteLength(value, "utf8") + 1,
  },
});

const containingProcedureResult = () => ({
  query_address: "0x1001",
  found: true,
  procedure: {
    address: "0x1000",
    name: "fixture_main",
    classification: {
      external: false,
      thunk: false,
      thunk_target: null,
      provenance: "ghidra-function-manager",
    },
  },
});

const procedureSearchItem = () => ({
  address: "0x1000",
  value: "fixture_main",
});

const stringSearchItem = () => ({
  address: "0x2000",
  value: "fixture value",
});

await endpointPublication;
