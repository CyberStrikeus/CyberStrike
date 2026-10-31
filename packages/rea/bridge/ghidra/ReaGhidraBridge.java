// REA's packaged, read-only Ghidra headless bridge.
// @category REA

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketTimeoutException;
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.channels.Channels;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import ghidra.app.util.headless.HeadlessScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompiledFunction;
import ghidra.app.decompiler.ClangCaseToken;
import ghidra.app.decompiler.ClangNode;
import ghidra.framework.Application;
import ghidra.app.util.bin.format.pdb.PdbParserConstants;
import ghidra.framework.options.Options;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressIterator;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.AddressSpace;
import ghidra.program.model.address.AddressRange;
import ghidra.program.model.address.AddressRangeIterator;
import ghidra.program.model.block.BasicBlockModel;
import ghidra.program.model.block.CodeBlock;
import ghidra.program.model.block.CodeBlockIterator;
import ghidra.program.model.block.CodeBlockReference;
import ghidra.program.model.block.CodeBlockReferenceIterator;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.data.DataType;
import ghidra.program.model.lang.Register;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.listing.CommentType;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Variable;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.mem.MemoryBlockSourceInfo;
import ghidra.program.database.mem.FileBytes;
import ghidra.program.model.address.SegmentedAddress;
import ghidra.program.model.reloc.Relocation;
import java.io.ByteArrayOutputStream;
import ghidra.program.model.symbol.Namespace;
import ghidra.program.model.symbol.FlowType;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolTable;
import ghidra.program.model.pcode.FunctionPrototype;
import ghidra.program.model.pcode.HighFunction;
import ghidra.program.model.pcode.HighParam;
import ghidra.program.model.pcode.HighSymbol;
import ghidra.program.model.pcode.JumpTable;
import ghidra.program.model.pcode.PcodeOp;
import ghidra.program.model.pcode.PcodeOpAST;
import ghidra.program.model.pcode.PcodeBlock;
import ghidra.program.model.pcode.PcodeBlockBasic;
import ghidra.program.model.pcode.Varnode;
import ghidra.program.model.pcode.VarnodeAST;
import ghidra.program.util.ContextEvaluatorAdapter;
import ghidra.program.util.SymbolicPropogator;
import ghidra.program.util.VarnodeContext;

public final class ReaGhidraBridge extends HeadlessScript {
    // At most 24 KiB after worst-case JSON escaping (six bytes per UTF-16 unit).
    private static final int PDB_ATTRIBUTE_UTF16_BUDGET = 4096;
    private static final int MAX_HIGH_PCODE_OPS = 3000;
    private static final int MAX_HIGH_PCODE_INPUTS_PER_OP = 64;
    private static final int MAX_HIGH_PCODE_DEF_USE_EDGES = 12000;
    private static final Gson GSON = new GsonBuilder().serializeNulls().create();
    private final Map<FileBytes, Boolean> targetSourceIdentity = new IdentityHashMap<>();
    private String admittedTargetSha256;
    private static final Set<String> DESCRIPTOR_KEYS = Set.of(
        "transport",
        "endpoint_path",
        "token",
        "run_id",
        "target_sha256",
        "provider_version",
        "profile_digest"
    );
    private static final Set<String> REQUEST_KEYS = Set.of(
        "id",
        "token",
        "method",
        "params"
    );
    private static final String[] CAPABILITIES = {
        "read_binary_inventory_summary",
        "annotate_native_function",
        "set_address_name",
        "set_addresses_names",
        "inspect_native_load_image",
        "read_bytes",
        "search_bytes",
        "address_to_file_offset",
        "ping",
        "shutdown",
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
        "analyze_function",
        "procedure_assembly",
        "procedure_callees",
        "procedure_callers",
        "procedure_info",
        "procedure_pseudo_code",
        "read_function_instructions",
        "inspect_native_instruction",
        "inspect_native_data_type",
        "resolve_native_call_targets",
        "procedure_references",
        "xrefs"
    };

    private List<InventoryItem> nameInventory;
    private List<FunctionEntry> procedureInventory;
    private List<InventoryItem> stringInventory;
    private DecompInterface decompiler;
    /** Per-function native decompiler limit from the session; 0 leaves it unbounded. */
    private int decompileTimeoutSeconds;
    // DecompileProcess converts seconds to an int millisecond timer delay.
    private static final int MAX_DECOMPILE_TIMEOUT_SECONDS = Integer.MAX_VALUE / 1000;
    private final ReaGhidraExtensions analysisExtensions = new ReaGhidraExtensions();
    private static AddressSpace sessionDefaultAddressSpace;

    @Override
    public void run() throws Exception {
        String[] arguments = getScriptArgs();
        if (arguments.length != 1) {
            throw new IllegalArgumentException("REA bridge requires one session descriptor");
        }
        Path descriptorPath = Path.of(arguments[0]);
        SessionDescriptor descriptor = readDescriptor(descriptorPath);
        decompileTimeoutSeconds = descriptor.decompileTimeoutSeconds();
        // Windows retains a native immutable bearer descriptor lease until
        // runtime_close; POSIX removes it after this read. Normal cleanup removes
        // the Windows file, while abrupt owner death can leave private residue.
        // Its protected runtime DACL also protects the bearer token while the
        // bridge is running. POSIX keeps its existing consume-and-delete flow.
        if (!isWindowsHost()) {
            Files.deleteIfExists(descriptorPath);
        }
        if (currentProgram == null) {
            throw new IllegalStateException("REA bridge requires an imported program");
        }
        sessionDefaultAddressSpace =
            currentProgram.getAddressFactory().getDefaultAddressSpace();
        if (currentProgram.getExecutableFormat().equals("Raw Binary")) {
            boolean dosCom = currentProgram.getLanguageID().getIdAsString()
                .equals("x86:LE:16:Real Mode");
            String preparation = dosCom ? "REA DOS COM prepared" : "REA raw binary prepared";
            if (!currentProgram.getOptions(ghidra.program.model.listing.Program.PROGRAM_INFO)
                .getBoolean(preparation, false)) {
                throw new IllegalStateException(
                    dosCom ? "REA DOS COM entry/context preparation failed" :
                        "REA raw binary entry preparation failed"
                );
            }
        }
        if (!Application.getApplicationVersion().equals(descriptor.providerVersion)) {
            throw new IllegalStateException("Ghidra provider version does not match the session");
        }
        String importedSha256 = currentProgram.getExecutableSHA256();
        if (importedSha256 == null ||
            !constantTimeEquals(
                importedSha256.toLowerCase(Locale.ROOT),
                descriptor.targetSha256
            )) {
            throw new IllegalStateException(
                "Ghidra imported-byte digest does not match the admitted target"
            );
        }
        admittedTargetSha256 = descriptor.targetSha256;
        // GhidraScript wraps run() in a transaction. End it before serving so
        // each edit owns a real outer transaction and can roll back immediately.
        end(true);
        try {
            if (!descriptor.transport.equals("unix-socket") && descriptor.analysisExtensions.size() > 0)
                throw new IOException("Windows Ghidra P0 does not admit metadata recovery or database mutation.");
            analysisExtensions.analyze(descriptor.analysisExtensions, currentProgram, monitor);
            initializeDecompiler();
            serve(descriptor);
        }
        finally {
            if (decompiler != null) {
                decompiler.dispose();
                decompiler = null;
            }
            analysisExtensions.close();
        }
    }

    private void serve(SessionDescriptor descriptor) throws Exception {
        if (descriptor.transport.equals("unix-socket")) {
            serveUnixSocket(descriptor);
            return;
        }
        if (descriptor.transport.equals("authenticated-loopback-tcp")) {
            serveLoopbackTcp(descriptor);
            return;
        }
        throw new IllegalArgumentException("REA bridge transport is invalid");
    }

    private void serveUnixSocket(SessionDescriptor descriptor) throws Exception {
        Path socketPath = Path.of(descriptor.endpointPath);
        Files.deleteIfExists(socketPath);
        try (ServerSocketChannel server = ServerSocketChannel.open(StandardProtocolFamily.UNIX)) {
            server.bind(UnixDomainSocketAddress.of(socketPath));
            Files.setPosixFilePermissions(socketPath, PosixFilePermissions.fromString("rw-------"));
            acceptClient(server, descriptor);
        }
        finally {
            Files.deleteIfExists(socketPath);
        }
    }

    private void serveLoopbackTcp(SessionDescriptor descriptor) throws Exception {
        Path endpointPath = Path.of(descriptor.endpointPath);
        Path pendingPath = endpointPath.resolveSibling(endpointPath.getFileName() + ".pending");
        Files.deleteIfExists(endpointPath);
        Files.deleteIfExists(pendingPath);
        try (ServerSocketChannel server = ServerSocketChannel.open()) {
            server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
            InetSocketAddress address = (InetSocketAddress) server.getLocalAddress();
            JsonObject endpoint = new JsonObject();
            endpoint.addProperty("host", "127.0.0.1");
            endpoint.addProperty("port", address.getPort());
            // The Windows native reader refuses a file while a writer still
            // owns it. Closing CREATE_NEW publishes the complete record without
            // requesting rename rights on the retained private directory guard.
            Files.writeString(
                isWindowsHost() ? endpointPath : pendingPath,
                GSON.toJson(endpoint) + "\n",
                StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE
            );
            if (!isWindowsHost()) {
                try {
                    Files.move(pendingPath, endpointPath, StandardCopyOption.ATOMIC_MOVE);
                }
                catch (AtomicMoveNotSupportedException exception) {
                    Files.move(pendingPath, endpointPath);
                }
            }
            acceptAuthenticatedLoopbackClient(server, descriptor);
        }
        finally {
            Files.deleteIfExists(pendingPath);
            Files.deleteIfExists(endpointPath);
        }
    }

    private static boolean isWindowsHost() {
        return System.getProperty("os.name", "").startsWith("Windows");
    }

    private static String readLoopbackHandshake(
            SocketChannel client, int maxBytes, long timeoutMillis) throws IOException {
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000L;
        InputStream input = client.socket().getInputStream();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        while (true) {
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) throw new SocketTimeoutException("Bridge authentication timed out");
            client.socket().setSoTimeout((int) Math.max(1,
                Math.min(Integer.MAX_VALUE, (remaining + 999_999L) / 1_000_000L)));
            int value = input.read();
            if (value == -1) return null;
            if (value == '\n') return bytes.toString(StandardCharsets.UTF_8);
            if (bytes.size() == maxBytes) throw new IOException("Bridge authentication frame is too large");
            bytes.write(value);
        }
    }

    private void acceptAuthenticatedLoopbackClient(
            ServerSocketChannel server, SessionDescriptor descriptor) throws Exception {
        while (true) {
            try (SocketChannel client = server.accept()) {
                Request first;
                try {
                    String line = readLoopbackHandshake(client, 64 * 1024, 1_000);
                    if (line == null) continue;
                    first = parseRequest(line, descriptor.token);
                }
                catch (IOException | RuntimeException rejected) {
                    // A rejected unauthenticated peer cannot consume the bridge session.
                    continue;
                }
                client.socket().setSoTimeout(0);
                try (BufferedReader reader = new BufferedReader(
                         Channels.newReader(client, StandardCharsets.UTF_8));
                     BufferedWriter writer = new BufferedWriter(
                         Channels.newWriter(client, StandardCharsets.UTF_8))) {
                    serveClient(descriptor, reader, writer, first);
                }
                return;
            }
        }
    }

    private void acceptClient(
            ServerSocketChannel server,
            SessionDescriptor descriptor) throws Exception {
        try (SocketChannel client = server.accept();
             BufferedReader reader = new BufferedReader(
                 Channels.newReader(client, StandardCharsets.UTF_8)
             );
             BufferedWriter writer = new BufferedWriter(
                 Channels.newWriter(client, StandardCharsets.UTF_8)
             )) {
            serveClient(descriptor, reader, writer, null);
        }
    }

    private void serveClient(
            SessionDescriptor descriptor,
            BufferedReader reader,
            BufferedWriter writer,
            Request first) throws Exception {
        while (true) {
            Request request = first;
            first = null;
            if (request == null) {
                String line = reader.readLine();
                if (line == null) return;
                try {
                    request = parseRequest(line, descriptor.token);
                }
                catch (RuntimeException exception) {
                    writeFailure(writer, 1, "invalid_request", "Bridge request is invalid");
                    return;
                }
            }
            try {
                if (request.method.equals("shutdown")) {
                    requireKeys(request.params, Set.of());
                    JsonObject result = new JsonObject();
                    result.addProperty("shutdown", true);
                    result.addProperty("project_ephemeral", true);
                    writeSuccess(writer, request.id, result);
                    return;
                }
                decompileTimeoutSeconds = request.decompileTimeoutSeconds() == null
                    ? descriptor.decompileTimeoutSeconds() : request.decompileTimeoutSeconds();
                writeSuccess(writer, request.id, handleRequest(request, descriptor));
            }
            catch (RequestFailure failure) {
                writeFailure(writer, request.id, failure.code, failure.getMessage());
            }
            catch (Exception exception) {
                writeFailure(
                    writer,
                    request.id,
                    "bridge_exception",
                    exception.getClass().getSimpleName() + ": " + safeMessage(exception)
                );
            }
        }
    }

    private JsonElement handleRequest(Request request, SessionDescriptor descriptor)
            throws Exception {
        if (request.method.equals("ping")) {
            requireKeys(request.params, Set.of());
            return sessionInfo(descriptor);
        }
        if (analysisTimeoutOccurred()) {
            throw new RequestFailure(
                "analysis_incomplete",
                "Ghidra auto-analysis did not complete for this Program"
            );
        }
        if (descriptor.existingProject && isMutatingOperation(request.method))
            throw new RequestFailure("method_unavailable", "Existing Ghidra project sessions are read-only");
        return switch (request.method) {
            case "read_binary_inventory_summary" -> binaryInventorySummary(request.params);
            case "inspect_native_load_image" -> inspectNativeLoadImage(request.params);
            case "read_bytes" -> readMemoryBytes(request.params);
            case "search_bytes" -> searchMemoryBytes(request.params, descriptor);
            case "address_to_file_offset" -> addressToFileOffset(request.params);
            case "address_name" -> addressName(request.params);
            case "list_documents" -> listDocuments(request.params);
            case "list_names" -> listNames(request.params);
            case "list_procedures" -> listProcedures(request.params);
            case "list_segments" -> listSegments(request.params);
            case "list_strings" -> listStrings(request.params);
            case "procedure_address" -> procedureAddress(request.params);
            case "procedure_assembly" -> procedureAssembly(request.params);
            case "procedure_callees" -> procedureCalls(request.params, false);
            case "procedure_callers" -> procedureCalls(request.params, true);
            case "procedure_info" -> procedureInfo(request.params);
            case "procedure_pseudo_code" -> procedurePseudocode(request.params);
            case "read_function_instructions" -> readFunctionInstructions(request.params);
            case "procedure_references" -> procedureReferences(request.params);
            case "resolve_containing_procedure" -> containingProcedure(request.params);
            case "search_procedures" -> search(request.params, true);
            case "search_strings" -> search(request.params, false);
            case "inspect_native_data_type" -> inspectNativeDataType(request.params);
            case "inspect_native_instruction" -> inspectNativeInstruction(request.params, true);
            case "resolve_native_call_targets" -> resolveNativeCallTargets(request.params);
            case "xrefs" -> xrefs(request.params);
            case "analyze_function" -> {
                FunctionAnalysisObservation observation = analyzeFunctionObservation(request.params);
                JsonObject result = functionObservation(observation.dossier(), observation.limitations());
                result.add("relationship_coverage", observation.relationshipCoverage());
                if (observation.decompilerFailed()) result.addProperty("cache_policy", "live");
                yield result;
            }
            case "set_address_name", "set_addresses_names" -> {
                if (!descriptor.transport.equals("unix-socket"))
                    throw new RequestFailure("method_unavailable", "Windows P0 does not admit database mutation");
                yield request.method.equals("set_address_name")
                    ? setAddressName(request.params) : setAddressesNames(request.params);
            }
            case "annotate_native_function" -> {
                if (!descriptor.transport.equals("unix-socket"))
                    throw new RequestFailure("method_unavailable", "Windows P0 does not admit database mutation");
                yield annotateNativeFunction(request.params);
            }
            default -> throw new RequestFailure(
                "method_unavailable",
                "Bridge method is unavailable"
            );
        };
    }

    private static boolean isMutatingOperation(String method) {
        return method.equals("annotate_native_function") || method.equals("set_address_name") || method.equals("set_addresses_names");
    }

    private JsonObject sessionInfo(SessionDescriptor descriptor) throws Exception {
        boolean timedOut = analysisTimeoutOccurred();
        JsonObject provider = new JsonObject();
        provider.addProperty("id", "ghidra");
        provider.addProperty("version", Application.getApplicationVersion());

        JsonObject target = new JsonObject();
        target.addProperty("name", currentProgram.getName());
        target.addProperty("language_id", currentProgram.getLanguageID().getIdAsString());
        target.addProperty(
            "compiler_spec_id",
            currentProgram.getCompilerSpec().getCompilerSpecID().getIdAsString()
        );
        target.addProperty("image_base", canonicalAddress(currentProgram.getImageBase()));
        target.addProperty(
            "default_address_space",
            currentProgram.getAddressFactory().getDefaultAddressSpace().getName()
        );
        target.addProperty("sha256", descriptor.targetSha256);

        JsonObject result = new JsonObject();
        result.addProperty("name", "REA Ghidra bridge");
        result.addProperty("run_id", descriptor.runId);
        result.addProperty("profile_digest", descriptor.profileDigest);
        result.add("provider", provider);
        boolean readOnly = descriptor.existingProject || !descriptor.transport.equals("unix-socket");
        result.addProperty("read_only", readOnly);
        if (descriptor.existingProject) {
            result.add("analysis_complete", JsonNull.INSTANCE);
            result.addProperty("existing_project", true);
        } else result.addProperty("analysis_complete", !timedOut);
        result.addProperty("analysis_timed_out", timedOut);
        result.add("capabilities", GSON.toJsonTree(
            java.util.Arrays.stream(CAPABILITIES)
                .filter(value -> !readOnly || !isMutatingOperation(value))
                .toArray(String[]::new)
        ));
        result.add("target", target);
        result.add("pdb", pdbObservation());
        JsonArray extensions = analysisExtensions.reports();
        if (extensions.size() > 0) result.add("analysis_extensions", extensions);
        // Written by ReaGhidraApplySeeds before auto-analysis; REA checks it
        // against the committed profile.
        String seeds = currentProgram.getOptions(ghidra.program.model.listing.Program.PROGRAM_INFO)
            .getString("REA analysis seeds", null);
        if (seeds != null) result.add("analysis_seeds", JsonParser.parseString(seeds));
        // Written by ReaGhidraAnalysisOptions before auto-analysis; REA checks it
        // against the committed profile.
        String disabledAnalyzers = currentProgram.getOptions(ghidra.program.model.listing.Program.PROGRAM_INFO)
            .getString("REA disabled analyzers", null);
        if (disabledAnalyzers != null) result.add("disabled_analyzers", JsonParser.parseString(disabledAnalyzers));
        // Written by ReaGhidraMipsSoftFloat after analysis; REA requires it
        // exactly when the committed profile declares soft-float storage.
        String softFloat = currentProgram.getOptions(ghidra.program.model.listing.Program.PROGRAM_INFO)
            .getString("REA MIPS soft-float storage", null);
        if (softFloat != null) result.add("mips_soft_float_storage", JsonParser.parseString(softFloat));
        // Written by ReaGhidraRiscvCallingConvention after analysis; REA requires it
        // exactly when the committed profile declares a RISC-V calling-convention policy.
        String riscvCallingConvention = currentProgram.getOptions(ghidra.program.model.listing.Program.PROGRAM_INFO)
            .getString("REA RISC-V calling convention", null);
        if (riscvCallingConvention != null) result.add("riscv_calling_convention", JsonParser.parseString(riscvCallingConvention));
        return result;
    }

    /** Read loader/analyzer-owned facts without searching for or applying companions. */
    private JsonObject pdbObservation() {
        Options info = currentProgram.getOptions(ghidra.program.model.listing.Program.PROGRAM_INFO);
        JsonObject pdb = new JsonObject();
        String[] names = {"file", "guid", "age", "signature", "version"};
        String[] attributes = {
            PdbParserConstants.PDB_FILE, PdbParserConstants.PDB_GUID,
            PdbParserConstants.PDB_AGE, PdbParserConstants.PDB_SIGNATURE,
            PdbParserConstants.PDB_VERSION
        };
        int remaining = PDB_ATTRIBUTE_UTF16_BUDGET;
        JsonArray omitted = new JsonArray();
        for (int index = 0; index < names.length; index++) {
            String value = info.getString(attributes[index], null);
            if (value != null && value.length() > remaining) {
                omitted.add(names[index]);
                pdb.add(names[index], JsonNull.INSTANCE);
            } else {
                pdb.addProperty(names[index], value);
                if (value != null) remaining -= value.length();
            }
        }
        if (omitted.size() > 0) {
            JsonObject limit = new JsonObject();
            limit.addProperty("utf16_budget", PDB_ATTRIBUTE_UTF16_BUDGET);
            limit.add("omitted_attributes", omitted);
            pdb.add("resource_limit", limit);
        }
        if (info.contains(PdbParserConstants.PDB_LOADED))
            pdb.addProperty("loaded", info.getBoolean(PdbParserConstants.PDB_LOADED, false));
        else
            pdb.add("loaded", JsonNull.INSTANCE);
        return pdb;
    }

    private static String bytesHex(byte[] bytes) {
        return java.util.HexFormat.of().formatHex(bytes);
    }

    private String hashFileBytes(FileBytes source, boolean modified) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] chunk = new byte[65536];
        for (long offset = 0; offset < source.getSize();) {
            monitor.checkCancelled();
            int length = (int) Math.min(chunk.length, source.getSize() - offset);
            int read = modified
                ? source.getModifiedBytes(offset, chunk, 0, length)
                : source.getOriginalBytes(offset, chunk, 0, length);
            if (read != length) throw new IOException("Incomplete FileBytes read at " + offset);
            digest.update(chunk, 0, read);
            offset += read;
        }
        return bytesHex(digest.digest());
    }

    private String hashMemory(Address start, long length) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] chunk = new byte[65536];
        for (long offset = 0; offset < length;) {
            monitor.checkCancelled();
            int count = (int) Math.min(chunk.length, length - offset);
            int read = currentProgram.getMemory().getBytes(start.add(offset), chunk, 0, count);
            if (read != count) throw new IOException("Incomplete memory read at " + start.add(offset));
            digest.update(chunk, 0, read);
            offset += read;
        }
        return bytesHex(digest.digest());
    }

    private JsonObject inspectNativeLoadImage(JsonObject params) throws Exception {
        requireKeys(params, Set.of());
        JsonObject result = new JsonObject();
        JsonArray recovery = analysisExtensions.inspectImage();
        if (recovery.size() > 0) result.add("metadata_recovery", recovery);
        result.addProperty("executable_format", currentProgram.getExecutableFormat());
        result.addProperty("language_id", currentProgram.getLanguageID().getIdAsString());
        result.addProperty("compiler_spec_id", currentProgram.getCompilerSpec().getCompilerSpecID().getIdAsString());
        result.addProperty("image_base", canonicalAddress(currentProgram.getImageBase()));
        result.addProperty("default_address_space", sessionDefaultAddressSpace.getName());
        List<FileBytes> files = currentProgram.getMemory().getAllFileBytes();
        JsonArray sources = new JsonArray();
        for (FileBytes file : files) {
            JsonObject source = new JsonObject();
            source.addProperty("name", file.getFilename());
            source.addProperty("size", file.getSize());
            source.addProperty("original_sha256", hashFileBytes(file, false));
            source.addProperty("modified_sha256", hashFileBytes(file, true));
            sources.add(source);
        }
        result.add("source_files", sources);
        JsonArray mappings = new JsonArray();
        for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
            for (MemoryBlockSourceInfo source : block.getSourceInfos()) {
                monitor.checkCancelled();
                JsonObject mapping = new JsonObject();
                mapping.addProperty("block", block.getName());
                mapping.addProperty("start", canonicalAddress(source.getMinAddress()));
                mapping.addProperty("end", canonicalAddress(source.getMaxAddress()));
                mapping.addProperty("address_space", source.getMinAddress().getAddressSpace().getName());
                mapping.addProperty("initialized", block.isInitialized());
                mapping.addProperty("loaded", block.isLoaded());
                mapping.addProperty("overlay", block.isOverlay());
                mapping.addProperty("readable", block.isRead());
                mapping.addProperty("writable", block.isWrite());
                mapping.addProperty("executable", block.isExecute());
                mapping.addProperty("length", source.getLength());
                FileBytes backing = source.getFileBytes().orElse(null);
                int sourceIndex = backing == null ? -1 : files.indexOf(backing);
                if (sourceIndex < 0) mapping.add("source_file_index", JsonNull.INSTANCE);
                else mapping.addProperty("source_file_index", sourceIndex);
                long offset = source.getFileBytesOffset();
                if (offset < 0) mapping.add("file_offset", JsonNull.INSTANCE);
                else mapping.addProperty("file_offset", offset);
                if (block.isInitialized()) mapping.addProperty("sha256", hashMemory(source.getMinAddress(), source.getLength()));
                else mapping.add("sha256", JsonNull.INSTANCE);
                mappings.add(mapping);
            }
        }
        result.add("mappings", mappings);
        JsonArray relocations = new JsonArray();
        Iterator<Relocation> iterator = currentProgram.getRelocationTable().getRelocations();
        while (iterator.hasNext()) {
            monitor.checkCancelled();
            Relocation relocation = iterator.next();
            Address location = relocation.getAddress();
            JsonObject row = new JsonObject();
            row.addProperty("address", canonicalAddress(location));
            if (location instanceof SegmentedAddress segmented) {
                row.addProperty("segment", segmented.getSegment());
                row.addProperty("offset", segmented.getSegmentOffset());
            } else {
                row.add("segment", JsonNull.INSTANCE);
                row.add("offset", JsonNull.INSTANCE);
            }
            row.addProperty("status", relocation.getStatus().toString());
            row.addProperty("type", relocation.getType());
            row.add("values", GSON.toJsonTree(relocation.getValues() == null ? new long[0] : relocation.getValues()));
            byte[] original = relocation.getBytes();
            row.add("original_bytes_hex", original == null ? JsonNull.INSTANCE : GSON.toJsonTree(bytesHex(original)));
            if (original != null && original.length > 0) {
                byte[] memory = new byte[original.length];
                int read = currentProgram.getMemory().getBytes(location, memory);
                row.add("memory_bytes_hex", read == memory.length ? GSON.toJsonTree(bytesHex(memory)) : JsonNull.INSTANCE);
            } else row.add("memory_bytes_hex", JsonNull.INSTANCE);
            relocations.add(row);
        }
        result.add("relocations", relocations);
        List<Address> entries = new ArrayList<>();
        var entryIterator = currentProgram.getSymbolTable().getExternalEntryPointIterator();
        while (entryIterator.hasNext()) entries.add(entryIterator.next());
        entries.sort(Address::compareTo);
        JsonArray entryPoints = new JsonArray();
        for (Address entry : entries) entryPoints.add(canonicalAddress(entry));
        result.add("entry_points", entryPoints);
        JsonArray contexts = new JsonArray();
        for (Address entry : entries) {
            JsonObject context = new JsonObject();
            context.addProperty("address", canonicalAddress(entry));
            JsonArray registers = new JsonArray();
            for (String name : new String[] { "CS", "DS", "ES", "SS" }) {
                Register register = currentProgram.getRegister(name);
                if (register == null) continue;
                JsonObject row = new JsonObject();
                row.addProperty("name", name);
                BigInteger value = currentProgram.getProgramContext().getValue(register, entry, false);
                row.add("value_hex", value == null ? JsonNull.INSTANCE : GSON.toJsonTree("0x" + value.toString(16)));
                registers.add(row);
            }
            context.add("registers", registers);
            contexts.add(context);
        }
        result.add("entry_context", contexts);
        return result;
    }

    private JsonObject readMemoryBytes(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "address", "length"));
        requireDocument(params);
        Address start = requireAddress(params, "address");
        JsonElement requested = params.get("length");
        long length;
        try {
            if (requested == null || !requested.isJsonPrimitive() || !requested.getAsJsonPrimitive().isNumber())
                throw new IllegalArgumentException();
            length = requested.getAsBigDecimal().longValueExact();
            if (length < 1 || length > 9007199254740991L) throw new IllegalArgumentException();
        } catch (RuntimeException failure) {
            throw new RequestFailure("invalid_request", "Byte length must be a positive safe integer");
        }
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] chunk = new byte[65536];
        for (long offset = 0; offset < length;) {
            monitor.checkCancelled();
            Address at;
            try { at = start.addNoWrap(offset); }
            catch (Exception endOfSpace) { break; }
            MemoryBlock block = currentProgram.getMemory().getBlock(at);
            if (block == null || !block.isInitialized()) break;
            int count = (int) Math.min(chunk.length, Math.min(length - offset, block.getEnd().subtract(at) + 1));
            int read = currentProgram.getMemory().getBytes(at, chunk, 0, count);
            bytes.write(chunk, 0, read);
            if (read != count) break;
            offset += read;
        }
        JsonObject result = new JsonObject();
        result.addProperty("address", canonicalAddress(start));
        result.addProperty("requested_bytes", length);
        result.addProperty("returned_bytes", bytes.size());
        result.addProperty("bytes_hex", bytesHex(bytes.toByteArray()));
        result.addProperty("complete", bytes.size() == length);
        return result;
    }

    private JsonObject searchMemoryBytes(JsonObject params, SessionDescriptor descriptor) throws Exception {
        // mask, start, end, and cursor are omitted when absent; JSON encoding drops those keys.
        Set<String> keys = params.keySet();
        if (!keys.containsAll(Set.of("document", "pattern", "limit")) ||
            !Set.of("document", "pattern", "mask", "start", "end", "limit", "cursor").containsAll(keys))
            throw new RequestFailure("invalid_request", "Bridge request fields are invalid");
        requireDocument(params);
        // Public input validation owns the grammar; validate again at the socket boundary.
        String pattern = requireString(params, "pattern").replaceAll("[\\s\\p{Z}\\uFEFF]", "");
        String mask = params.has("mask") ? requireString(params, "mask") : null;
        if (mask != null) mask = mask.replaceAll("[\\s\\p{Z}\\uFEFF]", "");
        if (pattern.isEmpty() || pattern.length() % 2 != 0 ||
            (mask != null && mask.length() != pattern.length()))
            throw new RequestFailure("invalid_request", "Mask length must equal a nonempty byte pattern length");
        byte[] bytes = new byte[pattern.length() / 2];
        byte[] masks = new byte[bytes.length];
        boolean constrained = false;
        for (int index = 0; index < bytes.length; index++) {
            monitor.checkCancelled();
            String pair = pattern.substring(index * 2, index * 2 + 2);
            if ((!pair.equals("??") && !isHexadecimal(pair, 0, 2)) ||
                (mask != null && !isHexadecimal(mask, index * 2, index * 2 + 2)))
                throw new RequestFailure("invalid_request", "Use hexadecimal byte pairs or ?? wildcards");
            int selected = mask == null ? 255 : Integer.parseInt(mask.substring(index * 2, index * 2 + 2), 16);
            bytes[index] = (byte) (pair.equals("??") ? 0 : Integer.parseInt(pair, 16));
            masks[index] = (byte) (pair.equals("??") ? 0 : selected);
            constrained |= masks[index] != 0;
        }
        if (!constrained) throw new RequestFailure("invalid_request", "Pattern must constrain at least one bit");
        int limit = requireBoundedInteger(params, "limit", 1, 1000);
        Address start = params.has("start") ? requireAddress(params, "start") : null;
        Address end = params.has("end") ? requireAddress(params, "end") : null;
        if (start != null && end != null &&
            (!start.getAddressSpace().equals(end.getAddressSpace()) || start.compareTo(end) > 0))
            throw new RequestFailure("invalid_request", "Search bounds must be ordered in one address space");
        JsonArray identity = new JsonArray();
        for (String value : new String[] { descriptor.targetSha256, descriptor.profileDigest,
                bytesHex(bytes), bytesHex(masks), start == null ? "" : canonicalAddress(start),
                end == null ? "" : canonicalAddress(end), optionalString(params, "document") }) identity.add(value);
        String binding = bytesHex(MessageDigest.getInstance("SHA-256").digest(identity.toString().getBytes(StandardCharsets.UTF_8)));
        String cursor = params.has("cursor") ? requireString(params, "cursor") : null;
        Address resume = null;
        if (cursor != null) {
            if (!cursor.startsWith(binding + ":"))
                throw new RequestFailure("invalid_request", "Byte search cursor does not match the target and query");
            resume = parseReaAddress(cursor.substring(binding.length() + 1));
            MemoryBlock resumedBlock = currentProgram.getMemory().getBlock(resume);
            Address bound = start == null ? end : start;
            if (resumedBlock == null || !resumedBlock.isInitialized() ||
                (bound != null && !bound.getAddressSpace().equals(resume.getAddressSpace())) ||
                (start != null && resume.compareTo(start) < 0) ||
                (end != null && resume.compareTo(end) > 0))
                throw new RequestFailure("invalid_request", "Byte search cursor lies outside initialized query memory");
        }
        List<MemoryBlock> ordered = new ArrayList<>(List.of(currentProgram.getMemory().getBlocks()));
        ordered.sort(Comparator.comparing(MemoryBlock::getStart));
        JsonArray matches = new JsonArray();
        JsonArray blocks = new JsonArray();
        JsonArray skipped = new JsonArray();
        JsonArray notLoaded = new JsonArray();
        long covered = 0;
        String next = null;
        for (MemoryBlock block : ordered) {
            monitor.checkCancelled();
            Address low = block.getStart();
            Address high = block.getEnd();
            Address bound = start == null ? end : start;
            if (bound != null && !bound.getAddressSpace().equals(low.getAddressSpace())) continue;
            // Without bounds, search loaded memory only. Non-loaded file parts
            // (such as .symtab) and overlays stay reachable through explicit bounds.
            if (bound == null && (!block.isLoaded() || block.isOverlay())) {
                notLoaded.add(byteSearchCoverage(block, low, high));
                continue;
            }
            if (start != null && low.compareTo(start) < 0) low = start;
            if (end != null && high.compareTo(end) > 0) high = end;
            if (low.compareTo(high) > 0) continue;
            if (!block.isInitialized()) {
                skipped.add(byteSearchCoverage(block, low, high));
                continue;
            }
            if (next != null) continue;
            if (resume != null && low.compareTo(resume) < 0) low = resume;
            if (low.compareTo(high) > 0 || !low.getAddressSpace().equals(high.getAddressSpace())) continue;
            Address at = low;
            Address examinedEnd = high;
            while (at != null && at.compareTo(high) <= 0 && high.subtract(at) >= bytes.length - 1L) {
                monitor.checkCancelled();
                // Ghidra's end address bounds candidate starts, not the final matched byte.
                Address found = currentProgram.getMemory().findBytes(at, high.subtract(bytes.length - 1L), bytes, masks, true, monitor);
                monitor.checkCancelled();
                if (found == null || high.subtract(found) < bytes.length - 1L) break;
                if (matches.size() == limit) {
                    next = binding + ":" + canonicalAddress(found);
                    examinedEnd = found.addNoWrap(bytes.length - 1L);
                    break;
                }
                JsonObject match = new JsonObject();
                match.addProperty("address", canonicalAddress(found));
                match.addProperty("segment", block.getName());
                Long offset = targetFileOffset(block, found).offset();
                match.add("file_offset", offset == null ? JsonNull.INSTANCE : GSON.toJsonTree(offset));
                Function function = currentProgram.getFunctionManager().getFunctionContaining(found);
                JsonObject procedure = new JsonObject();
                if (function != null) {
                    procedure.addProperty("address", canonicalAddress(function.getEntryPoint()));
                    procedure.addProperty("name", function.getName(true));
                }
                match.add("procedure", function == null ? JsonNull.INSTANCE : procedure);
                matches.add(match);
                at = found.next();
            }
            JsonObject coverage = byteSearchCoverage(block, low, examinedEnd);
            covered = Math.addExact(covered, coverage.get("bytes").getAsLong());
            blocks.add(coverage);
        }
        JsonObject searched = new JsonObject();
        searched.add("blocks", blocks);
        searched.addProperty("bytes", covered);
        searched.add("skipped_uninitialized", skipped);
        searched.add("skipped_not_loaded", notLoaded);
        JsonObject result = new JsonObject();
        result.add("matches", matches);
        result.add("searched", searched);
        result.addProperty("complete", next == null);
        result.add("next_cursor", next == null ? JsonNull.INSTANCE : GSON.toJsonTree(next));
        return result;
    }

    private static JsonObject byteSearchCoverage(MemoryBlock block, Address low, Address high) {
        JsonObject result = new JsonObject();
        result.addProperty("segment", block.getName());
        result.addProperty("start", canonicalAddress(low));
        result.addProperty("end", canonicalAddress(high));
        result.addProperty("bytes", high.subtract(low) + 1);
        return result;
    }

    private record TargetFileOffset(Long offset, int mappings) {}

    private TargetFileOffset targetFileOffset(MemoryBlock block, Address address) throws Exception {
        Long offset = null;
        int mappings = 0;
        for (MemoryBlockSourceInfo source : block.getSourceInfos()) {
            if (!source.contains(address) || source.getFileBytes().isEmpty() ||
                !isTargetSource(source.getFileBytes().get())) continue;
            long candidate = source.getFileBytesOffset(address);
            if (candidate < 0) continue;
            offset = candidate;
            mappings++;
        }
        return new TargetFileOffset(mappings == 1 && offset <= 9007199254740991L ? offset : null, mappings);
    }

    private JsonObject addressToFileOffset(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "address"));
        requireDocument(params);
        Address address = requireAddress(params, "address");
        String at = canonicalAddress(address);
        // A well-formed address can still lack one exact source offset. Each
        // outcome has its own code, so REA reports the reason rather than
        // schema repair. Initialization, not the loaded flag, decides whether
        // source bytes can exist: file-backed overlays are not loaded.
        MemoryBlock block = currentProgram.getMemory().getBlock(address);
        if (block == null)
            throw new RequestFailure("address_unmapped",
                "Address " + at + " is outside every Ghidra memory block");
        if (!block.isInitialized())
            throw new RequestFailure("address_uninitialized",
                "Address " + at + " is in uninitialized Ghidra memory block " + block.getName());
        TargetFileOffset mapping = targetFileOffset(block, address);
        if (mapping.mappings() == 0)
            throw new RequestFailure("file_mapping_absent",
                "Address " + at + " in initialized Ghidra memory block " + block.getName() +
                " has no authoritative mapping to the admitted target file");
        if (mapping.mappings() > 1)
            throw new RequestFailure("file_mapping_ambiguous",
                "Address " + at + " has " + mapping.mappings() +
                " authoritative mappings to the admitted target file");
        Long fileOffset = mapping.offset();
        if (fileOffset == null)
            throw new RequestFailure("file_offset_unrepresentable",
                "Address " + at + " maps to an admitted target-file offset beyond the exact JSON integer range");
        JsonObject result = new JsonObject();
        result.addProperty("address", at);
        result.addProperty("file_offset", fileOffset);
        return result;
    }

    private void initializeDecompiler() {
        DecompileOptions options = new DecompileOptions();
        options.setMaxInstructions(Integer.MAX_VALUE);
        decompiler = new DecompInterface();
        decompiler.setOptions(options);
        decompiler.toggleCCode(true);
        decompiler.toggleSyntaxTree(true);
        decompiler.toggleJumpLoads(true);
        if (!decompiler.openProgram(currentProgram)) {
            throw new IllegalStateException("Ghidra decompiler could not open the imported Program");
        }
    }

    private JsonElement procedurePseudocode(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "procedure"));
        requireDocument(params);
        String selector = requireString(params, "procedure");
        JsonObject selection = new JsonObject();
        Function function = resolveDecompileProcedure(selector, selection);
        try {
            String value = decompiledText(decompile(function));
            JsonObject result = functionObservation(
                value == null ? JsonNull.INSTANCE : GSON.toJsonTree(value),
                functionBoundaryLimitations(
                    function,
                    currentProgram.getListing().getInstructions(function.getBody(), true)
                )
            );
            if (selection.size() > 0) result.add("selection", selection);
            return result;
        } catch (RequestFailure failure) {
            if (selection.size() == 0) throw failure;
            // Preserve completed resolution facts without changing the backend's
            // failure code or suggesting that the successful mapping was invalid.
            throw new RequestFailure(failure.code, "Selector " + selector +
                " mapped to analysis address " + selection.get("mapped_address").getAsString() +
                " and procedure " + canonicalAddress(function.getEntryPoint()) +
                "; " + failure.getMessage());
        }
    }

    private Function resolveDecompileProcedure(String selector, JsonObject selection) throws Exception {
        String prefix = "file-offset:";
        boolean explicitOffset = selector.startsWith(prefix);
        if (!explicitOffset) {
            try {
                return resolveProcedure(selector);
            } catch (RequestFailure failure) {
                // Existing names/addresses win. Only an unresolved numeric input
                // can fall back to source coordinates; ambiguity never falls back.
                if (!failure.code.equals("not_found") || !selector.matches("0x[0-9a-fA-F]+"))
                    throw failure;
            }
        }
        String coordinate = explicitOffset ? selector.substring(prefix.length()) : selector;
        if (!coordinate.matches("0x[0-9a-fA-F]+"))
            throw new RequestFailure("invalid_request", "File offsets require hexadecimal file-offset:0x... syntax");
        BigInteger parsed = new BigInteger(coordinate.substring(2), 16);
        if (parsed.compareTo(BigInteger.valueOf(9007199254740991L)) > 0)
            throw new RequestFailure("invalid_request", "File offset exceeds the exact JSON integer range");
        long offset = parsed.longValueExact();
        monitor.checkCancelled();
        // Ghidra's convenience lookup spans every FileBytes and uses coordinates
        // local to each object. Only a complete, digest-matched target source
        // establishes that the caller's offset belongs to the admitted file.
        Set<Address> mappedAddresses = new java.util.LinkedHashSet<>();
        for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
            for (MemoryBlockSourceInfo source : block.getSourceInfos()) {
                monitor.checkCancelled();
                FileBytes backing = source.getFileBytes().orElse(null);
                if (backing == null || !isTargetSource(backing)) continue;
                Address mapped = source.locateAddressForFileOffset(offset);
                if (mapped != null) mappedAddresses.add(mapped);
            }
        }
        List<Address> candidates = new ArrayList<>(mappedAddresses);
        if (candidates.size() > 1)
            throw new RequestFailure("ambiguous", "File offset " + coordinate +
                " has multiple loaded mappings: " + candidates.stream().map(ReaGhidraBridge::canonicalAddress).toList() +
                "; select an explicit analysis address");
        if (candidates.isEmpty())
            throw new RequestFailure("not_found", "File offset " + coordinate +
                " has no loaded source mapping for the admitted target file; Ghidra image base: " + canonicalAddress(currentProgram.getImageBase()) +
                ". Inspect mappings with rea inspect-native-load-image <path> --provider ghidra --json or MCP inspect_native_load_image.");
        Address mapped = candidates.get(0);
        Function function = functionAtOrContaining(mapped);
        if (function == null)
            throw new RequestFailure("not_found", "File offset " + coordinate +
                " maps to analysis address " + canonicalAddress(mapped) +
                ", but no procedure starts at or contains that address in the current Ghidra analysis. " +
                "Choose an observed procedure with CLI rea search <path> . --kind procedures --mode regex --provider ghidra --json or MCP list_procedures.");
        selection.addProperty("file_offset", offset);
        selection.addProperty("mapped_address", canonicalAddress(mapped));
        selection.addProperty("procedure_address", canonicalAddress(function.getEntryPoint()));
        return function;
    }

    private boolean isTargetSource(FileBytes source) throws Exception {
        Boolean observed = targetSourceIdentity.get(source);
        if (observed != null) return observed;
        // Original FileBytes are immutable even when analysis memory is edited.
        // Partial/auxiliary sources remain inspectable but cannot establish an
        // original-target offset from their object-local coordinates alone.
        boolean matched = source.getFileOffset() == 0 &&
            constantTimeEquals(hashFileBytes(source, false), admittedTargetSha256);
        targetSourceIdentity.put(source, matched);
        return matched;
    }

    private JsonElement procedureAssembly(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "procedure"));
        requireDocument(params);
        Function function = resolveProcedure(requireString(params, "procedure"));
        InstructionScan scan = scanInstructions(function, Integer.MAX_VALUE);
        return functionObservation(
            GSON.toJsonTree(renderAssembly(scan.instructions)),
            functionBoundaryLimitations(function, scan.instructions)
        );
    }

    private JsonObject readFunctionInstructions(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "procedure"));
        requireDocument(params);
        Function function = resolveProcedure(requireString(params, "procedure"));
        InstructionScan scan = scanInstructions(function, Integer.MAX_VALUE);
        JsonArray items = new JsonArray();
        for (String line : renderAssemblyLines(scan.instructions)) {
            items.add(line);
        }

        JsonArray limitations = new JsonArray();
        limitations.add("Instruction text and ordering are Ghidra-specific representations.");
        limitations.add(
            "The fast path does not invoke the decompiler or scan whole-program names and strings."
        );
        List<String> boundaryLimitations = functionBoundaryLimitations(function, scan.instructions);
        for (String limitation : boundaryLimitations) limitations.add(limitation);
        JsonObject result = new JsonObject();
        result.add("procedure", procedureIdentity(function));
        result.add("instructions", items);
        result.add("limitations", limitations);
        return functionObservation(result, boundaryLimitations);
    }

    private JsonObject procedureCalls(JsonObject params, boolean callers) throws Exception {
        requireKeys(params, Set.of("document", "procedure"));
        requireDocument(params);
        Function function = resolveProcedure(requireString(params, "procedure"));
        Set<Function> observed = callers
            ? function.getCallingFunctions(monitor)
            : function.getCalledFunctions(monitor);
        List<Function> ordered = new ArrayList<>(observed);
        ordered.sort(Comparator.comparing(Function::getEntryPoint));
        JsonArray result = new JsonArray();
        for (Function item : ordered) {
            result.add(canonicalAddress(item.getEntryPoint()));
        }
        if (callers) {
            JsonObject observation = functionObservation(result, functionBoundaryLimitations(function,
                currentProgram.getListing().getInstructions(function.getBody(), true)
            ));
            observation.add("relationship_coverage", callRelationshipCoverage(null,
                unrepresentedIncomingCalls(function, observed)));
            monitor.checkCancelled();
            return observation;
        }
        CallBoundaryObservation calls = callBoundaryObservation(
            function, currentProgram.getListing().getInstructions(function.getBody(), true), observed, false, null
        );
        return callRelationshipObservation(result, calls);
    }

    private JsonObject procedureInfo(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "procedure"));
        requireDocument(params);
        Function function = resolveProcedure(requireString(params, "procedure"));
        JsonObject result = new JsonObject();
        result.addProperty("name", procedureName(function));
        Symbol symbol = function.getSymbol();
        result.add("symbol", symbol == null ? JsonNull.INSTANCE : symbolMetadata(symbol));
        result.addProperty("entrypoint", canonicalAddress(function.getEntryPoint()));
        result.addProperty("basicblock_count", basicBlocks(function).size());
        JsonObject body = functionBody(function);
        result.addProperty("length", body.get("total_bytes").getAsLong());
        result.add("body", body);
        result.addProperty("signature", function.getPrototypeString(false, true));
        result.add("locals", functionLocals(function));
        result.add("classification", functionClassification(function));
        return functionObservation(
            result,
            functionBoundaryLimitations(
                function,
                currentProgram.getListing().getInstructions(function.getBody(), true)
            )
        );
    }

    private JsonObject procedureReferences(JsonObject params) throws Exception {
        requireKeys(
            params,
            Set.of(
                "document",
                "procedure",
                "direction"
            )
        );
        requireDocument(params);
        Function function = resolveProcedure(requireString(params, "procedure"));
        String direction = requireString(params, "direction");
        if (!direction.equals("incoming") && !direction.equals("outgoing")) {
            throw new RequestFailure("invalid_request", "direction must be incoming or outgoing");
        }
        List<Reference> references = collectReferences(function, direction);
        JsonArray edges = new JsonArray();
        for (Reference reference : references) {
            edges.add(referenceEdge(reference));
        }
        JsonObject result = new JsonObject();
        result.add("procedure", procedureIdentity(function));
        result.addProperty("direction", direction);
        result.add("references", edges);
        result.addProperty("reference_kinds_available", true);
        List<String> limitations;
        JsonArray unresolvedCalls = new JsonArray();
        if (direction.equals("outgoing")) {
            CallBoundaryObservation calls = callBoundaryObservation(
                function, currentProgram.getListing().getInstructions(function.getBody(), true), null, true, references
            );
            unresolvedCalls = calls.unresolvedCalls();
            limitations = calls.limitations();
        } else {
            limitations = functionBoundaryLimitations(
                function,
                currentProgram.getListing().getInstructions(function.getBody(), true)
            );
        }
        result.add("unresolved_calls", unresolvedCalls);
        return functionObservation(result, limitations);
    }

    private JsonObject inspectNativeDataType(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "type", "address"));
        requireDocument(params);
        boolean byType = params.has("type") && !params.get("type").isJsonNull();
        boolean byAddress = params.has("address") && !params.get("address").isJsonNull();
        if (byType == byAddress) throw new RequestFailure("invalid_request", "Supply exactly one of type or address");
        DataType type;
        Address address = null;
        if (byType) type = currentProgram.getDataTypeManager().getDataType(requireString(params, "type"));
        else {
            address = requireAddress(params, "address");
            Data data = currentProgram.getListing().getDefinedDataAt(address);
            type = data == null ? null : data.getDataType();
        }
        JsonObject result = new JsonObject();
        result.addProperty("status", type == null ? "unavailable" : "available");
        result.add("reason", type == null ? GSON.toJsonTree("No exact database type or defined typed data exists at the selected identity") : JsonNull.INSTANCE);
        for (String key : List.of("id", "name", "source_archive", "size_bytes", "alignment_bytes", "packing_enabled", "referenced_type", "array_count", "array_stride_bytes")) result.add(key, JsonNull.INSTANCE);
        result.add("address", address == null ? JsonNull.INSTANCE : GSON.toJsonTree(canonicalAddress(address)));
        result.addProperty("source", "analysis-database");
        result.addProperty("kind", "unavailable");
        JsonArray fields = new JsonArray();
        JsonArray members = new JsonArray();
        int totalFields = 0;
        if (type != null) {
            result.addProperty("id", type.getPathName());
            result.addProperty("name", type.getName());
            if (type.getSourceArchive() != null) result.addProperty("source_archive", type.getSourceArchive().getName());
            if (type.getLength() >= 0) result.addProperty("size_bytes", type.getLength());
            if (type.getAlignment() > 0) result.addProperty("alignment_bytes", type.getAlignment());
            String kind = type instanceof ghidra.program.model.data.Structure ? "struct" : type instanceof ghidra.program.model.data.Union ? "union" : type instanceof ghidra.program.model.data.Enum ? "enum" : type instanceof ghidra.program.model.data.Pointer ? "pointer" : type instanceof ghidra.program.model.data.Array ? "array" : type instanceof ghidra.program.model.data.TypeDef ? "typedef" : type instanceof ghidra.program.model.data.BuiltInDataType ? "scalar" : "unsupported";
            result.addProperty("kind", kind);
            if (type instanceof ghidra.program.model.data.Composite composite) {
                result.addProperty("packing_enabled", composite.isPackingEnabled());
                ghidra.program.model.data.DataTypeComponent[] components = composite.getComponents();
                totalFields = components.length;
                for (int index = 0; index < Math.min(components.length, 20_000); index++) {
                    monitor.checkCancelled();
                    ghidra.program.model.data.DataTypeComponent component = components[index];
                    JsonObject field = new JsonObject();
                    field.addProperty("ordinal", component.getOrdinal());
                    field.add("name", component.getFieldName() == null ? JsonNull.INSTANCE : GSON.toJsonTree(component.getFieldName()));
                    field.addProperty("offset_bytes", component.getOffset());
                    field.add("size_bytes", component.getLength() < 0 ? JsonNull.INSTANCE : GSON.toJsonTree(component.getLength()));
                    field.addProperty("type_id", component.getDataType().getPathName());
                    field.add("bit_size", JsonNull.INSTANCE);
                    field.add("bit_offset", JsonNull.INSTANCE);
                    if (component.getDataType() instanceof ghidra.program.model.data.BitFieldDataType bitfield) {
                        field.addProperty("bit_size", bitfield.getBitSize());
                        field.addProperty("bit_offset", bitfield.getBitOffset());
                    }
                    field.addProperty("status", "observed");
                    field.addProperty("flexible_tail", "unknown");
                    fields.add(field);
                }
            } else if (type instanceof ghidra.program.model.data.Enum enumeration) {
                String[] names = enumeration.getNames();
                totalFields = names.length;
                java.util.Arrays.sort(names);
                for (int index = 0; index < Math.min(names.length, 20_000); index++) {
                    monitor.checkCancelled();
                    JsonObject member = new JsonObject();
                    member.addProperty("name", names[index]);
                    member.addProperty("value", Long.toString(enumeration.getValue(names[index])));
                    members.add(member);
                }
            } else if (type instanceof ghidra.program.model.data.Pointer pointer) {
                if (pointer.getDataType() != null) result.addProperty("referenced_type", pointer.getDataType().getPathName());
            } else if (type instanceof ghidra.program.model.data.Array array) {
                result.addProperty("referenced_type", array.getDataType().getPathName());
                result.addProperty("array_count", array.getNumElements());
                result.addProperty("array_stride_bytes", array.getElementLength());
            } else if (type instanceof ghidra.program.model.data.TypeDef alias) {
                result.addProperty("referenced_type", alias.getDataType().getPathName());
            }
        }
        result.add("fields", fields);
        result.add("members", members);
        result.addProperty("total_fields", totalFields);
        result.addProperty("truncated", totalFields > 20_000);
        result.add("limitations", GSON.toJsonTree(List.of("Layouts are Ghidra data-type database observations; original debug/source authority and flexible-tail semantics are not inferred. Nested and recursive types retain category-path identities for separate inspection.", "At most 20000 fields or enum members are serialized per type to bound provider output. total_fields and truncated report omissions. Enum values preserve Ghidra's signed long representation.")));
        if (type != null) {
            JsonObject metadata = analysisExtensions.inspectDataType(currentProgram, type, address, monitor);
            if (metadata != null) result.add("metadata_recovery", metadata);
        }
        return result;
    }

    private JsonObject instructionReference(Reference reference) {
        JsonObject item = new JsonObject();
        JsonObject kind = referenceKind(reference);
        item.addProperty("source_address", canonicalAddress(reference.getFromAddress()));
        item.addProperty("target_address", canonicalAddress(reference.getToAddress()));
        for (String field : List.of("type", "call", "jump", "indirect", "computed",
                "operand_index", "data", "read", "write", "primary", "provenance"))
            item.add(field, kind.get(field));
        item.addProperty("source", normalizedSource(reference.getSource()));
        return item;
    }

    private JsonObject inspectNativeInstruction(JsonObject params, boolean includeIncoming) throws Exception {
        requireKeys(params, Set.of("document", "address"));
        requireDocument(params);
        Address address = requireAddress(params, "address");
        Instruction instruction = currentProgram.getListing().getInstructionAt(address);
        Function function = currentProgram.getFunctionManager().getFunctionContaining(address);
        JsonObject result = new JsonObject();
        result.addProperty("address", canonicalAddress(address));
        result.add("procedure", function == null ? JsonNull.INSTANCE : GSON.toJsonTree(canonicalAddress(function.getEntryPoint())));
        result.addProperty("architecture", currentProgram.getLanguageID().getIdAsString());
        result.addProperty("mode", currentProgram.getLanguage().getLanguageDescription().getVariant());
        if (currentProgram.getLanguageID().getIdAsString().startsWith("MIPS:") ||
            currentProgram.getLanguageID().getIdAsString().startsWith("ARM:")) {
            JsonArray decoderContext = new JsonArray();
            String regName = currentProgram.getLanguageID().getIdAsString().startsWith("MIPS:") ? "ISA_MODE" : "TMode";
            var modeRegister = currentProgram.getRegister(regName);
            if (modeRegister != null) {
                var modeValue = currentProgram.getProgramContext().getValue(modeRegister, address, false);
                JsonObject context = new JsonObject();
                context.addProperty("register", modeRegister.getName());
                context.add("value", modeValue == null ? JsonNull.INSTANCE : GSON.toJsonTree(modeValue.toString()));
                context.addProperty("source", "ghidra-program-context");
                decoderContext.add(context);
            }
            result.add("decoder_context", decoderContext);
        }
        JsonArray operands = new JsonArray();
        JsonArray references = new JsonArray();
        JsonArray destinations = new JsonArray();
        JsonArray flowEvidence = new JsonArray();
        JsonObject flow = new JsonObject();
        flow.addProperty("kind", "unavailable");
        flow.addProperty("conditional", false);
        flow.addProperty("computed", false);
        if (instruction == null) {
            result.addProperty("status", !currentProgram.getMemory().contains(address) ? "outside-memory" : currentProgram.getListing().getInstructionContaining(address) != null
                ? "not-instruction-boundary" : currentProgram.getListing().getDefinedDataContaining(address) != null ? "data" : "not-in-listing");
            for (String key : List.of("bytes", "length", "mnemonic", "raw_disassembly")) result.add(key, JsonNull.INSTANCE);
        } else {
            result.addProperty("status", "decoded");
            result.addProperty("bytes", java.util.HexFormat.of().formatHex(instruction.getBytes()));
            result.addProperty("length", instruction.getLength());
            result.addProperty("mnemonic", instruction.getMnemonicString());
            result.addProperty("raw_disassembly", instruction.toString());
            RefType type = instruction.getFlowType();
            JsonObject listingFlow = new JsonObject();
            listingFlow.addProperty("source", "ghidra-listing-flow-type");
            listingFlow.addProperty("value", type.getName());
            flowEvidence.add(listingFlow);
            boolean decodedReturn = false;
            for (PcodeOp operation : instruction.getPcode()) {
                if (operation.getOpcode() != PcodeOp.RETURN) continue;
                decodedReturn = true;
                JsonObject returnEvidence = new JsonObject();
                returnEvidence.addProperty("source", "ghidra-instruction-pcode");
                returnEvidence.addProperty("value", operation.getMnemonic());
                flowEvidence.add(returnEvidence);
            }
            flow.addProperty("kind", type.isCall() ? "call" : type.isJump() ? "jump" : decodedReturn ? "return" : type.isTerminal() ? "terminal" : "fallthrough");
            flow.addProperty("conditional", type.isConditional());
            flow.addProperty("computed", type.isComputed());
            if (!type.isComputed()) for (Address target : instruction.getFlows()) destinations.add(canonicalAddress(target));
            for (Reference reference : instruction.getReferencesFrom()) references.add(instructionReference(reference));
            for (int index = 0; index < instruction.getNumOperands(); index++) {
                JsonObject operand = new JsonObject();
                operand.addProperty("index", index);
                operand.addProperty("raw", instruction.getDefaultOperandRepresentation(index));
                operand.addProperty("provider_type", instruction.getOperandType(index));
                operand.addProperty("memory_addressing", "unavailable");
                JsonArray components = new JsonArray();
                for (Object object : instruction.getOpObjects(index)) {
                    JsonObject component = new JsonObject();
                    component.addProperty("text", object.toString());
                    component.add("value", JsonNull.INSTANCE);
                    component.add("bit_width", JsonNull.INSTANCE);
                    if (object instanceof Register register) {
                        component.addProperty("kind", "register");
                        component.addProperty("value", register.getName());
                        component.addProperty("bit_width", register.getBitLength());
                    } else if (object instanceof Scalar scalar) {
                        component.addProperty("kind", "immediate");
                        component.addProperty("value", "0x" + Long.toUnsignedString(scalar.getUnsignedValue(), 16));
                        component.addProperty("bit_width", scalar.bitLength());
                    } else if (object instanceof Address target) {
                        component.addProperty("kind", "address");
                        component.addProperty("value", canonicalAddress(target));
                    } else component.addProperty("kind", "unknown");
                    components.add(component);
                }
                operand.add("components", components);
                operands.add(operand);
            }
        }
        flow.add("direct_destinations", destinations);
        flow.add("classification_evidence", flowEvidence);
        result.add("operands", operands);
        result.add("flow", flow);
        result.add("references", references);
        if (includeIncoming) {
            TreeMap<String, Reference> incoming = new TreeMap<>();
            visitObservedReferencesTo(address, reference -> addReference(incoming, reference));
            List<Reference> orderedIncoming = new ArrayList<>(incoming.values());
            orderedIncoming.sort(REFERENCE_ORDER);
            JsonArray incomingReferences = new JsonArray();
            for (Reference reference : orderedIncoming) incomingReferences.add(instructionReference(reference));
            result.add("incoming_references", incomingReferences);
        }
        List<String> limitations = new ArrayList<>(List.of("Operand components are Ghidra Listing decoder tokens; effective memory base/index/displacement roles and per-instruction context mode are unavailable. The mode field is the program language variant."));
        if (result.get("status").getAsString().equals("not-in-listing")) limitations.add("No listed instruction or defined data covers this in-memory address. REA did not attempt a decode; the memory may be uninitialized or contain valid instructions.");
        if (flow.get("kind").getAsString().equals("terminal")) limitations.add("No RETURN operation was observed in the provider's instruction p-code; terminal classification remains generic.");
        result.add("limitations", GSON.toJsonTree(limitations));
        return result;
    }

    private JsonObject resolveNativeCallTargets(JsonObject params) throws Exception {
        JsonObject instruction = inspectNativeInstruction(params, false);
        JsonObject result = new JsonObject();
        result.add("call_site", instruction.get("address"));
        result.add("procedure", instruction.get("procedure"));
        JsonArray targets = new JsonArray();
        JsonObject flow = instruction.getAsJsonObject("flow");
        boolean decoded = instruction.get("status").getAsString().equals("decoded");
        boolean call = flow.get("kind").getAsString().equals("call");
        boolean computed = flow.get("computed").getAsBoolean();
        Map<String, JsonArray> byTarget = new TreeMap<>();
        if (call) for (JsonElement element : instruction.getAsJsonArray("references")) {
            JsonObject reference = element.getAsJsonObject();
            if (reference.get("call").getAsBoolean())
                byTarget.computeIfAbsent(reference.get("target_address").getAsString(), ignored -> new JsonArray()).add(reference);
        }
        boolean ambiguous = byTarget.size() > 1;
        for (Map.Entry<String, JsonArray> entry : byTarget.entrySet()) {
            JsonObject target = new JsonObject();
            target.addProperty("address", entry.getKey());
            Address address = tryParseAddress(entry.getKey());
            Function function = address == null ? null : currentProgram.getFunctionManager().getFunctionAt(address);
            target.add("procedure", function == null ? JsonNull.INSTANCE : GSON.toJsonTree(canonicalAddress(function.getEntryPoint())));
            target.addProperty("status", ambiguous ? "candidate" : computed ? "resolved-indirect" : "direct");
            target.addProperty("basis", "provider-reference");
            target.add("references", entry.getValue());
            targets.add(target);
        }
        result.addProperty("status", !decoded ? "unavailable" : !call ? "not-call" : ambiguous ? "ambiguous" : targets.size() == 0 ? "unresolved" : computed ? "resolved-indirect" : "direct");
        result.addProperty("mechanism", !call ? "unavailable" : computed ? "computed" : "direct");
        result.add("targets", targets);
        result.add("limitations", GSON.toJsonTree(List.of("Targets are static Ghidra ReferenceManager call-reference observations. Computed calls without call references remain unresolved; a resolved reference is not proof of runtime execution.", "Objective-C, Swift, vtable and closure mechanisms are not identified by this reference-only boundary.")));
        return result;
    }

    private JsonArray xrefs(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "address"));
        requireDocument(params);
        Address address = requireAddress(params, "address");
        Set<Address> sources = new HashSet<>();
        visitObservedReferencesTo(address, reference -> sources.add(reference.getFromAddress()));
        List<Address> ordered = new ArrayList<>(sources);
        ordered.sort(Address::compareTo);
        JsonArray result = new JsonArray();
        for (Address source : ordered) {
            result.add(canonicalAddress(source));
        }
        return result;
    }

    private void invalidateAnalysisCaches() {
        nameInventory = null;
        procedureInventory = null;
        stringInventory = null;
        if (decompiler != null) decompiler.flushCache();
    }

    private JsonObject annotationReadback(Function function) {
        Address entry = function.getEntryPoint();
        JsonObject value = new JsonObject();
        value.addProperty("address", canonicalAddress(entry));
        value.addProperty("name", procedureName(function));
        value.addProperty("comment", currentProgram.getListing().getComment(CommentType.PRE, entry));
        value.addProperty("inline_comment", currentProgram.getListing().getComment(CommentType.EOL, entry));
        return value;
    }

    private JsonObject annotateNativeFunction(JsonObject params) throws Exception {
        if (!Set.of("procedure", "name", "comment", "inline_comment").containsAll(params.keySet()))
            throw new RequestFailure("invalid_request", "Unknown function annotation field");
        if (!params.has("name") && !params.has("comment") && !params.has("inline_comment"))
            throw new RequestFailure("invalid_request", "Supply at least one annotation change");
        Function function = resolveProcedure(requireString(params, "procedure"));
        Address entry = function.getEntryPoint();
        if (function.isExternal() || !currentProgram.getMemory().contains(entry))
            throw new RequestFailure("invalid_request", "Annotations require a local function entry: " + canonicalAddress(entry));
        for (String field : List.of("name", "comment", "inline_comment")) {
            if (params.has(field)) validateAnnotationText(requireText(params, field), field);
        }
        int transaction = currentProgram.startTransaction("REA function annotations");
        boolean commit = false;
        try {
            String leafName = params.has("name")
                ? symbolLeafName(function.getSymbol(), requireString(params, "name")) : null;
            // Validate edits through Ghidra's own setters, including name rules.
            // A later invalid name must roll back earlier comment writes.
            for (String field : List.of("comment", "inline_comment")) {
                if (params.has(field)) {
                    String text = requireText(params, field);
                    CommentType type = field.equals("comment") ? CommentType.PRE : CommentType.EOL;
                    currentProgram.getListing().setComment(entry, type, text.isEmpty() ? null : text);
                }
            }
            if (params.has("name"))
                function.setName(leafName, SourceType.USER_DEFINED);
            monitor.checkCancelled();
            invalidateAnalysisCaches();
            JsonObject readback = annotationReadback(function);
            for (String field : List.of("name", "comment", "inline_comment")) {
                if (!params.has(field)) continue;
                String requested = requireText(params, field);
                JsonElement measured = readback.get(field);
                String expected = field.equals("name") ? leafName : requested.isEmpty() ? null : requested;
                String observed = field.equals("name") ? function.getName() :
                    (measured.isJsonNull() ? null : measured.getAsString());
                if (!java.util.Objects.equals(expected, observed))
                    throw new RequestFailure("annotation_readback_mismatch", "Annotation readback differs for " + field + " at " + canonicalAddress(entry));
            }
            JsonObject query = new JsonObject();
            query.addProperty("procedure", canonicalAddress(entry));
            JsonObject result = new JsonObject();
            result.add("annotations", readback);
            result.add("dossier", analyzeFunction(query));
            JsonObject effects = new JsonObject();
            effects.addProperty("scope", "session-analysis-database");
            effects.addProperty("source_bytes_modified", false);
            effects.addProperty("persists_after_close", false);
            result.add("effects", effects);
            monitor.checkCancelled();
            commit = true;
            return result;
        }
        catch (ghidra.util.exception.InvalidInputException | ghidra.util.exception.DuplicateNameException exception) {
            throw new RequestFailure("invalid_function_name", "Invalid function name at " + canonicalAddress(entry) + ": " + safeMessage(exception));
        }
        finally {
            currentProgram.endTransaction(transaction, commit);
            // Rollback also invalidates inventory and decompiler views.
            invalidateAnalysisCaches();
        }
    }

    private String symbolLeafName(Symbol symbol, String requested) throws ghidra.util.exception.InvalidInputException {
        // Fully qualified readback must be usable as an idempotent rename input.
        if (requested.equals(symbol.getName(true))) return symbol.getName();
        String namespace = symbol.getParentNamespace().isGlobal()
            ? "" : symbol.getParentNamespace().getName(true);
        String prefix = namespace + "::";
        if (!namespace.isEmpty() && requested.startsWith(prefix)) {
            String leaf = requested.substring(prefix.length());
            if (!leaf.isEmpty()) return leaf;
            throw new ghidra.util.exception.InvalidInputException(
                "Symbol name has an empty leaf within namespace " + namespace + " at " +
                canonicalAddress(symbol.getAddress()) + ": " + requested);
        }
        return requested;
    }

    private static String requireText(JsonObject params, String field) {
        JsonElement value = params.get(field);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString())
            throw new RequestFailure("invalid_request", "Annotation " + field + " must be text");
        return value.getAsString();
    }

    private static void validateAnnotationText(String text, String field) {
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            if (character == 0)
                throw new RequestFailure("invalid_request", "Annotation " + field + " contains NUL at UTF-16 index " + index + "; Ghidra's decompiler cannot marshal NUL text");
            if (Character.isHighSurrogate(character) && index + 1 < text.length() &&
                Character.isLowSurrogate(text.charAt(index + 1))) {
                index++;
                continue;
            }
            if (Character.isSurrogate(character))
                throw new RequestFailure("invalid_request", "Annotation " + field + " contains an unpaired Unicode surrogate at UTF-16 index " + index + "; Ghidra cannot preserve it as annotation text");
        }
    }

    private JsonObject analyzeFunction(JsonObject params) throws Exception {
        return analyzeFunctionObservation(params).dossier();
    }

    private FunctionAnalysisObservation analyzeFunctionObservation(JsonObject params) throws Exception {
        requireKeys(params, Set.of("procedure"));
        Function function = resolveProcedure(requireString(params, "procedure"));
        InstructionScan scan = scanInstructions(function, Integer.MAX_VALUE);
        DecompileResults decompilation;
        String decompilerFailure = null;
        try {
            decompilation = decompile(function);
        } catch (RequestFailure failure) {
            // The listing, reference and CFG facts below do not depend on the
            // native decompiler. Cancellation still ends the request.
            if (!failure.code.equals("decompile_failed") &&
                !failure.code.equals("decompile_timed_out")) throw failure;
            decompilation = null;
            decompilerFailure = failure.getMessage().strip();
        }
        String pseudocode = decompiledText(decompilation);
        JsonObject availability = new JsonObject();
        availability.add("pseudocode", facetAvailability(
            pseudocode != null,
            decompilerFailure != null ? decompilerFailure
                : function.isExternal() ? "Ghidra does not decompile external functions."
                : function.getBody().isEmpty() ? "Ghidra has no function body to decompile."
                : "Ghidra completed decompilation without returning pseudocode."
        ));
        if (pseudocode == null) {
            pseudocode = "";
        }
        List<Reference> bodyIncoming = collectReferences(function, "incoming");
        List<Reference> incomingReferences = bodyIncoming.stream()
            .filter(reference -> !function.getBody().contains(reference.getFromAddress()))
            .toList();
        List<Reference> outgoingReferences = collectReferences(function, "outgoing");
        JsonArray incoming = referenceEdges(incomingReferences);
        JsonArray outgoing = referenceEdges(outgoingReferences);
        JsonArray comments = comments(function);
        Set<Function> callerFunctions = function.getCallingFunctions(monitor);
        JsonArray callers = procedureIdentities(callerFunctions);
        Set<Function> calleeFunctions = function.getCalledFunctions(monitor);
        JsonArray callees = procedureIdentities(calleeFunctions);
        JsonArray referencedStrings = referencedStrings(outgoingReferences);
        JsonArray referencedNames = referencedNames(outgoingReferences);
        JsonArray blocks = basicBlockValues(function);
        JsonArray assembly = GSON.toJsonTree(renderAssemblyLines(scan.instructions))
            .getAsJsonArray();

        JsonObject procedure = procedureIdentity(function);
        procedure.addProperty("signature", function.getPrototypeString(false, true));
        procedure.add("locals", functionLocals(function));
        JsonObject result = new JsonObject();
        result.add("procedure", procedure);
        result.addProperty("pseudocode", pseudocode);
        result.add("assembly", assembly);
        result.add("comments", comments);
        result.add("callers", callers);
        result.add("callees", callees);
        result.add("incoming_references", incoming);
        result.add("outgoing_references", outgoing);
        result.add("referenced_strings", referencedStrings);
        result.add("referenced_names", referencedNames);
        boolean swift = swiftProgram();
        boolean aarch64 = currentProgram.getLanguageID().getIdAsString().startsWith("AARCH64:");
        SwiftStringLiteralDecode swiftLiterals = swift && aarch64 ? swiftStringLiterals(function) : null;
        if (swiftLiterals != null) {
            result.add("swift_string_literals", swiftLiterals.literals());
            result.add("swift_string_literal_omissions", swiftLiterals.omissions());
        }
        result.add("basic_blocks", blocks);
        result.add(
            "native_api",
            decompilerFailure == null
                ? nativeApiBoundary(function, decompilation)
                : unavailableNativeApiBoundary(decompilerFailure)
        );
        result.add(
            "native_value_flow",
            decompilerFailure == null
                ? nativeValueFlow(decompilation)
                : unavailableNativeValueFlow(decompilerFailure)
        );
        // Successful full queries distinguish collected empty sets from missing facts.
        // Availability does not claim that Ghidra resolved every runtime relationship.
        for (String facet : List.of("comments", "callers", "callees", "references", "strings_names", "cfg")) {
            availability.add(facet, facetAvailability(true, null));
        }
        availability.add("assembly", facetAvailability(
            !scan.truncated(), "The function instruction scan was truncated."
        ));
        result.add("facet_availability", availability);
        JsonArray limitations = new JsonArray();
        limitations.add(
            "Unresolved computed or indirect flows without target addresses are not represented as reference edges."
        );
        limitations.add(
            "Thunk and external classifications are Ghidra FunctionManager observations; they do not resolve targetless calls."
        );
        limitations.add(
            "Pseudocode and assembly are Ghidra-specific representations, not original source or Hopper-equivalent text."
        );
        limitations.add(
            "Synthetic Ghidra entry-point references without actionable memory sources are omitted."
        );
        if (swift && aarch64) {
            limitations.add(
                "Swift String literals are decoded from constant register pairs at calls, returns and paired stores. Literals stored one word at a time, chosen by conditional selects, or built at runtime are not reported; candidate pairs at unresolved jumps are retained as unknown omissions."
            );
            if (swiftLiterals.omissions().size() > 0) {
                limitations.add(
                    "Swift String literal records listed in swift_string_literal_omissions could not be retained or decoded within this dossier's remaining heap budget; later symbolic flows remain unexamined."
                );
            }
        } else if (swift) {
            limitations.add(
                "Swift String literal decoding is implemented for AArch64 register pairs only; no Swift literals were decoded for this architecture."
            );
        }
        CallBoundaryObservation calls = callBoundaryObservation(
            function, scan.instructions, calleeFunctions, true, outgoingReferences);
        result.add("unresolved_calls", calls.unresolvedCalls());
        for (String limitation : calls.limitations()) {
            limitations.add(limitation);
        }
        if (decompilation != null && decompilation.getErrorMessage() != null &&
            !decompilation.getErrorMessage().isBlank()) {
            limitations.add("Ghidra decompiler diagnostic: " + decompilation.getErrorMessage());
        }
        if (decompilerFailure != null) {
            limitations.add(
                decompilerFailure + (decompilerFailure.endsWith(".") ? " " : ". ") +
                "Pseudocode, the native API boundary and p-code value flow are unavailable for this procedure; assembly, comments, callers, callees, references, strings, names and basic blocks come from the Ghidra program listing and were still collected."
            );
        }
        result.add("limitations", limitations);
        monitor.checkCancelled();
        int missingCallers = 0;
        for (Reference reference : bodyIncoming) {
            monitor.checkCancelled();
            if (unrepresentedCaller(reference, callerFunctions)) missingCallers++;
        }
        return new FunctionAnalysisObservation(result, calls.limitations(),
            callRelationshipCoverage(calls, missingCallers), decompilerFailure != null);
    }

    private JsonObject nativeValueFlow(DecompileResults decompilation) throws Exception {
        HighFunction highFunction =
            decompilation == null ? null : decompilation.getHighFunction();
        if (highFunction == null) {
            return unavailableNativeValueFlow(
                "Ghidra has no HighFunction p-code model for this procedure"
            );
        }

        List<PcodeOpAST> selected = new ArrayList<>();
        int omittedOperationsLowerBound = 0;
        Iterator<PcodeOpAST> operations = highFunction.getPcodeOps();
        while (operations.hasNext()) {
            monitor.checkCancelled();
            PcodeOpAST operation = operations.next();
            if (selected.size() >= MAX_HIGH_PCODE_OPS) {
                omittedOperationsLowerBound = 1;
                break;
            }
            selected.add(operation);
        }

        Map<PcodeOpAST, String> operationIds = new IdentityHashMap<>();
        for (PcodeOpAST operation : selected) {
            operationIds.put(operation, pcodeOperationId(operation));
        }
        JsonArray parameterUses = new JsonArray();
        JsonArray parameterValues = new JsonArray();
        FunctionPrototype prototype = highFunction.getFunctionPrototype();
        for (int ordinal = 0; ordinal < prototype.getNumParams(); ordinal++) {
            HighSymbol parameter = prototype.getParam(ordinal);
            if (parameter == null) continue;
            JsonObject value = new JsonObject();
            value.addProperty("ordinal", ordinal);
            value.addProperty("name", parameter.getName());
            value.addProperty("data_type", parameter.getDataType().getPathName());
            parameterValues.add(value);
        }
        JsonArray operationValues = new JsonArray();
        JsonArray defUse = new JsonArray();
        JsonArray effects = new JsonArray();
        int omittedInputs = 0;
        int omittedEdges = 0;
        for (PcodeOpAST operation : selected) {
            monitor.checkCancelled();
            String operationId = operationIds.get(operation);
            JsonObject value = new JsonObject();
            value.addProperty("id", operationId);
            value.addProperty(
                "address",
                canonicalAddress(operation.getSeqnum().getTarget())
            );
            value.addProperty("sequence", operation.getSeqnum().getTime());
            value.addProperty("opcode", operation.getMnemonic());
            value.addProperty("is_dead", operation.isDead());
            value.addProperty("block_membership", operation.getParent() == null ? "detached" : "member");
            JsonArray inputs = new JsonArray();
            int inputCount = operation.getNumInputs();
            int capturedInputs = Math.min(inputCount, MAX_HIGH_PCODE_INPUTS_PER_OP);
            for (int inputIndex = 0; inputIndex < capturedInputs; inputIndex += 1) {
                Varnode input = operation.getInput(inputIndex);
                inputs.add(varnodeValue(input));
                if (input instanceof VarnodeAST astInput) {
                    if (astInput.getHigh() instanceof HighParam parameter) {
                        if (parameterUses.size() >= MAX_HIGH_PCODE_DEF_USE_EDGES) omittedEdges++;
                        else {
                            JsonObject use = new JsonObject();
                            use.addProperty("ordinal", parameter.getSlot());
                            use.addProperty("use", operationId);
                            use.addProperty("input_index", inputIndex);
                            parameterUses.add(use);
                        }
                    }
                    PcodeOp definition = astInput.getDef();
                    if (definition instanceof PcodeOpAST astDefinition) {
                        String definitionId = operationIds.get(astDefinition);
                        if (definitionId == null || defUse.size() >= MAX_HIGH_PCODE_DEF_USE_EDGES) {
                            omittedEdges += 1;
                        } else {
                            JsonObject edge = new JsonObject();
                            edge.addProperty("definition", definitionId);
                            edge.addProperty("use", operationId);
                            edge.addProperty("input_index", inputIndex);
                            defUse.add(edge);
                        }
                    }
                }
            }
            omittedInputs += inputCount - capturedInputs;
            value.add("inputs", inputs);
            Varnode output = operation.getOutput();
            value.add("output", output == null ? JsonNull.INSTANCE : varnodeValue(output));
            operationValues.add(value);
            addPcodeEffect(effects, operation, operationId);
        }

        JsonObject result = new JsonObject();
        result.addProperty("available", true);
        result.addProperty("provenance", "ghidra-high-pcode");
        result.add("operations", operationValues);
        result.add("def_use", defUse);
        result.add("parameters", parameterValues);
        result.add("parameter_uses", parameterUses);
        result.add("effects", effects);
        boolean truncated = omittedOperationsLowerBound > 0 ||
            omittedInputs > 0 || omittedEdges > 0;
        result.addProperty("truncated", truncated);
        result.addProperty(
            "omitted_operations_lower_bound",
            omittedOperationsLowerBound
        );
        result.addProperty("known_omitted_inputs", omittedInputs);
        result.addProperty("known_omitted_edges", omittedEdges);
        JsonArray limitations = new JsonArray();
        limitations.add(
            "High p-code is decompiler-derived, not original source or runtime behavior. is_dead preserves the Java AST flag; decoded block members can retain that flag, so block_membership separately reports actual syntax-tree membership."
        );
        limitations.add(
            "Def-use links do not cross function boundaries and may omit memory aliasing, call side effects, or unresolved indirect flow."
        );
        limitations.add(
            "Memory read/write effects include stack and temporary memory operations; they do not identify persistent state or business meaning."
        );
        limitations.add(
            "Operation, input, and def-use limits can truncate large functions; inspect truncation, omitted lower bounds, and known omitted counts before drawing conclusions."
        );
        limitations.add(
            "Known omitted-edge counts cover links omitted from retained operations; omitted operations may contain additional uncounted links."
        );
        result.add("limitations", limitations);
        return result;
    }

    private String pcodeOperationId(PcodeOpAST operation) {
        return canonicalAddress(operation.getSeqnum().getTarget()) + "#" +
            operation.getSeqnum().getTime();
    }

    private JsonObject varnodeValue(Varnode varnode) {
        JsonObject result = new JsonObject();
        String kind = varnode.isConstant()
            ? "constant"
            : varnode.isAddress()
                ? "address"
                : varnode.isRegister()
                    ? "register"
                    : varnode.isUnique() ? "unique" : "other";
        result.addProperty("kind", kind);
        result.addProperty("size_bytes", varnode.getSize());
        result.add(
            "location",
            varnode.isConstant()
                ? JsonNull.INSTANCE
                : GSON.toJsonTree(canonicalAddress(varnode.getAddress()))
        );
        result.add(
            "constant_hex",
            varnode.isConstant()
                ? GSON.toJsonTree(Long.toUnsignedString(varnode.getOffset(), 16))
                : JsonNull.INSTANCE
        );
        return result;
    }

    private void addPcodeEffect(
        JsonArray destination,
        PcodeOp operation,
        String operationId
    ) {
        String kind = null;
        Integer operandInput = null;
        Integer valueInput = null;
        switch (operation.getOpcode()) {
            case PcodeOp.LOAD -> {
                kind = "memory_read";
                operandInput = 1;
            }
            case PcodeOp.STORE -> {
                kind = "memory_write";
                operandInput = 1;
                valueInput = 2;
            }
            case PcodeOp.CBRANCH -> {
                kind = "conditional_branch";
                valueInput = 1;
            }
            case PcodeOp.BRANCHIND -> {
                kind = "indirect_branch";
                operandInput = 0;
            }
            case PcodeOp.CALL -> {
                kind = "direct_call";
                operandInput = 0;
            }
            case PcodeOp.CALLIND -> {
                kind = "indirect_call";
                operandInput = 0;
            }
            default -> { }
        }
        if (kind == null) return;
        JsonObject effect = new JsonObject();
        effect.addProperty("operation", operationId);
        effect.addProperty("kind", kind);
        effect.add(
            "operand_input",
            operandInput == null ? JsonNull.INSTANCE : GSON.toJsonTree(operandInput)
        );
        effect.add(
            "value_input",
            valueInput == null ? JsonNull.INSTANCE : GSON.toJsonTree(valueInput)
        );
        destination.add(effect);
    }

    private JsonElement addressName(JsonObject params) {
        requireKeys(params, Set.of("document", "address"));
        requireDocument(params);
        Address address = requireAddress(params, "address");
        Symbol symbol = currentProgram.getSymbolTable().getPrimarySymbol(address);
        return symbol == null ? JsonNull.INSTANCE : GSON.toJsonTree(symbol.getName(true));
    }

    // Analyst naming: a function entry renames the function; another mapped
    // address renames its non-dynamic primary label or receives a new global
    // label. Resolve that destination without editing the program.
    private AddressNameTarget addressNameTarget(Address address, String name)
        throws ghidra.util.exception.InvalidInputException {
        if (!currentProgram.getMemory().contains(address))
            throw new RequestFailure("invalid_request", "Address is not mapped: " + canonicalAddress(address));
        validateAnnotationText(name, "name");
        Symbol edited = editedNameSymbol(address);
        return edited == null
            ? new AddressNameTarget(address, currentProgram.getGlobalNamespace(), name)
            : new AddressNameTarget(address, edited.getParentNamespace(), symbolLeafName(edited, name));
    }

    private Symbol editedNameSymbol(Address address) {
        Function function = currentProgram.getFunctionManager().getFunctionAt(address);
        if (function != null) return function.getSymbol();
        Symbol primary = currentProgram.getSymbolTable().getPrimarySymbol(address);
        return primary == null || primary.isDynamic() ? null : primary;
    }

    // Every address whose label or function symbol holds the destination.
    private List<Address> addressNameHolders(AddressNameTarget target) {
        Set<Address> holders = new TreeSet<>();
        for (Symbol symbol : currentProgram.getSymbolTable().getLabelOrFunctionSymbols(target.leaf(), target.namespace()))
            holders.add(symbol.getAddress());
        return List.copyOf(holders);
    }

    // Apply one planned destination in its own transaction. Null means the
    // edit committed with matching primary-symbol readback.
    private String applyAddressName(AddressNameTarget target) {
        Address address = target.address();
        int transaction = currentProgram.startTransaction("REA address name");
        boolean commit = false;
        try {
            Function function = currentProgram.getFunctionManager().getFunctionAt(address);
            Symbol edited = editedNameSymbol(address);
            if (function != null) {
                function.setName(target.leaf(), SourceType.USER_DEFINED);
            } else if (edited != null) {
                edited.setName(target.leaf(), SourceType.USER_DEFINED);
            } else {
                Symbol created = currentProgram.getSymbolTable().createLabel(address, target.leaf(), SourceType.USER_DEFINED);
                created.setPrimary();
            }
            invalidateAnalysisCaches();
            Symbol readback = currentProgram.getSymbolTable().getPrimarySymbol(address);
            commit = readback != null && target.leaf().equals(readback.getName());
            return commit ? null : "readback_mismatch";
        }
        catch (ghidra.util.exception.InvalidInputException exception) {
            return "invalid_name";
        }
        catch (ghidra.util.exception.DuplicateNameException exception) {
            return "duplicate_name";
        }
        finally {
            currentProgram.endTransaction(transaction, commit);
        }
    }

    private JsonElement setAddressName(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "address", "name"));
        requireDocument(params);
        String key = requireString(params, "address");
        Address address = requireAddress(params, "address");
        String name = requireString(params, "name");
        // A single edit keeps request errors for unmapped addresses and
        // unrepresentable text; other outcomes share the batch representation.
        if (!currentProgram.getMemory().contains(address))
            throw new RequestFailure("invalid_request", "Address is not mapped: " + canonicalAddress(address));
        validateAnnotationText(name, "name");
        Map<String, String> requested = new LinkedHashMap<>();
        requested.put(key, name);
        return applyAddressNames(requested);
    }

    private JsonElement setAddressesNames(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "names"));
        requireDocument(params);
        if (!params.has("names") || !params.get("names").isJsonObject())
            throw new RequestFailure("invalid_request", "names must be an object of address -> name");
        Map<String, String> requested = new LinkedHashMap<>();
        for (Map.Entry<String, JsonElement> entry : params.getAsJsonObject("names").entrySet())
            requested.put(entry.getKey(), entry.getValue().getAsString());
        return applyAddressNames(requested);
    }

    // Decide every request from the names held before any edit, so object
    // member order never selects which address receives a name. Reply with
    // per-key results and reasons; a contested destination is listed once in
    // conflicts and failures refer to it by index.
    private JsonObject applyAddressNames(Map<String, String> requested) {
        Map<String, Address> addressesByKey = new LinkedHashMap<>();
        Map<Address, List<AddressNameRequest>> requestsByAddress = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : requested.entrySet()) {
            Address address = null;
            try {
                address = parseReaAddress(entry.getKey());
                requestsByAddress.computeIfAbsent(address, ignored -> new ArrayList<>())
                    .add(new AddressNameRequest(entry.getKey(), address, entry.getValue()));
            }
            catch (RequestFailure failure) {
                // The key keeps its own invalid_address outcome below.
            }
            addressesByKey.put(entry.getKey(), address);
        }
        Map<Address, AddressNameFailure> failures = new HashMap<>();
        Map<AddressNameDestination, List<AddressNameTarget>> destinations = new LinkedHashMap<>();
        for (Map.Entry<Address, List<AddressNameRequest>> selected : requestsByAddress.entrySet()) {
            Address address = selected.getKey();
            String name = selected.getValue().get(0).name;
            if (selected.getValue().stream().anyMatch(request -> !request.name.equals(name))) {
                failures.put(address, new AddressNameFailure("conflicting_alias_names", null));
                continue;
            }
            if (!currentProgram.getMemory().contains(address)) {
                failures.put(address, new AddressNameFailure("unmapped_address", null));
                continue;
            }
            try {
                AddressNameTarget target = addressNameTarget(address, name);
                destinations.computeIfAbsent(target.destination(), ignored -> new ArrayList<>()).add(target);
            }
            catch (RequestFailure | ghidra.util.exception.InvalidInputException exception) {
                failures.put(address, new AddressNameFailure("invalid_name", null));
            }
        }
        // Reject a destination that several selected addresses request, or
        // that another address holds, instead of letting order pick a winner.
        List<AddressNameConflict> conflicts = new ArrayList<>();
        List<AddressNameTarget> independent = new ArrayList<>();
        for (List<AddressNameTarget> requesters : destinations.values()) {
            AddressNameTarget first = requesters.get(0);
            List<Address> holders = addressNameHolders(first);
            String reason;
            if (requesters.size() > 1) {
                reason = "duplicate_requested_name";
            } else if (holders.stream().allMatch(first.address()::equals)) {
                independent.add(first);
                continue;
            } else if (holders.stream().anyMatch(holder ->
                !holder.equals(first.address()) && !requestsByAddress.containsKey(holder))) {
                reason = "name_held_by_unselected_address";
            } else {
                reason = "name_held_by_selected_address";
            }
            AddressNameConflict conflict = new AddressNameConflict(
                first.namespace(),
                first.leaf(),
                requesters.stream().map(AddressNameTarget::address).sorted().toList(),
                holders
            );
            conflicts.add(conflict);
            for (AddressNameTarget target : requesters)
                failures.put(target.address(), new AddressNameFailure(reason, conflict));
        }
        // Independent edits have distinct destinations that no other address
        // holds, so their results do not depend on application order.
        for (AddressNameTarget target : independent) {
            String reason = applyAddressName(target);
            if (reason != null) failures.put(target.address(), new AddressNameFailure(reason, null));
        }
        // Requesters belong to exactly one destination, so ordering conflicts
        // by their first requester gives indexes independent of member order.
        conflicts.sort(Comparator.comparing((AddressNameConflict conflict) -> conflict.requesters().get(0)));
        Map<AddressNameConflict, Integer> indexes = new IdentityHashMap<>();
        JsonArray contested = new JsonArray();
        for (AddressNameConflict conflict : conflicts) {
            indexes.put(conflict, contested.size());
            JsonObject value = new JsonObject();
            if (conflict.namespace().isGlobal()) value.add("namespace", JsonNull.INSTANCE);
            else value.addProperty("namespace", conflict.namespace().getName(true));
            value.addProperty("name", conflict.leaf());
            value.add("requested_by", canonicalAddresses(conflict.requesters()));
            value.add("held_by", canonicalAddresses(conflict.holders()));
            contested.add(value);
        }
        JsonObject results = new JsonObject();
        JsonObject failed = new JsonObject();
        for (Map.Entry<String, Address> entry : addressesByKey.entrySet()) {
            Address address = entry.getValue();
            AddressNameFailure failure = address == null
                ? new AddressNameFailure("invalid_address", null)
                : failures.get(address);
            results.addProperty(entry.getKey(), failure == null);
            if (failure == null) continue;
            JsonObject value = new JsonObject();
            if (address == null) value.add("address", JsonNull.INSTANCE);
            else value.addProperty("address", canonicalAddress(address));
            value.addProperty("reason", failure.reason());
            if (failure.conflict() == null) value.add("conflict", JsonNull.INSTANCE);
            else value.addProperty("conflict", indexes.get(failure.conflict()));
            failed.add(entry.getKey(), value);
        }
        JsonObject result = new JsonObject();
        result.add("results", results);
        result.add("failures", failed);
        result.add("conflicts", contested);
        return result;
    }

    private static JsonArray canonicalAddresses(List<Address> addresses) {
        JsonArray result = new JsonArray();
        for (Address address : addresses) result.add(canonicalAddress(address));
        return result;
    }

    private JsonArray listDocuments(JsonObject params) {
        requireKeys(params, Set.of());
        JsonArray result = new JsonArray();
        result.add(currentProgram.getName());
        return result;
    }

    private JsonObject binaryInventorySummary(JsonObject params) throws Exception {
        requireKeys(params, Set.of());
        JsonObject result = new JsonObject();
        result.addProperty("document", currentProgram.getName());
        result.add("segments", segments());
        // Count the owning inventories, preserving their exact discovery rules
        // without serializing function identities or string values for counts.
        result.addProperty("procedure_count", procedures().size());
        result.addProperty("string_count", strings().size());
        return result;
    }

    private JsonArray listNames(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "address"));
        requireDocument(params);
        List<InventoryItem> inventory = names();
        String requested = optionalString(params, "address");
        if (requested != null) {
            Address address = parseReaAddress(requested);
            inventory = inventory.stream()
                .filter(item -> item.address.equals(address))
                .toList();
        }
        return inventory(inventory, "symbol");
    }

    private JsonArray listProcedures(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document"));
        requireDocument(params);
        List<InventoryItem> inventory = procedures().stream()
            .map(FunctionEntry::item)
            .toList();
        return inventory(inventory, "procedure");
    }

    private JsonArray listSegments(JsonObject params) {
        requireKeys(params, Set.of("document"));
        requireDocument(params);
        return segments();
    }

    private JsonArray segments() {
        JsonArray result = new JsonArray();
        String imageBase = canonicalAddress(currentProgram.getImageBase());
        MemoryBlock[] blocks = currentProgram.getMemory().getBlocks();
        List<MemoryBlock> ordered = new ArrayList<>(List.of(blocks));
        ordered.sort(Comparator.comparing(MemoryBlock::getStart));
        for (MemoryBlock block : ordered) {
            JsonObject item = memoryRegion(block, imageBase);
            item.add("sections", new JsonArray());
            result.add(item);
        }
        return result;
    }

    private JsonArray listStrings(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "address"));
        requireDocument(params);
        List<InventoryItem> inventory = strings();
        String requested = optionalString(params, "address");
        if (requested != null) {
            Address address = parseReaAddress(requested);
            inventory = inventory.stream()
                .filter(item -> item.address.equals(address))
                .toList();
        }
        return inventory(inventory, "string");
    }

    private JsonElement procedureAddress(JsonObject params) throws Exception {
        requireKeys(params, Set.of("document", "procedure"));
        requireDocument(params);
        return GSON.toJsonTree(canonicalAddress(resolveProcedure(requireString(params, "procedure")).getEntryPoint()));
    }

    private JsonObject containingProcedure(JsonObject params) {
        requireKeys(params, Set.of("document", "address"));
        requireDocument(params);
        Address query = requireAddress(params, "address");
        Function function = functionAtOrContaining(query);
        JsonObject result = new JsonObject();
        result.addProperty("query_address", canonicalAddress(query));
        if (function != null) {
            result.addProperty("found", true);
            result.add("procedure", procedureIdentity(function));
            return result;
        }
        result.addProperty("found", false);
        result.add("procedure", JsonNull.INSTANCE);
        boolean inside = query.isMemoryAddress() && currentProgram.getMemory().contains(query);
        result.addProperty("reason", inside ? "not_in_procedure" : "outside_segments");
        return result;
    }

    private JsonArray search(JsonObject params, boolean procedureSearch) throws Exception {
        Set<String> keys = new HashSet<>(Set.of("pattern", "mode", "case_sensitive", "document"));
        if (params.has("literal_ascii_candidate")) keys.add("literal_ascii_candidate");
        requireKeys(params, keys);
        requireDocument(params);
        String expression = requireString(params, "pattern");
        String mode = requireString(params, "mode");
        if (!mode.equals("literal") && !mode.equals("regex")) {
            throw new RequestFailure("invalid_request", "mode must be literal or regex");
        }
        boolean caseSensitive = requireBoolean(params, "case_sensitive");
        List<InventoryItem> inventory = procedureSearch
            ? procedures().stream().map(FunctionEntry::item).toList()
            : strings();
        ValueMatcher matcher;
        if (mode.equals("literal") && !caseSensitive) {
            if (!params.has("literal_ascii_candidate"))
                throw new RequestFailure("invalid_request", "Insensitive literal search requires an ASCII candidate");
            matcher = literalCandidateMatcher(optionalString(params, "literal_ascii_candidate"));
        } else {
            if (params.has("literal_ascii_candidate"))
                throw new RequestFailure("invalid_request", "ASCII candidate applies only to insensitive literals");
            matcher = mode.equals("literal")
                ? literalMatcher(expression)
                : regexMatcher(expression, caseSensitive);
        }
        JsonArray items = new JsonArray();
        for (InventoryItem item : inventory) {
            monitor.checkCancelled();
            if (!matcher.matches(item.value)) {
                continue;
            }
            items.add(resultItem(item, null));
        }
        return items;
    }

    private List<InventoryItem> names() throws Exception {
        if (nameInventory != null) {
            return nameInventory;
        }
        List<InventoryItem> result = new ArrayList<>();
        SymbolIterator symbols = currentProgram.getSymbolTable().getAllSymbols(true);
        while (symbols.hasNext()) {
            monitor.checkCancelled();
            Symbol symbol = symbols.next();
            Address address = symbol.getAddress();
            if (!address.isMemoryAddress() && !address.isExternalAddress()) {
                continue;
            }
            JsonObject facts = symbolMetadata(symbol);
            result.add(new InventoryItem(address, symbol.getName(true), facts, null));
        }
        result.sort(INVENTORY_ORDER);
        nameInventory = List.copyOf(result);
        return nameInventory;
    }

    private List<FunctionEntry> procedures() throws Exception {
        if (procedureInventory != null) {
            return procedureInventory;
        }
        List<FunctionEntry> result = new ArrayList<>();
        Set<Address> seen = new HashSet<>();
        appendFunctions(result, seen, currentProgram.getFunctionManager().getFunctions(true));
        appendFunctions(result, seen, currentProgram.getFunctionManager().getExternalFunctions());
        result.sort((left, right) -> INVENTORY_ORDER.compare(left.item, right.item));
        procedureInventory = List.copyOf(result);
        return procedureInventory;
    }

    private void appendFunctions(
            List<FunctionEntry> destination,
            Set<Address> seen,
            FunctionIterator functions) throws Exception {
        while (functions.hasNext()) {
            monitor.checkCancelled();
            Function function = functions.next();
            if (!seen.add(function.getEntryPoint())) {
                continue;
            }
            JsonObject facts = new JsonObject();
            facts.addProperty("external", function.isExternal());
            facts.addProperty("thunk", function.isThunk());
            Function target = function.isThunk() ? function.getThunkedFunction(false) : null;
            if (target == null) {
                facts.add("thunk_target", JsonNull.INSTANCE);
            }
            else {
                facts.addProperty("thunk_target", canonicalAddress(target.getEntryPoint()));
            }
            Symbol symbol = function.getSymbol();
            InventoryItem item = new InventoryItem(
                function.getEntryPoint(),
                symbol == null ? function.getName() : symbol.getName(true),
                facts,
                symbol == null ? null : symbolMetadata(symbol)
            );
            destination.add(new FunctionEntry(function, item));
        }
    }

    private List<InventoryItem> strings() throws Exception {
        if (stringInventory != null) {
            return stringInventory;
        }
        List<InventoryItem> result = new ArrayList<>();
        DataIterator dataItems = currentProgram.getListing().getDefinedData(true);
        while (dataItems.hasNext()) {
            monitor.checkCancelled();
            Data data = dataItems.next();
            if (!data.hasStringValue()) {
                continue;
            }
            StringDataInstance instance = StringDataInstance.getStringDataInstance(data);
            String value = instance.getStringValue();
            if (value == null) {
                continue;
            }
            JsonObject facts = new JsonObject();
            String charset = instance.getCharsetName();
            facts.addProperty("encoding", charset == null || charset.isEmpty() ? "unknown" : charset);
            facts.addProperty(
                "termination",
                instance.isMissingNullTerminator() ? "missing" : "present_or_not_required"
            );
            facts.addProperty("byte_length", Math.max(0, data.getLength()));
            result.add(new InventoryItem(data.getAddress(), value, facts, null));
        }
        result.sort(INVENTORY_ORDER);
        stringInventory = List.copyOf(result);
        return stringInventory;
    }

    private Function resolveProcedure(String value) throws Exception {
        // Explicit address syntax wins; an unprefixed identifier is first an
        // exact symbol name, even when every character is a hexadecimal digit.
        boolean explicitAddress = isExplicitReaAddress(value);
        if (!explicitAddress) {
            List<Function> matches = new ArrayList<>();
            for (FunctionEntry entry : procedures()) {
                monitor.checkCancelled();
                Function function = entry.function;
                Symbol symbol = function.getSymbol();
                String qualified = symbol == null ? function.getName() : symbol.getName(true);
                boolean matchesName = function.getName().equals(value) || qualified.equals(value);
                if (!matchesName) {
                    // Imported labels (for example Mach-O _main) can share a
                    // function entry without becoming its primary symbol. Only
                    // exact entries qualify; an interior label is not a selector.
                    for (Symbol entrySymbol : currentProgram.getSymbolTable().getSymbols(function.getEntryPoint())) {
                        monitor.checkCancelled();
                        if (entrySymbol.getName().equals(value) || entrySymbol.getName(true).equals(value)) {
                            matchesName = true;
                            break;
                        }
                    }
                }
                if (matchesName) matches.add(function);
            }
            if (matches.size() > 1)
                throw new RequestFailure("ambiguous", "Ghidra procedure name is ambiguous: " + value +
                    "; select an exact entry address from " + matches.stream()
                        .map(function -> canonicalAddress(function.getEntryPoint())).toList());
            if (matches.size() == 1) return matches.get(0);
        }
        // Retain legacy bare-hex address input only when no symbol matches.
        Address address = explicitAddress ? parseReaAddress(value) : tryParseAddress(value);
        if (address == null)
            throw new RequestFailure("not_found", "Unknown Ghidra procedure name or address: " + value);
        Function function = functionAtOrContaining(address);
        if (function == null)
            // Other procedure operations retain their analysis-address semantics.
            throw new RequestFailure("not_found", "No procedure exists at the requested address: " + value +
                "; Ghidra image base: " + canonicalAddress(currentProgram.getImageBase()) +
                ". Choose an observed analysis address. CLI: rea search <path> . --kind procedures --mode regex --provider ghidra --json; " +
                "MCP: list_procedures. Inspect the loaded base and source mappings with CLI rea analyze <path> --provider ghidra --json " +
                "and rea inspect-native-load-image <path> --provider ghidra --json, or MCP binary_overview and inspect_native_load_image. " +
                "Repeat the original target options. For decompile, select source coordinates explicitly with --file-offset=0x... or MCP procedure file-offset:0x....");
        return function;
    }

    /** Exact entries include externals; containment applies only to memory addresses. */
    private Function functionAtOrContaining(Address address) {
        Function function = currentProgram.getFunctionManager().getFunctionAt(address);
        return function == null && address.isMemoryAddress()
            ? currentProgram.getFunctionManager().getFunctionContaining(address)
            : function;
    }

    private JsonObject nativeApiBoundary(
        Function function,
        DecompileResults decompilation
    ) throws Exception {
        if (decompilation == null || decompilation.getHighFunction() == null) {
            return unavailableNativeApiBoundary(
                "Ghidra has no HighFunction model for an external or bodyless procedure"
            );
        }

        HighFunction highFunction = decompilation.getHighFunction();
        FunctionPrototype prototype = highFunction.getFunctionPrototype();
        String signatureSource = function
            .getSignatureSource()
            .name()
            .toLowerCase(Locale.ROOT);
        JsonObject result = new JsonObject();
        result.addProperty("available", true);
        result.addProperty("provenance", "ghidra-high-function");
        result.addProperty("signature_source", signatureSource);
        String callingConvention = prototype.getModelName();
        result.addProperty(
            "calling_convention",
            callingConvention == null || callingConvention.isBlank()
                ? "unknown"
                : callingConvention
        );
        result.add(
            "return_type",
            inferredBoundaryType(
                "return",
                null,
                null,
                prototype.getReturnType(),
                prototype.getReturnStorage().toString(),
                false,
                signatureSource
            )
        );

        JsonArray parameters = new JsonArray();
        result.add("parameters", parameters);

        JsonArray jumpTables = new JsonArray();
        result.add("jump_tables", jumpTables);

        JsonObject pseudocode = new JsonObject();
        pseudocode.addProperty("classification", "decompiler-generated-non-source");
        pseudocode.addProperty("compilable", false);
        result.add("pseudocode", pseudocode);

        JsonArray artifacts = new JsonArray();
        artifacts.add("recovered-signature");
        artifacts.add("register-and-stack-variables");
        artifacts.add("compiler-generated-control-flow");
        artifacts.add("pointer-arithmetic");
        artifacts.add("pseudocode");
        result.add("decompiler_artifacts", artifacts);

        JsonArray limitations = new JsonArray();
        limitations.add(
            "Types and calling conventions are Ghidra decompiler observations, not source declarations."
        );
        limitations.add(
            "Register variables, compiler-generated blocks, and pointer arithmetic remain decompiler artifacts."
        );
        limitations.add(
            "Pseudocode is neither original source nor guaranteed to compile."
        );
        result.add("limitations", limitations);
        for (int index = 0; index < prototype.getNumParams(); index += 1) {
            HighSymbol parameter = prototype.getParam(index);
            if (parameter == null) {
                continue;
            }
            parameters.add(
                inferredBoundaryType(
                    "parameter",
                    index,
                    parameter.getName(),
                    parameter.getDataType(),
                    parameter.getStorage().toString(),
                    parameter.isTypeLocked(),
                    signatureSource
                )
            );
        }

        JumpTable[] recoveredJumpTables = highFunction.getJumpTables();
        List<ClangNode> caseTokens = new ArrayList<>();
        if (decompilation.getCCodeMarkup() != null) {
            decompilation.getCCodeMarkup().flatten(caseTokens);
        }
        for (int index = 0; index < recoveredJumpTables.length; index += 1) {
            jumpTables.add(inferredJumpTable(recoveredJumpTables[index], caseTokens));
        }
        return result;
    }

    private static JsonObject unavailableNativeValueFlow(String reason) {
        JsonObject unavailable = new JsonObject();
        unavailable.addProperty("available", false);
        unavailable.addProperty("reason", reason);
        JsonArray limitations = new JsonArray();
        limitations.add(
            "No p-code operations or def-use relationships were recovered for this procedure."
        );
        unavailable.add("limitations", limitations);
        return unavailable;
    }

    private static JsonObject unavailableNativeApiBoundary(String reason) {
        JsonObject unavailable = new JsonObject();
        unavailable.addProperty("available", false);
        unavailable.addProperty("reason", reason);
        JsonArray unknowns = new JsonArray();
        unknowns.add("Return and parameter boundary types are unavailable.");
        unknowns.add("Jump-table mappings are unavailable.");
        unavailable.add("residual_unknowns", unknowns);
        return unavailable;
    }

    private static JsonObject inferredBoundaryType(
        String role,
        Integer ordinal,
        String name,
        DataType dataType,
        String storage,
        boolean typeLocked,
        String signatureSource
    ) {
        JsonObject result = new JsonObject();
        result.addProperty("role", role);
        if (ordinal == null) {
            result.add("ordinal", JsonNull.INSTANCE);
        }
        else {
            result.addProperty("ordinal", ordinal);
        }
        if (name == null || name.isBlank()) {
            result.add("name", JsonNull.INSTANCE);
        }
        else {
            result.addProperty("name", name);
        }
        result.addProperty("data_type", dataType.getDisplayName());
        int dataTypeLength = dataType.getLength();
        if (dataTypeLength < 0) {
            result.add("size_bytes", JsonNull.INSTANCE);
        }
        else {
            result.addProperty("size_bytes", dataTypeLength);
        }
        if (storage.isBlank()) {
            result.add("storage", JsonNull.INSTANCE);
        }
        else {
            result.addProperty("storage", storage);
        }
        result.addProperty(
            "confidence",
            inferenceConfidence(signatureSource, typeLocked)
        );

        JsonArray evidence = new JsonArray();
        evidence.add(
            inferenceEvidence(
                "signature-source",
                "ghidra-function-manager",
                "Function signature source is " + signatureSource + "."
            )
        );
        evidence.add(
            inferenceEvidence(
                "decompiler-type",
                "ghidra-high-function",
                "HighFunction recovered data type " + dataType.getDisplayName() + "."
            )
        );
        if (typeLocked) {
            evidence.add(
                inferenceEvidence(
                    "type-lock",
                    "ghidra-high-symbol",
                    "The decompiler marks this parameter type as locked."
                )
            );
        }
        result.add("evidence", evidence);

        JsonArray artifacts = new JsonArray();
        artifacts.add("recovered-signature");
        if (!storage.isBlank()) {
            artifacts.add("register-or-stack-storage");
        }
        if (name != null && (name.startsWith("param_") || name.startsWith("unaff_"))) {
            artifacts.add("compiler-generated-variable");
        }
        result.add("decompiler_artifacts", artifacts);
        return result;
    }

    private JsonObject inferredJumpTable(
        JumpTable jumpTable,
        List<ClangNode> caseTokens
    ) throws Exception {
        JsonObject result = new JsonObject();
        result.addProperty(
            "dispatch_address",
            canonicalAddress(jumpTable.getSwitchAddress())
        );
        JumpTable.LoadTable[] loadTables = jumpTable.getLoadTables();
        RecoveredAArch64RelativeTable recoveredAArch64 =
            recoverAArch64RelativeTable(jumpTable);
        if (recoveredAArch64 != null && loadTables.length > 0) {
            // A decoded table only adds evidence when Ghidra's own load table
            // describes the same bytes; any disagreement keeps Ghidra's view.
            boolean agrees = false;
            for (JumpTable.LoadTable loadTable : loadTables) {
                if (loadTable.getAddress().equals(recoveredAArch64.tableAddress) &&
                    loadTable.getSize() == recoveredAArch64.entrySize &&
                    loadTable.getNum() == recoveredAArch64.mappings.size()) {
                    agrees = true;
                }
            }
            if (!agrees) recoveredAArch64 = null;
        }
        List<Address> referencedDataAddresses = loadTables.length == 0
            ? dispatchPathDataReferences(jumpTable)
            : List.of();
        JsonArray dataSources = new JsonArray();
        for (int index = 0; index < loadTables.length; index += 1) {
            monitor.checkCancelled();
            JumpTable.LoadTable loadTable = loadTables[index];
            JsonObject source = new JsonObject();
            source.addProperty("address", canonicalAddress(loadTable.getAddress()));
            source.addProperty("provenance", "ghidra-decompiler-load-table");
            int entrySize = loadTable.getSize();
            int entryCount = loadTable.getNum();
            if (entrySize > 0) source.addProperty("entry_size_bytes", entrySize);
            else source.add("entry_size_bytes", JsonNull.INSTANCE);
            if (entryCount > 0) source.addProperty("entry_count", entryCount);
            else source.add("entry_count", JsonNull.INSTANCE);
            source.addProperty(
                "confidence",
                entrySize > 0 && entryCount > 0 ? "high" : "medium"
            );
            JsonArray evidence = new JsonArray();
            evidence.add(
                inferenceEvidence(
                    "jump-table",
                    "ghidra-high-function",
                    "Decompiler load table starts at " +
                    canonicalAddress(loadTable.getAddress()) +
                    "."
                )
            );
            source.add("evidence", evidence);
            dataSources.add(source);
        }
        if (recoveredAArch64 != null && loadTables.length == 0) {
            JsonObject source = new JsonObject();
            source.addProperty(
                "address",
                canonicalAddress(recoveredAArch64.tableAddress)
            );
            source.addProperty("provenance", recoveredAArch64.entrySize == 1 ? "ghidra-aarch64-byte-table" : "ghidra-aarch64-halfword-table");
            source.addProperty("entry_size_bytes", recoveredAArch64.entrySize);
            source.addProperty("entry_count", recoveredAArch64.mappings.size());
            source.addProperty("confidence", "high");
            JsonArray evidence = new JsonArray();
            evidence.add(
                inferenceEvidence(
                    "jump-table",
                    "ghidra-instruction-and-memory",
                    "Decoded " + recoveredAArch64.mappings.size() + " " +
                    (recoveredAArch64.signedEntries ? "signed" : "unsigned") +
                    " entries of size " + recoveredAArch64.entrySize + " bytes from " + canonicalAddress(recoveredAArch64.tableAddress) +
                    "; the AArch64 ADRP/ADD table, indexed load, ADR base, ADD" +
                    (recoveredAArch64.offsetShift == 0 ? "" : " LSL #" + recoveredAArch64.offsetShift) +
                    "/BR chain uses a selector bounded by CMP #" + recoveredAArch64.compareImmediate +
                    " and " + recoveredAArch64.guardMnemonic + " on one straight-line path" +
                    (recoveredAArch64.nullTarget == null
                        ? "."
                        : "; zero entries are routed by CBZ to " + canonicalAddress(recoveredAArch64.nullTarget) + ".")
                )
            );
            source.add("evidence", evidence);
            dataSources.add(source);
        }
        for (int index = 0; index < referencedDataAddresses.size(); index += 1) {
            Address address = referencedDataAddresses.get(index);
            if (
                recoveredAArch64 != null &&
                recoveredAArch64.tableAddress.equals(address)
            ) {
                continue;
            }
            JsonObject source = new JsonObject();
            source.addProperty("address", canonicalAddress(address));
            source.addProperty(
                "provenance",
                "ghidra-dispatch-block-data-reference"
            );
            source.add("entry_size_bytes", JsonNull.INSTANCE);
            source.add("entry_count", JsonNull.INSTANCE);
            source.addProperty("confidence", "medium");
            JsonArray evidence = new JsonArray();
            evidence.add(
                inferenceEvidence(
                    "jump-table",
                    "ghidra-reference-manager",
                    "The dispatch block or an immediate predecessor contains a typed data reference to " +
                    canonicalAddress(address) +
                    "."
                )
            );
            source.add("evidence", evidence);
            dataSources.add(source);
        }
        result.add("data_sources", dataSources);
        Address[] targets = jumpTable.getCases();
        TypedJumpTableCases typedCases = typedJumpTableCases(jumpTable, caseTokens);
        // Table indices identify the register bounded by CMP. Typed labels may
        // instead identify a selector before normalization (for example, SUB
        // index, selector, #10). Do not merge those distinct value identities.
        if (recoveredAArch64 != null && recoveredAArch64.priorSelectorDefinition != null) {
            typedCases.limitations.add(
                "REA decoded the relative table, but the compared selector has an earlier register definition at " +
                canonicalAddress(recoveredAArch64.priorSelectorDefinition) + "; its table indices are not proven to use the typed switch selector's case values. Ghidra's typed labels are retained and additional case labels remain unknown."
            );
            recoveredAArch64 = null;
        }
        if (recoveredAArch64 != null) {
            for (Map.Entry<Long, Address> typed : typedCases.cases.entrySet()) {
                long value = typed.getKey();
                if (value < 0 || value >= recoveredAArch64.mappings.size()) {
                    typedCases.limitations.add("Typed case labels and decoded table indices do not use a verified common selector; Ghidra's typed labels are retained.");
                    recoveredAArch64 = null;
                    break;
                }
                RecoveredAArch64Mapping decoded = recoveredAArch64.mappings.get((int) value);
                boolean divertedZero = decoded.nullEntry && typed.getValue().equals(recoveredAArch64.unreachableZeroTarget);
                if (!typed.getValue().equals(decoded.targetAddress) && !divertedZero) {
                    typedCases.limitations.add("Typed case evidence and the decoded relative table disagree on a destination; Ghidra's typed labels are retained.");
                    recoveredAArch64 = null;
                    break;
                }
            }
        }
        JsonArray mappings = new JsonArray();
        JsonArray defaultTargets = new JsonArray();
        for (Address target : typedCases.defaults) {
            defaultTargets.add(typedJumpTableTarget(target, jumpTable, "Typed default label"));
        }
        Set<Address> coveredTargets = new HashSet<>(typedCases.cases.values());
        coveredTargets.addAll(typedCases.defaults);
        if (recoveredAArch64 != null && recoveredAArch64.unreachableZeroTarget != null) {
            Address unreachable = recoveredAArch64.unreachableZeroTarget;
            coveredTargets.add(unreachable);
            for (RecoveredAArch64Mapping recovered : recoveredAArch64.mappings) {
                if (recovered.nullEntry && unreachable.equals(typedCases.cases.get((long) recovered.tableIndex))) {
                    typedCases.cases.remove((long) recovered.tableIndex);
                }
            }
            typedCases.limitations.add(
                "Ghidra recovered destination " + canonicalAddress(unreachable) +
                " as the zero-offset decode of the relative table, but the CBZ before the dispatch diverts zero entries to " +
                canonicalAddress(recoveredAArch64.nullTarget) + ", so the indirect branch never reaches it for an in-range case."
            );
        }
        if (recoveredAArch64 != null) {
            for (int index = 0; index < recoveredAArch64.mappings.size(); index += 1) {
                monitor.checkCancelled();
                RecoveredAArch64Mapping recovered = recoveredAArch64.mappings.get(index);
                if (
                    typedCases.unknownTargets.contains(recovered.targetAddress) ||
                    typedCases.ambiguousValues.contains((long) recovered.tableIndex)
                ) continue;
                JsonObject mapping = new JsonObject();
                mapping.addProperty("case_value", recovered.tableIndex);
                String targetAddress = canonicalAddress(recovered.targetAddress);
                mapping.addProperty("target_address", targetAddress);
                mapping.addProperty("confidence", "high");
                JsonArray evidence = new JsonArray();
                evidence.add(
                    inferenceEvidence(
                        "jump-table",
                        "ghidra-instruction-and-memory",
                        "Case value " + recovered.tableIndex + (recoveredAArch64.entrySize == 1 ? " indexes byte " : " indexes halfword at byte offset ") +
                        (recovered.tableIndex * recoveredAArch64.entrySize) + " at " + canonicalAddress(recoveredAArch64.tableAddress) +
                        (recovered.nullEntry
                            ? "; the entry is zero, so the CBZ before the dispatch branches to " + targetAddress + "."
                            : "; the loaded " + (recoveredAArch64.signedEntries ? "signed" : "unsigned") +
                              " entry " + recovered.encodedEntry + " selects a " +
                              (recoveredAArch64.offsetShift == 2 ? "four-byte instruction" : "byte") +
                              " offset from " + canonicalAddress(recoveredAArch64.branchBase) + ", reaching " + targetAddress + ".")
                    )
                );
                mapping.add("evidence", evidence);
                if (!typedCases.cases.containsKey((long) recovered.tableIndex)) {
                    mappings.add(mapping);
                }
                coveredTargets.add(recovered.targetAddress);
            }
        }
        for (Map.Entry<Long, Address> entry : typedCases.cases.entrySet()) {
            JsonObject mapping = typedJumpTableTarget(
                entry.getValue(),
                jumpTable,
                "Typed case value " + entry.getKey()
            );
            mapping.addProperty("case_value", entry.getKey());
            mappings.add(mapping);
        }
        Set<Address> emittedUnknownTargets = new HashSet<>();
        for (int index = 0; index < targets.length; index += 1) {
            monitor.checkCancelled();
            boolean unresolvedToken = typedCases.unknownTargets.contains(targets[index]);
            if (coveredTargets.contains(targets[index]) && !unresolvedToken) continue;
            if (!emittedUnknownTargets.add(targets[index])) continue;
            JsonObject mapping = new JsonObject();
            mapping.add("case_value", JsonNull.INSTANCE);
            String targetAddress = canonicalAddress(targets[index]);
            mapping.addProperty("target_address", targetAddress);
            // Ghidra's recovered case-to-target relation does not identify
            // which backing load table produced an individual case. Keep the
            // table inventory and recovered mappings separate instead of
            // attaching every table address to every target.
            mapping.addProperty("confidence", "medium");
            JsonArray evidence = new JsonArray();
            evidence.add(
                inferenceEvidence(
                    "jump-table",
                    "ghidra-high-function",
                    "Ghidra recovered target " +
                          targetAddress +
                          " at dispatch " +
                          canonicalAddress(jumpTable.getSwitchAddress()) +
                          ", but no unambiguous, exactly representable case label or default relationship was available."
                )
            );
            mapping.add("evidence", evidence);
            mappings.add(mapping);
        }
        result.add("mappings", mappings);
        result.add("default_targets", defaultTargets);
        JsonArray limitations = new JsonArray();
        for (String limitation : typedCases.limitations) limitations.add(limitation);
        if (defaultTargets.isEmpty()) {
            limitations.add(
                "Ghidra exposed no typed default label with an unambiguous relationship to a recovered destination of this dispatch; default or out-of-range handling remains unknown."
            );
        }
        if (loadTables.length == 0 && referencedDataAddresses.isEmpty()) {
            limitations.add(
                "Ghidra recovered targets but exposed no backing load-table or dispatch-block data address."
            );
        }
        if (
            recoveredAArch64 == null &&
            loadTables.length == 0 &&
            !referencedDataAddresses.isEmpty()
        ) {
            limitations.add(
                "Load-table metadata was absent; table-level candidate ownership is inferred from typed data references in the dispatch block and its immediate control-flow predecessors, but candidates are not assigned to individual mappings."
            );
        }
        if (!emittedUnknownTargets.isEmpty()) {
            limitations.add(
                "Some recovered destinations lack an unambiguous, exactly representable case/default relationship; their case values remain unknown. Unequal label and destination arrays are never paired by index."
            );
        }
        if (recoveredAArch64 == null && loadTables.length == 0 && currentProgram.getLanguageID().getIdAsString().startsWith("AARCH64:")) {
            limitations.add("REA did not verify a supported signed or unsigned byte/halfword relative dispatch chain with exact unsigned bounds and register definitions; unsupported encodings and ambiguous bounds remain unknown.");
        }
        if (targets.length == 0) {
            limitations.add(
                "Ghidra exposed a jump-table dispatch without recovered case targets."
            );
        }
        result.add("limitations", limitations);
        return result;
    }

    private static final class TypedJumpTableCases {
        private final Map<Long, Address> cases = new TreeMap<>();
        private final Set<Address> defaults = new java.util.TreeSet<>();
        private final Set<Address> unknownTargets = new HashSet<>();
        private final Set<Long> ambiguousValues = new HashSet<>();
        private final Set<String> limitations = new java.util.LinkedHashSet<>();
    }

    private TypedJumpTableCases typedJumpTableCases(
        JumpTable jumpTable,
        List<ClangNode> tokens
    ) throws Exception {
        TypedJumpTableCases result = new TypedJumpTableCases();
        Set<Address> targets = new HashSet<>();
        for (Address target : jumpTable.getCases()) targets.add(target);
        for (ClangNode node : tokens) {
            monitor.checkCancelled();
            if (!(node instanceof ClangCaseToken token)) continue;
            PcodeOp operation = token.getPcodeOp();
            if (operation == null || operation.getParent() == null) continue;
            PcodeBlockBasic block = operation.getParent();
            Address target = block.getStart();
            if (!targets.contains(target)) continue;
            PcodeOp dispatch = null;
            boolean ambiguousDispatch = false;
            boolean includesDispatch = false;
            for (int index = 0; index < block.getInSize(); index += 1) {
                PcodeBlock predecessor = block.getIn(index);
                if (!(predecessor instanceof PcodeBlockBasic basic)) continue;
                PcodeOp last = basic.getLastOp();
                if (last == null || last.getOpcode() != PcodeOp.BRANCHIND) continue;
                if (last.getSeqnum().getTarget().equals(jumpTable.getSwitchAddress())) {
                    includesDispatch = true;
                }
                if (dispatch != null && dispatch != last) ambiguousDispatch = true;
                dispatch = last;
            }
            if (!includesDispatch) continue;
            if (ambiguousDispatch) {
                result.unknownTargets.add(target);
                result.limitations.add(
                    "A typed case/default block has multiple indirect dispatch predecessors; REA cannot attribute its label to one switch."
                );
                continue;
            }
            // Default is a typed label role, not an OFF sentinel: Ghidra can
            // encode a default token with an ordinary in-range case value.
            if ("default".equals(token.getText())) {
                result.defaults.add(target);
                continue;
            }
            Long value = exactTypedCaseValue(token);
            if (value == null) {
                result.unknownTargets.add(target);
                result.limitations.add(
                    "Typed case label " + token.getText() +
                    " has encoded unsigned magnitude " + Long.toUnsignedString(token.getValue()) +
                    " at recovered target " + canonicalAddress(target) +
                    " for dispatch " + canonicalAddress(jumpTable.getSwitchAddress()) +
                    "; the label is nonliteral, inconsistent with its encoded magnitude, or outside the exact JSON integer range, so its numeric case value remains unknown."
                );
                continue;
            }
            if (result.ambiguousValues.contains(value)) {
                result.unknownTargets.add(target);
                continue;
            }
            Address previous = result.cases.putIfAbsent(value, target);
            if (previous != null && !previous.equals(target)) {
                result.cases.remove(value);
                result.ambiguousValues.add(value);
                result.unknownTargets.add(previous);
                result.unknownTargets.add(target);
                result.limitations.add(
                    "Typed tokens assign one case value to different recovered destinations; that case remains unknown."
                );
            }
        }
        return result;
    }

    private static Long exactTypedCaseValue(ClangCaseToken token) {
        String text = token.getText();
        if (text == null || !text.matches("-?(?:0[xX][0-9a-fA-F]+|[0-9]+)")) return null;
        boolean negative = text.startsWith("-");
        String literal = negative ? text.substring(1) : text;
        BigInteger magnitude = literal.startsWith("0x") || literal.startsWith("0X")
            ? new BigInteger(literal.substring(2), 16)
            : new BigInteger(literal, 10);
        // Negative numeric tokens carry an unsigned magnitude in OFF, so
        // getValue()/getScalar() alone would incorrectly emit positive cases.
        if (!magnitude.equals(new BigInteger(Long.toUnsignedString(token.getValue())))) return null;
        BigInteger value = negative ? magnitude.negate() : magnitude;
        if (value.abs().compareTo(BigInteger.valueOf(9007199254740991L)) > 0) return null;
        return value.longValueExact();
    }

    private static JsonObject typedJumpTableTarget(
        Address target,
        JumpTable table,
        String label
    ) {
        JsonObject result = new JsonObject();
        String address = canonicalAddress(target);
        result.addProperty("target_address", address);
        result.addProperty("confidence", "high");
        JsonArray evidence = new JsonArray();
        evidence.add(inferenceEvidence(
            "jump-table",
            "ghidra-clang-case-token",
            label + " belongs to the p-code block starting at recovered target " +
            address + "; its unique indirect dispatch predecessor is " +
            canonicalAddress(table.getSwitchAddress()) + "."
        ));
        result.add("evidence", evidence);
        return result;
    }

    private static final class RecoveredAArch64Mapping {
        private final int tableIndex;
        private final Address targetAddress;
        private final long encodedEntry;
        private final boolean nullEntry;

        private RecoveredAArch64Mapping(
            int tableIndex,
            Address targetAddress,
            long encodedEntry,
            boolean nullEntry
        ) {
            this.tableIndex = tableIndex;
            this.targetAddress = targetAddress;
            this.encodedEntry = encodedEntry;
            this.nullEntry = nullEntry;
        }
    }

    private static final class RecoveredAArch64RelativeTable {
        private final Address tableAddress;
        private final Address branchBase;
        private final int entrySize;
        private final Address priorSelectorDefinition;
        private final boolean signedEntries;
        private final int offsetShift;
        private final String guardMnemonic;
        private final long compareImmediate;
        private final Address nullTarget;
        private final Address unreachableZeroTarget;
        private final List<RecoveredAArch64Mapping> mappings;

        private RecoveredAArch64RelativeTable(
            Address tableAddress,
            Address branchBase,
            int entrySize,
            Address priorSelectorDefinition,
            boolean signedEntries,
            int offsetShift,
            String guardMnemonic,
            long compareImmediate,
            Address nullTarget,
            Address unreachableZeroTarget,
            List<RecoveredAArch64Mapping> mappings
        ) {
            this.tableAddress = tableAddress;
            this.branchBase = branchBase;
            this.entrySize = entrySize;
            this.priorSelectorDefinition = priorSelectorDefinition;
            this.signedEntries = signedEntries;
            this.offsetShift = offsetShift;
            this.guardMnemonic = guardMnemonic;
            this.compareImmediate = compareImmediate;
            this.nullTarget = nullTarget;
            this.unreachableZeroTarget = unreachableZeroTarget;
            this.mappings = mappings;
        }
    }

    private static final Pattern AARCH64_DISPATCH_ADD = Pattern.compile(
        "(?i)^([wx]\\d+),\\s*([wx]\\d+),\\s*([wx]\\d+)(?:,\\s*LSL\\s*#(?:0x)?([0-9a-f]+))?$"
    );
    private static final Pattern AARCH64_TABLE_LOAD = Pattern.compile(
        "(?i)^([wx]\\d+),\\s*\\[([wx]\\d+),\\s*([wx]\\d+)(?:,\\s*(LSL|UXTW)\\s*(?:#(?:0x)?([0-9a-f]+))?)?\\s*\\]$"
    );
    private static final Pattern AARCH64_REGISTER_AND_ADDRESS = Pattern.compile(
        "(?i)^([wx]\\d+),\\s*(0x[0-9a-f]+)$"
    );
    private static final Pattern AARCH64_ADD_IMMEDIATE = Pattern.compile(
        "(?i)^([wx]\\d+),\\s*([wx]\\d+),\\s*#?(0x[0-9a-f]+|[0-9]+)$"
    );
    private static final Pattern AARCH64_COMPARE_IMMEDIATE = Pattern.compile(
        "(?i)^([wx]\\d+),\\s*#?(0x[0-9a-f]+|[0-9]+)$"
    );
    private static final Pattern AARCH64_MOVE_REGISTER = Pattern.compile(
        "(?i)^([wx]\\d+),\\s*([wx]\\d+)$"
    );
    private static final Set<String> AARCH64_FLAG_PRESERVING =
        Set.of("MOV", "ADRP", "ADR", "ADD");

    /**
     * Recover only directly verified AArch64 relative branch tables:
     * ADRP/ADD table base, LDRB/LDRH/LDRSB/LDRSH entry load with an exact
     * index scale, ADR branch base, optional CBZ on the loaded entry, and
     * ADD (byte or LSL #2 scale)/BR, with a selector bounded by CMP #imm and an
     * unsigned B.HI or B.CS/B.HS guard on one straight-line path. Any other
     * instruction sequence keeps its case labels unknown.
     */
    private RecoveredAArch64RelativeTable recoverAArch64RelativeTable(
        JumpTable jumpTable
    ) throws Exception {
        if (!currentProgram.getLanguageID().getIdAsString().startsWith("AARCH64:")) {
            return null;
        }
        Function function = functionAtOrContaining(jumpTable.getSwitchAddress());
        if (function == null) return null;

        List<Instruction> instructions = new ArrayList<>();
        InstructionIterator iterator = currentProgram.getListing().getInstructions(
            function.getBody(), true
        );
        while (iterator.hasNext()) {
            monitor.checkCancelled();
            Instruction instruction = iterator.next();
            instructions.add(instruction);
            if (instruction.getAddress().equals(jumpTable.getSwitchAddress())) break;
        }
        int branchIndex = instructions.size() - 1;
        if (branchIndex < 1 || !mnemonic(instructions.get(branchIndex)).equals("BR")) {
            return null;
        }
        Set<String> recoveredTargetSet = new HashSet<>();
        for (Address target : jumpTable.getCases()) recoveredTargetSet.add(canonicalAddress(target));
        if (recoveredTargetSet.isEmpty()) return null;
        return matchAArch64RelativeDispatch(
            instructions,
            branchIndex,
            recoveredTargetSet,
            dispatchPathDataReferences(jumpTable)
        );
    }

    private RecoveredAArch64RelativeTable matchAArch64RelativeDispatch(
        List<Instruction> instructions,
        int branchIndex,
        Set<String> recoveredTargetSet,
        List<Address> dataAddresses
    ) throws Exception {
        String branchRegister = normalizedRegister(operands(instructions.get(branchIndex)));

        // ADD Xd, Xn, Xm{, LSL #s}; BR Xd. LSL applies to Xm only.
        Instruction dispatchAdd = instructions.get(branchIndex - 1);
        if (!mnemonic(dispatchAdd).equals("ADD")) return null;
        java.util.regex.Matcher addMatcher = AARCH64_DISPATCH_ADD.matcher(operands(dispatchAdd));
        if (!addMatcher.matches() || !addMatcher.group(1).toLowerCase(Locale.ROOT).startsWith("x")) return null;
        if (!normalizedRegister(addMatcher.group(1)).equals(branchRegister)) return null;
        int offsetShift = addMatcher.group(4) == null ? 0 : Integer.parseInt(addMatcher.group(4), 16);
        if (offsetShift != 0 && offsetShift != 2) return null;
        String firstSource = normalizedRegister(addMatcher.group(2));
        String secondSource = normalizedRegister(addMatcher.group(3));
        if (firstSource.equals(secondSource)) return null;

        // The entry register is the source whose latest definition is the
        // table load; the other source must be defined by ADR.
        int loadIndex = -1;
        String entryRegister = null;
        String baseRegister = null;
        for (String candidate : offsetShift == 0 ? List.of(secondSource, firstSource) : List.of(secondSource)) {
            int writer = latestWriter(instructions, branchIndex - 1, candidate);
            if (writer >= 0 && Set.of("LDRB", "LDRH", "LDRSB", "LDRSH").contains(mnemonic(instructions.get(writer)))) {
                loadIndex = writer;
                entryRegister = candidate;
                baseRegister = candidate.equals(firstSource) ? secondSource : firstSource;
                break;
            }
        }
        if (loadIndex < 0) return null;

        Instruction load = instructions.get(loadIndex);
        String loadMnemonic = mnemonic(load);
        int entrySize = loadMnemonic.endsWith("B") ? 1 : 2;
        boolean signedEntries = loadMnemonic.startsWith("LDRS");
        java.util.regex.Matcher loadMatcher = AARCH64_TABLE_LOAD.matcher(operands(load));
        if (!loadMatcher.matches()) return null;
        // A signed load into a W register sign-extends only to 32 bits; the
        // 64-bit dispatch ADD would then read a zero-extended value.
        if (signedEntries && !loadMatcher.group(1).toLowerCase(Locale.ROOT).startsWith("x")) return null;
        String tableBaseRegister = normalizedRegister(loadMatcher.group(2));
        String indexRegister = normalizedRegister(loadMatcher.group(3));
        boolean wordIndex = loadMatcher.group(3).toLowerCase(Locale.ROOT).startsWith("w");
        String extend = loadMatcher.group(4) == null ? null : loadMatcher.group(4).toUpperCase(Locale.ROOT);
        int indexShift = loadMatcher.group(5) == null ? 0 : Integer.parseInt(loadMatcher.group(5), 16);
        if (wordIndex ? !"UXTW".equals(extend) : "UXTW".equals(extend)) return null;
        if (indexShift != (entrySize == 1 ? 0 : 1)) return null;

        // Only ADR and one CBZ on the entry may sit between load and ADD.
        Address nullTarget = null;
        for (int index = loadIndex + 1; index < branchIndex - 1; index += 1) {
            Instruction instruction = instructions.get(index);
            String name = mnemonic(instruction);
            if (name.equals("ADR")) continue;
            if (name.equals("CBZ") && nullTarget == null) {
                String[] parts = operands(instruction).split(",");
                Address[] flows = instruction.getFlows();
                if (parts.length != 2 || flows.length != 1 ||
                    !normalizedRegister(parts[0]).equals(entryRegister)) return null;
                nullTarget = flows[0];
                continue;
            }
            return null;
        }

        int baseIndex = latestWriter(instructions, branchIndex - 1, baseRegister);
        if (baseIndex < 0 || !mnemonic(instructions.get(baseIndex)).equals("ADR")) return null;
        java.util.regex.Matcher baseMatcher = AARCH64_REGISTER_AND_ADDRESS.matcher(operands(instructions.get(baseIndex)));
        if (!baseMatcher.matches()) return null;
        Address branchBase = addressFromOperand(baseMatcher.group(2));

        int tableAddIndex = latestWriter(instructions, loadIndex, tableBaseRegister);
        if (tableAddIndex < 0 || !mnemonic(instructions.get(tableAddIndex)).equals("ADD")) return null;
        java.util.regex.Matcher tableAddMatcher = AARCH64_ADD_IMMEDIATE.matcher(operands(instructions.get(tableAddIndex)));
        if (!tableAddMatcher.matches() ||
            !normalizedRegister(tableAddMatcher.group(1)).equals(tableBaseRegister) ||
            !normalizedRegister(tableAddMatcher.group(2)).equals(tableBaseRegister)) return null;
        int tablePageIndex = latestWriter(instructions, tableAddIndex, tableBaseRegister);
        if (tablePageIndex < 0 || !mnemonic(instructions.get(tablePageIndex)).equals("ADRP")) return null;
        java.util.regex.Matcher pageMatcher = AARCH64_REGISTER_AND_ADDRESS.matcher(operands(instructions.get(tablePageIndex)));
        if (!pageMatcher.matches() || !normalizedRegister(pageMatcher.group(1)).equals(tableBaseRegister)) return null;
        Address tableAddress = addressFromOperand(pageMatcher.group(2)).add(parseInteger(tableAddMatcher.group(3)));
        if (!currentProgram.getMemory().contains(tableAddress) ||
            (!dataAddresses.isEmpty() && !dataAddresses.contains(tableAddress))) return null;

        // Unsigned guard: CMP Rs, #imm, then B.HI (imm + 1 entries) or
        // B.CS/B.HS (imm entries), with only flag-preserving moves and
        // address arithmetic between the compare and the load.
        int guardIndex = -1;
        for (int index = loadIndex - 1; index >= 0; index -= 1) {
            String name = mnemonic(instructions.get(index));
            if (name.startsWith("B.")) {
                guardIndex = index;
                break;
            }
            if (!AARCH64_FLAG_PRESERVING.contains(name)) return null;
        }
        if (guardIndex < 1) return null;
        Instruction guard = instructions.get(guardIndex);
        String guardMnemonic = mnemonic(guard);
        if (!Set.of("B.HI", "B.CS", "B.HS").contains(guardMnemonic)) return null;
        Address[] guardFlows = guard.getFlows();
        if (guardFlows.length != 1) return null;
        Address defaultTarget = guardFlows[0];
        int compareIndex = -1;
        for (int index = guardIndex - 1; index >= 0; index -= 1) {
            String name = mnemonic(instructions.get(index));
            if (name.equals("CMP")) {
                compareIndex = index;
                break;
            }
            if (!AARCH64_FLAG_PRESERVING.contains(name)) return null;
        }
        if (compareIndex < 0) return null;
        java.util.regex.Matcher compareMatcher = AARCH64_COMPARE_IMMEDIATE.matcher(operands(instructions.get(compareIndex)));
        if (!compareMatcher.matches()) return null;
        String comparedRegister = normalizedRegister(compareMatcher.group(1));
        boolean comparedFullWidth = compareMatcher.group(1).toLowerCase(Locale.ROOT).startsWith("x");
        long compareImmediate = parseInteger(compareMatcher.group(2));
        long entryCountLong = guardMnemonic.equals("B.HI") ? compareImmediate + 1 : compareImmediate;
        if (entryCountLong <= 0 || entryCountLong > 4096) return null;
        int entryCount = (int) entryCountLong;

        // The loaded index must carry the compared value: either the compared
        // register itself, unchanged since CMP, or a MOV copy made after CMP.
        // A W compare bounds only the low 32 bits, so an X index needs a
        // zero-extending W copy; a W index is zero-extended by UXTW.
        int indexWriter = latestWriter(instructions, loadIndex, indexRegister);
        boolean bounded = false;
        if (indexWriter < compareIndex) {
            bounded = indexRegister.equals(comparedRegister) && (wordIndex || comparedFullWidth);
        }
        else if (mnemonic(instructions.get(indexWriter)).equals("MOV")) {
            java.util.regex.Matcher moveMatcher = AARCH64_MOVE_REGISTER.matcher(operands(instructions.get(indexWriter)));
            if (moveMatcher.matches() &&
                normalizedRegister(moveMatcher.group(2)).equals(comparedRegister) &&
                latestWriter(instructions, indexWriter, comparedRegister) < compareIndex) {
                boolean wordCopy = moveMatcher.group(1).toLowerCase(Locale.ROOT).startsWith("w");
                bounded = wordCopy || comparedFullWidth;
            }
        }
        if (!bounded) return null;

        // Every fact above holds only on one straight-line fall-through path
        // with no other entry into the window.
        int windowStart = Math.min(Math.min(tablePageIndex, baseIndex), compareIndex);
        for (int index = windowStart + 1; index <= branchIndex; index += 1) {
            monitor.checkCancelled();
            Instruction previous = instructions.get(index - 1);
            Instruction current = instructions.get(index);
            Address fallThrough = previous.getFallThrough();
            if (fallThrough == null || !fallThrough.equals(current.getAddress())) return null;
            ReferenceIterator incoming = currentProgram.getReferenceManager().getReferencesTo(current.getAddress());
            while (incoming.hasNext()) {
                if (incoming.next().getReferenceType().isFlow()) return null;
            }
        }

        List<RecoveredAArch64Mapping> mappings = new ArrayList<>();
        Set<String> mappedTargets = new HashSet<>();
        for (int tableIndex = 0; tableIndex < entryCount; tableIndex += 1) {
            monitor.checkCancelled();
            Address entry = tableAddress.add((long) tableIndex * entrySize);
            if (!currentProgram.getMemory().contains(entry)) return null;
            long encoded;
            if (entrySize == 1) {
                byte value = currentProgram.getMemory().getByte(entry);
                encoded = signedEntries ? value : value & 0xffL;
            }
            else {
                short value = currentProgram.getMemory().getShort(entry);
                encoded = signedEntries ? value : value & 0xffffL;
            }
            if (encoded == 0 && nullTarget != null) {
                mappings.add(new RecoveredAArch64Mapping(tableIndex, nullTarget, encoded, true));
                continue;
            }
            Address target;
            try {
                target = branchBase.addNoWrap(encoded << offsetShift);
            }
            catch (ghidra.program.model.address.AddressOverflowException overflow) {
                return null;
            }
            String canonicalTarget = canonicalAddress(target);
            if (!recoveredTargetSet.contains(canonicalTarget)) return null;
            mappedTargets.add(canonicalTarget);
            mappings.add(new RecoveredAArch64Mapping(tableIndex, target, encoded, false));
        }
        if (mappedTargets.contains(canonicalAddress(defaultTarget))) return null;
        // Ghidra's recovered destinations must be fully accounted for by the
        // decoded entries, the guard default, and the CBZ null path.
        Set<String> accountedTargets = new HashSet<>(mappedTargets);
        accountedTargets.add(canonicalAddress(defaultTarget));
        if (nullTarget != null) accountedTargets.add(canonicalAddress(nullTarget));
        // Ghidra does not model the CBZ, so it may decode a zero entry as a
        // branch to the base itself. Only a zero entry encodes offset 0, and
        // the CBZ diverts every zero entry, so the BR never reaches the base.
        Address unreachableZeroTarget = null;
        boolean divertedZeroEntry = mappings.stream().anyMatch(mapping -> mapping.nullEntry);
        if (divertedZeroEntry &&
            recoveredTargetSet.contains(canonicalAddress(branchBase)) &&
            !mappedTargets.contains(canonicalAddress(branchBase)) &&
            !branchBase.equals(defaultTarget) &&
            !branchBase.equals(nullTarget)) {
            unreachableZeroTarget = branchBase;
            accountedTargets.add(canonicalAddress(branchBase));
        }
        if (!accountedTargets.containsAll(recoveredTargetSet)) return null;
        int selectorWriter = latestWriter(instructions, compareIndex, comparedRegister);
        return new RecoveredAArch64RelativeTable(
            tableAddress,
            branchBase,
            entrySize,
            selectorWriter < 0 ? null : instructions.get(selectorWriter).getAddress(),
            signedEntries,
            offsetShift,
            guardMnemonic,
            compareImmediate,
            nullTarget,
            unreachableZeroTarget,
            List.copyOf(mappings)
        );
    }

    private static String mnemonic(Instruction instruction) {
        return instruction.getMnemonicString().toUpperCase(Locale.ROOT);
    }

    /** Index of the last instruction before {@code before} that writes {@code register}, or -1. */
    private static int latestWriter(List<Instruction> instructions, int before, String register) {
        for (int index = before - 1; index >= 0; index -= 1) {
            for (Object result : instructions.get(index).getResultObjects()) {
                if (result instanceof Register written &&
                    normalizedRegister(written.getBaseRegister().getName()).equals(register)) {
                    return index;
                }
            }
        }
        return -1;
    }

    private static String operands(Instruction instruction) {
        List<String> values = new ArrayList<>();
        for (int index = 0; index < instruction.getNumOperands(); index += 1) {
            values.add(instruction.getDefaultOperandRepresentation(index));
        }
        return String.join(", ", values);
    }

    private static String normalizedRegister(String value) {
        String register = value.trim().toLowerCase(Locale.ROOT);
        return register.matches("[wx]\\d+") ? "r" + register.substring(1) : register;
    }

    private static long parseInteger(String value) {
        String number = value.toLowerCase(Locale.ROOT);
        return number.startsWith("0x")
            ? Long.parseUnsignedLong(number.substring(2), 16)
            : Long.parseLong(number);
    }

    private Address addressFromOperand(String value) {
        String hex = value.trim().replaceFirst("(?i)^0x", "");
        return currentProgram.getAddressFactory().getDefaultAddressSpace()
            .getAddress(Long.parseUnsignedLong(hex, 16));
    }

    private List<Address> dispatchPathDataReferences(JumpTable jumpTable)
        throws Exception {
        BasicBlockModel model = new BasicBlockModel(currentProgram, false);
        CodeBlock dispatchBlock = model.getFirstCodeBlockContaining(
            jumpTable.getSwitchAddress(),
            monitor
        );
        if (dispatchBlock == null) {
            return List.of();
        }
        List<CodeBlock> blocks = new ArrayList<>();
        blocks.add(dispatchBlock);
        CodeBlockReferenceIterator sources = dispatchBlock.getSources(monitor);
        while (sources.hasNext()) {
            monitor.checkCancelled();
            CodeBlock sourceBlock = sources.next().getSourceBlock();
            if (sourceBlock != null) {
                blocks.add(sourceBlock);
            }
        }
        Set<Address> addresses = new HashSet<>();
        for (CodeBlock block : blocks) {
            InstructionIterator instructions = currentProgram
                .getListing()
                .getInstructions(block, true);
            while (instructions.hasNext()) {
                monitor.checkCancelled();
                Instruction instruction = instructions.next();
                for (
                    Reference reference : currentProgram
                        .getReferenceManager()
                        .getReferencesFrom(instruction.getAddress())
                ) {
                    if (
                        reference.getReferenceType().isData() &&
                        currentProgram
                            .getMemory()
                            .getLoadedAndInitializedAddressSet()
                            .contains(reference.getToAddress())
                    ) {
                        addresses.add(reference.getToAddress());
                    }
                }
            }
        }
        List<Address> ordered = new ArrayList<>(addresses);
        ordered.sort(Address::compareTo);
        return List.copyOf(ordered);
    }

    private static JsonObject inferenceEvidence(
        String kind,
        String source,
        String detail
    ) {
        JsonObject evidence = new JsonObject();
        evidence.addProperty("kind", kind);
        evidence.addProperty("source", source);
        evidence.addProperty("detail", detail);
        return evidence;
    }

    private static String inferenceConfidence(
        String signatureSource,
        boolean typeLocked
    ) {
        if (
            typeLocked ||
            signatureSource.equals("user_defined") ||
            signatureSource.equals("imported")
        ) {
            return "high";
        }
        return signatureSource.equals("analysis") ? "medium" : "low";
    }

    private DecompileResults decompile(Function function) {
        if (function.isExternal() || function.getBody().isEmpty()) {
            return null;
        }
        DecompileResults results = decompiler.decompileFunction(
            function,
            decompileTimeoutSeconds,
            monitor
        );
        if (results.isCancelled()) {
            throw new RequestFailure("decompile_cancelled", "Ghidra decompilation was cancelled");
        }
        // DecompInterface disposes the native process at the limit and starts a
        // fresh one for the next request, so the session stays usable.
        if (results.isTimedOut()) {
            throw new RequestFailure(
                "decompile_timed_out",
                "Ghidra decompilation of " + canonicalAddress(function.getEntryPoint()) +
                " exceeded the " + decompileTimeoutSeconds +
                "-second configured decompilation limit (ghidra.decompile_timeout_seconds; launch seed REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS)"
            );
        }
        if (!results.decompileCompleted()) {
            throw new RequestFailure(
                "decompile_failed",
                "Ghidra decompilation failed: " + diagnosticMessage(results.getErrorMessage())
            );
        }
        return results;
    }

    private static String decompiledText(DecompileResults results) {
        if (results == null) {
            return null;
        }
        DecompiledFunction value = results.getDecompiledFunction();
        return value == null ? null : value.getC();
    }

    private InstructionScan scanInstructions(Function function, int maximum) throws Exception {
        InstructionIterator iterator = currentProgram.getListing().getInstructions(
            function.getBody(),
            true
        );
        List<Instruction> instructions = new ArrayList<>();
        while (iterator.hasNext() && instructions.size() < maximum) {
            monitor.checkCancelled();
            instructions.add(iterator.next());
        }
        return new InstructionScan(List.copyOf(instructions), iterator.hasNext());
    }

    private JsonObject functionObservation(
            JsonElement value,
            List<String> limitations) {
        JsonObject result = new JsonObject();
        result.add("value", value);
        result.add("limitations", GSON.toJsonTree(limitations));
        return result;
    }

    private static JsonObject facetAvailability(boolean available, String reason) {
        JsonObject result = new JsonObject();
        result.addProperty("available", available);
        if (!available) result.addProperty("reason", reason);
        return result;
    }

    private JsonObject callRelationshipObservation(JsonElement value, CallBoundaryObservation calls)
            throws Exception {
        monitor.checkCancelled();
        JsonObject result = functionObservation(value, calls.limitations());
        result.add("relationship_coverage", callRelationshipCoverage(calls, null));
        return result;
    }

    private static JsonObject callRelationshipCoverage(
            CallBoundaryObservation calls, Integer missingCallers) {
        JsonObject coverage = completeResolvedCallCoverage();
        Integer omitted = calls == null ? null : calls.unrepresentedCalleeCalls();
        JsonArray directions = new JsonArray();
        if (missingCallers != null && missingCallers > 0) directions.add("callers");
        String callerLimitation = missingCallers != null && missingCallers > 0
            ? "Ghidra's caller inventory omits sources of " + missingCallers +
                " call reference(s) into this function's body." : null;
        if ((calls != null && omitted == null) || (calls == null && missingCallers == null)) {
            coverage.addProperty("status", "unknown");
            String reason = calls == null ? "No call inventory was examined."
                : "The callee inventory was not examined alongside decoded call targets.";
            coverage.addProperty("reason", reason + (callerLimitation == null ? "" : " " + callerLimitation));
            if (calls == null && missingCallers == null) directions.add("callers");
            directions.add("callees");
            coverage.add("limited_directions", directions);
            return coverage;
        }
        JsonArray limitations = new JsonArray();
        if (callerLimitation != null) limitations.add(callerLimitation);
        if (omitted != null && omitted > 0) {
            limitations.add("Ghidra's callee inventory omits targets of " + omitted +
                " call reference(s) or decoded call(s) without destinations.");
            directions.add("callees");
        }
        if (!limitations.isEmpty()) {
            coverage.addProperty("status", "partial");
            coverage.add("limitations", limitations);
            coverage.add("limited_directions", directions);
        }
        return coverage;
    }

    private static JsonObject completeResolvedCallCoverage() {
        JsonObject coverage = new JsonObject();
        coverage.addProperty("status", "complete");
        JsonArray diagnostics = new JsonArray();
        diagnostics.add(
            "Only resolved Ghidra call references are returned; unresolved computed or indirect calls remain unknown, while function classifications distinguish thunks and externals."
        );
        coverage.add("diagnostics", diagnostics);
        return coverage;
    }

    private boolean unrepresentedCaller(Reference reference, Set<Function> callers) {
        if (!reference.getReferenceType().isCall()) return false;
        Function caller = functionAtOrContaining(reference.getFromAddress());
        return caller == null || !callers.contains(caller);
    }

    private int unrepresentedIncomingCalls(Function function, Set<Function> callers)
            throws Exception {
        int[] omitted = { 0 };
        visitReferences(function, "incoming", reference -> {
            if (unrepresentedCaller(reference, callers)) omitted[0]++;
        });
        return omitted[0];
    }

    private List<String> functionBoundaryLimitations(
            Function function, Iterable<Instruction> instructions)
            throws Exception {
        FunctionBoundaryLimitations boundary = new FunctionBoundaryLimitations(function);
        for (Instruction instruction : instructions) boundary.observe(instruction);
        return boundary.values();
    }

    private CallBoundaryObservation callBoundaryObservation(
            Function function, Iterable<Instruction> instructions, Set<Function> returnedCallees,
            boolean includeUnresolvedSites, List<Reference> observedReferences)
            throws Exception {
        FunctionBoundaryLimitations boundary = new FunctionBoundaryLimitations(function);
        CallBoundaryReferences calls = new CallBoundaryReferences(returnedCallees, includeUnresolvedSites);
        if (observedReferences == null) visitReferences(function, "outgoing", calls::observe);
        else for (Reference reference : observedReferences) {
            monitor.checkCancelled();
            calls.observe(reference);
        }
        for (Instruction instruction : instructions) {
            boundary.observe(instruction);
            if (!instruction.getFlowType().isCall()) continue;
            boolean destination = false;
            for (Reference reference : instruction.getReferencesFrom()) {
                if (!reference.getReferenceType().isCall()) continue;
                destination = true;
                break;
            }
            if (!destination) {
                calls.unrepresented++;
                calls.unresolved(instruction.getAddress(),
                    "Instruction decoder identifies a call but ReferenceManager supplies no call destination");
            }
        }
        return new CallBoundaryObservation(boundary.values(),
            returnedCallees == null ? null : calls.unrepresented, calls.unresolvedCalls());
    }

    private final class FunctionBoundaryLimitations {
        private final Function function;
        private final List<String> limitations = new ArrayList<>();
        private Instruction beforePrevious;
        private Instruction previous;

        private FunctionBoundaryLimitations(Function function) {
            this.function = function;
        }

        private void observe(Instruction instruction) throws Exception {
            monitor.checkCancelled();
            String limitation = terminalCallLimitation(instruction);
            if (limitation != null) limitations.add(limitation);
            if (beforePrevious != null && previous != null) {
                String seh = borlandSehHandlerLimitation(
                    function, beforePrevious, previous, instruction);
                if (seh != null) limitations.add(seh);
            }
            beforePrevious = previous;
            previous = instruction;
        }

        private List<String> values() {
            return List.copyOf(limitations);
        }
    }

    private String borlandSehHandlerLimitation(
            Function function, Instruction handlerPush, Instruction framePush,
            Instruction frameLink) {
        if (!immediatelyPrecedes(handlerPush, framePush) ||
            !immediatelyPrecedes(framePush, frameLink) ||
            !handlerPush.getMnemonicString().equalsIgnoreCase("PUSH") ||
            handlerPush.getNumOperands() != 1 ||
            !framePush.getMnemonicString().equalsIgnoreCase("PUSH") ||
            framePush.getNumOperands() != 1 ||
            !frameLink.getMnemonicString().equalsIgnoreCase("MOV") ||
            frameLink.getNumOperands() != 2 ||
            !sameFsMemoryOperand(framePush, frameLink) ||
            !hasRegisterOperand(frameLink, 1, "ESP"))
            return null;
        Object[] handlerOperand = handlerPush.getOpObjects(0);
        if (handlerOperand.length != 1 || !(handlerOperand[0] instanceof Scalar scalar) ||
            scalar.bitLength() != 32)
            return null;
        Address handler = currentProgram.getAddressFactory().getDefaultAddressSpace()
            .getAddress(scalar.getUnsignedValue());
        if (function.getBody().contains(handler)) return null;
        return "Ghidra Listing shows a Borland/Delphi-style SEH frame registration at " +
            canonicalAddress(frameLink.getAddress()) + " (push " + canonicalAddress(handler) +
            " followed by fs-segment stack chaining); handler " + canonicalAddress(handler) +
            " lies outside this procedure's body, so callees, strings, and cross-references may omit the handler region.";
    }

    private static boolean immediatelyPrecedes(Instruction first, Instruction second) {
        Address fallThrough = first.getFallThrough();
        return fallThrough != null && fallThrough.equals(second.getAddress());
    }

    private static boolean sameFsMemoryOperand(Instruction first, Instruction second) {
        String firstOperand = normalizedFsMemoryOperand(first);
        String secondOperand = normalizedFsMemoryOperand(second);
        return firstOperand != null && firstOperand.equalsIgnoreCase(secondOperand);
    }

    private static String normalizedFsMemoryOperand(Instruction instruction) {
        String representation = instruction.getDefaultOperandRepresentation(0);
        representation = representation.replaceAll("(?i)\\b(?:byte|word|dword|qword)\\s+ptr\\s+", "")
            .replaceAll("\\s+", "");
        return representation.regionMatches(true, 0, "fs:", 0, 3) &&
            representation.indexOf('[') >= 0 ? representation : null;
    }

    private static boolean hasRegisterOperand(
            Instruction instruction, int operand, String name) {
        for (Object object : instruction.getOpObjects(operand)) {
            if (object instanceof Register register && register.getName().equalsIgnoreCase(name))
                return true;
        }
        return false;
    }

    private final class CallBoundaryReferences {
        private final Set<Function> returnedCallees;
        private final TreeMap<Address, String> unresolved;
        private int unrepresented;

        CallBoundaryReferences(Set<Function> returnedCallees, boolean includeUnresolvedSites) {
            this.returnedCallees = returnedCallees;
            unresolved = includeUnresolvedSites ? new TreeMap<>() : null;
        }

        void observe(Reference reference) {
            if (!reference.getReferenceType().isCall()) return;
            // Reference identity follows the same containing-function owner as referenceEdge.
            Function target = functionAtOrContaining(reference.getToAddress());
            if (returnedCallees != null && (target == null || !returnedCallees.contains(target)))
                unrepresented++;
            if (target == null) unresolved(reference.getFromAddress(),
                "A call destination has no known containing Ghidra procedure");
        }

        void unresolved(Address address, String reason) {
            if (unresolved != null) unresolved.put(address, reason);
        }

        JsonArray unresolvedCalls() {
            if (unresolved == null) return null;
            JsonArray result = new JsonArray();
            for (var item : unresolved.entrySet()) {
                JsonObject site = new JsonObject();
                site.addProperty("address", canonicalAddress(item.getKey()));
                site.addProperty("reason", item.getValue());
                result.add(site);
            }
            return result;
        }
    }

    private String terminalCallLimitation(Instruction instruction) {
        if (!instruction.getFlowType().isCall() || !instruction.getFlowType().isTerminal())
            return null;
        Address[] destinations = instruction.getFlows();
        StringBuilder limitation = new StringBuilder();
        limitation.append("Ghidra Listing reports a terminal call at ")
            .append(canonicalAddress(instruction.getAddress()));
        if (destinations.length == 0) {
            limitation.append(" with no resolved callee; its no-return basis is unknown.");
        }
        else {
            limitation.append(" to ");
            for (int index = 0; index < destinations.length; index++) {
                if (index > 0) limitation.append(", ");
                Address destination = destinations[index];
                limitation.append(canonicalAddress(destination));
                Function target = currentProgram.getFunctionManager().getFunctionAt(destination);
                if (target == null) {
                    limitation.append(" (callee identity unknown)");
                }
                else {
                    limitation.append(" ").append(procedureName(target));
                    limitation.append(" (external=").append(target.isExternal());
                    limitation.append(", thunk=").append(target.isThunk());
                    limitation.append(", hasNoReturn=").append(target.hasNoReturn()).append(")");
                }
            }
            limitation.append("; fallthrough is excluded by Ghidra's flow model.");
            Function target = destinations.length == 1
                ? currentProgram.getFunctionManager().getFunctionAt(destinations[0])
                : null;
            if (target != null && target.hasNoReturn()) {
                limitation.append(" This records Ghidra's FunctionManager flag, not an independent verification that the callee cannot return.");
            }
            else {
                limitation.append(" The reason for the terminal flow is not established by this observation.");
            }
        }
        return limitation.toString();
    }

    private static String renderAssembly(List<Instruction> instructions) {
        return String.join("\n", renderAssemblyLines(instructions));
    }

    private static List<String> renderAssemblyLines(List<Instruction> instructions) {
        List<String> result = new ArrayList<>();
        for (Instruction instruction : instructions) {
            StringBuilder line = new StringBuilder();
            line.append(canonicalAddress(instruction.getAddress()));
            line.append(": ");
            line.append(instruction.getMnemonicString());
            for (int index = 0; index < instruction.getNumOperands(); index += 1) {
                line.append(index == 0 ? " " : ", ");
                line.append(instruction.getDefaultOperandRepresentation(index));
            }
            result.add(line.toString());
        }
        return result;
    }

    private List<Reference> collectReferences(
            Function function,
            String direction) throws Exception {
        TreeMap<String, Reference> observed = new TreeMap<>();
        visitReferences(function, direction, reference -> addReference(observed, reference));
        List<Reference> result = new ArrayList<>(observed.values());
        result.sort(REFERENCE_ORDER);
        return result;
    }

    @FunctionalInterface
    private interface ReferenceVisitor {
        void accept(Reference reference) throws Exception;
    }

    private void visitReferences(Function function, String direction, ReferenceVisitor visitor)
            throws Exception {
        // References can target instruction interiors or originate in embedded
        // data. Use actual body ownership, including an external's exact entry.
        AddressSet scope = functionObservationScope(function);
        boolean outgoing = direction.equals("outgoing");
        AddressIterator addresses = outgoing
            ? currentProgram.getReferenceManager().getReferenceSourceIterator(scope, true)
            : currentProgram.getReferenceManager().getReferenceDestinationIterator(scope, true);
        while (addresses.hasNext()) {
            monitor.checkCancelled();
            Address address = addresses.next();
            if (outgoing) {
                visitObservedReferencesFrom(address, visitor);
            }
            else {
                visitObservedReferencesTo(address, visitor);
            }
        }
    }

    private void visitObservedReferencesFrom(Address address, ReferenceVisitor visitor)
            throws Exception {
        for (Reference reference : currentProgram.getReferenceManager().getReferencesFrom(address)) {
            monitor.checkCancelled();
            visitObservedReference(reference, visitor);
        }
    }

    private void visitObservedReferencesTo(Address address, ReferenceVisitor visitor)
            throws Exception {
        ReferenceIterator references = currentProgram.getReferenceManager().getReferencesTo(address);
        while (references.hasNext()) {
            monitor.checkCancelled();
            visitObservedReference(references.next(), visitor);
        }
    }

    private static void visitObservedReference(Reference reference, ReferenceVisitor visitor)
            throws Exception {
        if (!reference.isEntryPointReference()) visitor.accept(reference);
    }

    private static void addReference(TreeMap<String, Reference> observed, Reference reference) {
        String key = canonicalAddress(reference.getFromAddress()) + "\u0000" +
            canonicalAddress(reference.getToAddress()) + "\u0000" +
            reference.getReferenceType().getName() + "\u0000" +
            reference.getOperandIndex() + "\u0000" +
            reference.isPrimary();
        observed.putIfAbsent(key, reference);
    }

    private static AddressSet functionObservationScope(Function function) {
        AddressSet scope = new AddressSet(function.getBody());
        scope.add(function.getEntryPoint());
        return scope;
    }

    private JsonArray referenceEdges(List<Reference> references) {
        JsonArray result = new JsonArray();
        for (Reference reference : references) {
            result.add(referenceEdge(reference));
        }
        return result;
    }

    private JsonObject referenceEdge(Reference reference) {
        JsonObject result = new JsonObject();
        result.addProperty("source_address", canonicalAddress(reference.getFromAddress()));
        result.addProperty("target_address", canonicalAddress(reference.getToAddress()));
        Function source = functionAtOrContaining(reference.getFromAddress());
        Function target = functionAtOrContaining(reference.getToAddress());
        result.add(
            "source_procedure",
            source == null ? JsonNull.INSTANCE : procedureIdentity(source)
        );
        result.add(
            "target_procedure",
            target == null ? JsonNull.INSTANCE : procedureIdentity(target)
        );
        result.add("kind", referenceKind(reference));
        return result;
    }

    private static JsonObject referenceKind(Reference reference) {
        RefType type = reference.getReferenceType();
        JsonObject result = new JsonObject();
        result.addProperty("available", true);
        result.addProperty("provenance", "ghidra-reference-manager");
        result.addProperty("type", type.getName());
        result.addProperty("flow", type.isFlow());
        result.addProperty("call", type.isCall());
        result.addProperty("jump", type.isJump());
        result.addProperty("data", type.isData());
        result.addProperty("read", type.isRead());
        result.addProperty("write", type.isWrite());
        result.addProperty("indirect", type.isIndirect());
        result.addProperty("computed", type.isComputed());
        result.addProperty("conditional", type.isConditional());
        result.addProperty("terminal", type.isTerminal());
        result.addProperty("primary", reference.isPrimary());
        result.addProperty("operand_index", reference.getOperandIndex());
        result.addProperty("external", reference.isExternalReference());
        return result;
    }

    private static String procedureName(Function function) {
        Symbol symbol = function.getSymbol();
        return symbol == null ? function.getName() : symbol.getName(true);
    }

    private static JsonObject functionClassification(Function function) {
        JsonObject result = new JsonObject();
        result.addProperty("external", function.isExternal());
        result.addProperty("thunk", function.isThunk());
        Function target = function.isThunk() ? function.getThunkedFunction(false) : null;
        if (target == null) {
            result.add("thunk_target", JsonNull.INSTANCE);
        }
        else {
            result.addProperty("thunk_target", canonicalAddress(target.getEntryPoint()));
        }
        result.addProperty("provenance", "ghidra-function-manager");
        return result;
    }

    private static JsonArray functionLocals(Function function) {
        Variable[] variables = function.getLocalVariables();
        List<Variable> ordered = new ArrayList<>(List.of(variables));
        ordered.sort(
            Comparator.comparing(Variable::getName)
                .thenComparing(variable -> variable.getVariableStorage().toString())
        );
        JsonArray result = new JsonArray();
        for (Variable variable : ordered) {
            JsonObject item = new JsonObject();
            item.addProperty(
                "description",
                variable.getDataType().getDisplayName() + " " + variable.getName() +
                    " @ " + variable.getVariableStorage()
            );
            item.addProperty("provenance", "ghidra-function-database");
            result.add(item);
        }
        return result;
    }

    private JsonArray procedureIdentities(Set<Function> functions) {
        List<Function> ordered = new ArrayList<>(functions);
        ordered.sort(Comparator.comparing(Function::getEntryPoint));
        JsonArray result = new JsonArray();
        for (Function function : ordered) {
            result.add(procedureIdentity(function));
        }
        return result;
    }

    private List<CodeBlock> basicBlocks(Function function) throws Exception {
        BasicBlockModel model = new BasicBlockModel(currentProgram, false);
        CodeBlockIterator iterator = model.getCodeBlocksContaining(function.getBody(), monitor);
        List<CodeBlock> result = new ArrayList<>();
        while (iterator.hasNext()) {
            monitor.checkCancelled();
            result.add(iterator.next());
        }
        result.sort(Comparator.comparing(CodeBlock::getFirstStartAddress));
        return result;
    }

    private JsonArray basicBlockValues(Function function) throws Exception {
        JsonArray result = new JsonArray();
        for (CodeBlock block : basicBlocks(function)) {
            JsonObject item = new JsonObject();
            item.addProperty("start", canonicalAddress(block.getFirstStartAddress()));
            item.addProperty("end", exclusiveAddress(block.getMaxAddress()));
            Set<Address> successors = new HashSet<>();
            CodeBlockReferenceIterator destinations = block.getDestinations(monitor);
            while (destinations.hasNext()) {
                CodeBlockReference destination = destinations.next();
                CodeBlock destinationBlock = destination.getDestinationBlock();
                if (destinationBlock == null) {
                    continue;
                }
                Address address = destinationBlock.getFirstStartAddress();
                if (
                    !destination.getFlowType().isCall() &&
                    function.getBody().contains(address)
                ) {
                    successors.add(address);
                }
            }
            List<Address> ordered = new ArrayList<>(successors);
            ordered.sort(Address::compareTo);
            JsonArray values = new JsonArray();
            for (Address address : ordered) {
                values.add(canonicalAddress(address));
            }
            item.add("successors", values);
            result.add(item);
        }
        return result;
    }

    private JsonArray comments(Function function) throws Exception {
        Listing listing = currentProgram.getListing();
        AddressSet scope = functionObservationScope(function);
        AddressIterator addresses = listing.getCommentAddressIterator(scope, true);
        TreeMap<String, JsonObject> observed = new TreeMap<>();
        while (addresses.hasNext()) {
            monitor.checkCancelled();
            Address address = addresses.next();
            for (CommentType type : CommentType.values()) {
                String text = listing.getComment(type, address);
                if (text == null || text.isEmpty()) {
                    continue;
                }
                String kind = type == CommentType.EOL ? "inline" : "comment";
                JsonObject item = new JsonObject();
                item.addProperty("address", canonicalAddress(address));
                item.addProperty("kind", kind);
                item.addProperty("text", text);
                String key = canonicalAddress(address) + "\u0000" +
                    kind + "\u0000" + type.name() + "\u0000" + text;
                observed.put(key, item);
            }
        }
        JsonArray result = new JsonArray();
        observed.values().forEach(result::add);
        return result;
    }

    private JsonArray referencedStrings(List<Reference> references) {
        TreeMap<String, JsonObject> observed = new TreeMap<>();
        for (Reference reference : references) {
            Data data = currentProgram.getListing().getDefinedDataContaining(
                reference.getToAddress()
            );
            if (data == null || !data.hasStringValue()) {
                continue;
            }
            String value = StringDataInstance.getStringDataInstance(data).getStringValue();
            if (value == null) {
                continue;
            }
            JsonObject item = new JsonObject();
            item.addProperty("address", canonicalAddress(data.getAddress()));
            item.addProperty("value", value);
            item.addProperty("source_address", canonicalAddress(reference.getFromAddress()));
            String key = canonicalAddress(data.getAddress()) + "\u0000" + value + "\u0000" +
                canonicalAddress(reference.getFromAddress());
            observed.put(key, item);
            }
        JsonArray result = new JsonArray();
        observed.values().forEach(result::add);
        return result;
    }

    private JsonArray referencedNames(List<Reference> references) {
        TreeMap<String, JsonObject> observed = new TreeMap<>();
        for (Reference reference : references) {
            Symbol symbol = currentProgram.getSymbolTable().getPrimarySymbol(
                reference.getToAddress()
            );
            if (symbol == null) {
                continue;
            }
            JsonObject item = new JsonObject();
            item.addProperty("address", canonicalAddress(reference.getToAddress()));
            item.addProperty("value", symbol.getName(true));
            item.addProperty("source_address", canonicalAddress(reference.getFromAddress()));
            String key = canonicalAddress(reference.getToAddress()) + "\u0000" +
                symbol.getName(true) + "\u0000" + canonicalAddress(reference.getFromAddress());
            observed.put(key, item);
            }
        JsonArray result = new JsonArray();
        observed.values().forEach(result::add);
        return result;
    }

    private boolean swiftProgram() {
        for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
            String name = block.getName();
            if (name.startsWith("__swift5_") || name.startsWith("swift5_")) return true;
        }
        return false;
    }

    /**
     * Swift passes a String as two words: small literals carry their bytes in the words and
     * immortal large literals carry their count and a biased pointer to the bytes. Ghidra keeps
     * neither as a data reference, so decode constant pairs where Swift consumes them: argument
     * and return registers at calls, tail calls and returns, and both registers of one STP.
     * The canonical empty string is a small literal with a zero count.
     */
    private SwiftStringLiteralDecode swiftStringLiterals(Function function) throws Exception {
        return swiftStringLiterals(function, new SwiftLiteralBudget());
    }

    // An explicit budget makes capacity omissions deterministic in producer tests.
    private SwiftStringLiteralDecode swiftStringLiterals(
        Function function,
        SwiftLiteralBudget budget
    ) throws Exception {
        Register[] registers = new Register[31];
        for (int index = 0; index < registers.length; index++) {
            registers[index] = currentProgram.getRegister("x" + index);
        }
        TreeMap<String, JsonObject> observed = new TreeMap<>();
        TreeMap<String, JsonObject> omitted = new TreeMap<>();
        Map<String, Boolean> selectedValues = new HashMap<>();
        SymbolicPropogator propagator = new SymbolicPropogator(currentProgram, false);
        propagator.flowConstants(function.getEntryPoint(), function.getBody(), new ContextEvaluatorAdapter() {
            @Override
            public boolean evaluateContextBefore(VarnodeContext context, Instruction instruction) {
                // Returning true ends only the current flow, so every queued flow checks the shared stop.
                if (budget.stopped()) return true;
                FlowType flow = instruction.getFlowType();
                Address[] flowTargets = instruction.getFlows();
                boolean unresolvedJump = flow.isJump() && !flow.isConditional() && flowTargets.length == 0;
                for (Register[] pair : swiftStringPairs(function, instruction, registers)) {
                    Long word = registerConstant(context, pair[0]);
                    Long object = registerConstant(context, pair[1]);
                    if (word == null || object == null) continue;
                    SwiftLiteralLayout layout = swiftLiteralLayout(word, object);
                    if (layout == null) continue;
                    // A selected word can combine with a path-dependent ordinary move. Cache the
                    // provenance question per site/register, charging retained cache state to the
                    // same dossier budget before allocating it.
                    boolean selected = false;
                    boolean provenanceOverCapacity = false;
                    for (Register register : pair) {
                        String provenanceKey = canonicalAddress(instruction.getAddress()) + "\u0000" +
                            register.getBaseRegister().getName();
                        Boolean value = selectedValues.get(provenanceKey);
                        if (value == null) {
                            if (!budget.takeState()) {
                                provenanceOverCapacity = true;
                                break;
                            }
                            value = selectedValue(function, instruction, register);
                            selectedValues.put(provenanceKey, value);
                        }
                        if (value) {
                            selected = true;
                            break;
                        }
                    }
                    if (selected) continue;
                    // Forks can reach one site with different constants, so the words are part of the key.
                    String key = canonicalAddress(instruction.getAddress()) + "\u0000" + pair[0].getName() +
                        "\u0000" + pair[1].getName() + "\u0000" + Long.toUnsignedString(word, 16) +
                        "\u0000" + Long.toUnsignedString(object, 16);
                    if (observed.containsKey(key) || omitted.containsKey(key)) continue;
                    // Every record draws on the budget; the first one that does not fit is kept as an
                    // omission and decoding stops, so later sites are never examined.
                    String value = layout.smallValue();
                    boolean overCapacity = provenanceOverCapacity || !budget.take(layout.byteLength());
                    if (!overCapacity && value == null) {
                        try {
                            value = swiftLargeLiteralText(layout);
                        } catch (OutOfMemoryError exhausted) {
                            overCapacity = true;
                        }
                    }
                    if (value == null && !overCapacity) continue;
                    JsonObject item = overCapacity
                        ? swiftStringOmission(layout, word, object)
                        : swiftStringItem(value, layout, word, object);
                    if (unresolvedJump && !overCapacity)
                        item = swiftStringOmission(layout, word, object, "unresolved_jump");
                    item.addProperty("source_address", canonicalAddress(instruction.getAddress()));
                    JsonArray pairRegisters = new JsonArray();
                    pairRegisters.add(pair[0].getName());
                    pairRegisters.add(pair[1].getName());
                    item.add("registers", pairRegisters);
                    (overCapacity || unresolvedJump ? omitted : observed).put(key, item);
                    if (overCapacity) {
                        budget.stop();
                        return true;
                    }
                }
                return false;
            }
        }, false, monitor);
        JsonArray literals = new JsonArray();
        observed.values().forEach(literals::add);
        JsonArray omissions = new JsonArray();
        omitted.values().forEach(omissions::add);
        return new SwiftStringLiteralDecode(literals, omissions);
    }

    private static List<Register[]> swiftStringPairs(
        Function function,
        Instruction instruction,
        Register[] registers
    ) {
        List<Register[]> pairs = new ArrayList<>();
        if (instruction.getMnemonicString().equals("stp")) {
            Register first = instruction.getRegister(0);
            Register second = instruction.getRegister(1);
            if (first != null && second != null && first.getBitLength() == 64 && second.getBitLength() == 64) {
                pairs.add(new Register[] {first, second});
            }
            return pairs;
        }
        FlowType flow = instruction.getFlowType();
        boolean returns = false;
        for (PcodeOp operation : instruction.getPcode()) {
            if (operation.getOpcode() == PcodeOp.RETURN) returns = true;
        }
        // A jump is a proven tail call only when it has resolved targets and all leave the
        // body. For unresolved targetless jumps, candidate literals remain unknown omissions.
        Address[] targets = instruction.getFlows();
        boolean tailCall = flow.isJump() && !flow.isConditional() && targets.length > 0 &&
            Arrays.stream(targets).allMatch(target -> !function.getBody().contains(target));
        boolean unresolvedJump = flow.isJump() && !flow.isConditional() && targets.length == 0;
        if (!flow.isCall() && !returns && !tailCall && !unresolvedJump) return pairs;
        // A String occupies two consecutive registers among x0-x7, or x0 and x1 when returned.
        int lastFirstRegister = returns ? 0 : 6;
        for (int index = 0; index <= lastFirstRegister; index++) {
            pairs.add(new Register[] {registers[index], registers[index + 1]});
        }
        return pairs;
    }

    private static Long registerConstant(VarnodeContext context, Register register) {
        Varnode value = context.getRegisterVarnodeValue(register);
        return value != null && context.isConstant(value) ? value.getOffset() : null;
    }

    // Search every predecessor path for the reaching definitions, following register copies,
    // since a select copied into an argument register or defined before a branch forks just as
    // independently as one written there directly.
    private boolean selectedValue(Function function, Instruction use, Register register) {
        ArrayDeque<Instruction> instructions = new ArrayDeque<>();
        ArrayDeque<Register> targets = new ArrayDeque<>();
        Set<String> visited = new HashSet<>();
        for (Instruction predecessor : predecessors(function, use)) {
            instructions.push(predecessor);
            targets.push(register.getBaseRegister());
        }
        while (!instructions.isEmpty()) {
            Instruction instruction = instructions.pop();
            Register target = targets.pop();
            if (!visited.add(canonicalAddress(instruction.getAddress()) + "\u0000" + target.getName())) continue;
            boolean defines = false;
            for (Object result : instruction.getResultObjects()) {
                if (result instanceof Register written && written.getBaseRegister().equals(target)) defines = true;
            }
            Register next = target;
            if (defines) {
                PcodeOp[] operations = instruction.getPcode();
                for (PcodeOp operation : operations) {
                    if (operation.getOpcode() == PcodeOp.CBRANCH && operation.getInput(0).isConstant()) return true;
                }
                Register source = copiedRegister(operations);
                if (source == null) continue;
                next = source.getBaseRegister();
            }
            for (Instruction predecessor : predecessors(function, instruction)) {
                instructions.push(predecessor);
                targets.push(next);
            }
        }
        return false;
    }

    private List<Instruction> predecessors(Function function, Instruction instruction) {
        List<Instruction> result = new ArrayList<>();
        Address from = instruction.getFallFrom();
        if (from != null) {
            Instruction previous = currentProgram.getListing().getInstructionAt(from);
            if (previous != null) result.add(previous);
        }
        for (Reference reference : currentProgram.getReferenceManager().getReferencesTo(instruction.getAddress())) {
            if (!reference.getReferenceType().isFlow() || reference.getReferenceType().isCall()) continue;
            if (!function.getBody().contains(reference.getFromAddress())) continue;
            Instruction source = currentProgram.getListing().getInstructionAt(reference.getFromAddress());
            if (source != null) result.add(source);
        }
        return result;
    }

    private Register copiedRegister(PcodeOp[] operations) {
        if (operations.length != 1) return null;
        int opcode = operations[0].getOpcode();
        Varnode input = operations[0].getInput(0);
        if ((opcode != PcodeOp.COPY && opcode != PcodeOp.INT_ZEXT) || input == null || !input.isRegister()) return null;
        return currentProgram.getRegister(input);
    }

    /** Validate the ABI layout of a pair; a small literal is decoded here, a large one only located. */
    private SwiftLiteralLayout swiftLiteralLayout(long word, long object) {
        int discriminator = (int) (object >>> 60);
        if (discriminator == 0xE || discriminator == 0xA) {
            int count = (int) ((object >>> 56) & 0xF);
            byte[] bytes = new byte[15];
            for (int index = 0; index < 8; index++) bytes[index] = (byte) (word >>> (8 * index));
            for (int index = 0; index < 7; index++) bytes[8 + index] = (byte) (object >>> (8 * index));
            for (int index = count; index < bytes.length; index++) {
                if (bytes[index] != 0) return null;
            }
            // Count zero is the canonical empty string (object 0xE000000000000000, word 0).
            String value = swiftStringText(bytes, count, discriminator == 0xE);
            return value == null ? null : new SwiftLiteralLayout("small", null, count, true, value);
        }
        int flags = (int) (word >>> 60);
        long count = word & 0xFFFFFFFFFFFFL;
        // Immortal literals: ASCII and NFC or neither, tail allocated, with a pointer biased by 32.
        if ((object >>> 56) != 0x80 || (flags != 0xD && flags != 0x1) || ((word >>> 48) & 0xFFF) != 0) {
            return null;
        }
        try {
            Address address = currentProgram.getAddressFactory().getDefaultAddressSpace()
                .getAddress((object & 0x00FFFFFFFFFFFFFFL) + 0x20);
            MemoryBlock block = currentProgram.getMemory().getBlock(address);
            // The bytes and their terminator must lie in one initialized, non-executable block,
            // and Java arrays bound one read.
            if (block == null || !block.isInitialized() || block.isExecute() ||
                count >= block.getEnd().subtract(address) + 1 || count >= Integer.MAX_VALUE) {
                return null;
            }
            return new SwiftLiteralLayout("large", address, count, flags == 0xD, null);
        } catch (Exception unaddressable) {
            return null;
        }
    }

    private String swiftLargeLiteralText(SwiftLiteralLayout layout) {
        int count = (int) layout.byteLength();
        byte[] bytes = new byte[count + 1];
        try {
            if (currentProgram.getMemory().getBytes(layout.address(), bytes) != bytes.length) return null;
        } catch (Exception unreadable) {
            return null;
        }
        return bytes[count] == 0 ? swiftStringText(bytes, count, layout.ascii()) : null;
    }

    /**
     * Every literal record of one dossier draws on half of the heap that was free when decoding
     * began. Text is charged at the worst case per UTF-8 byte: two bytes of UTF-16 text, then up
     * to six escaped JSON characters ("\\u0000") held as UTF-16 in Gson's growing writer buffer
     * (up to twice its length), again in the returned String, and once more as UTF-8 on the
     * socket. Each record also pays a fixed cost for its map key, JSON members, addresses, words
     * and their serialized form, so many empty or small literals are bounded too. Retained
     * provenance-cache entries draw on that same fixed-state allowance.
     */
    private static final class SwiftLiteralBudget {
        private static final long BYTES_PER_LITERAL_BYTE = 2 + 6 * 2 * 2 + 6 * 2 + 6;
        private static final long BYTES_PER_RECORD = 4096;
        private long remaining;
        private boolean stopped;

        SwiftLiteralBudget() {
            Runtime runtime = Runtime.getRuntime();
            remaining = Math.max(0, (runtime.maxMemory() - runtime.totalMemory() + runtime.freeMemory()) / 2);
        }

        SwiftLiteralBudget(long remaining) {
            if (remaining < 0) throw new IllegalArgumentException("Swift literal budget must be nonnegative");
            this.remaining = remaining;
        }

        boolean takeState() {
            if (remaining < BYTES_PER_RECORD) return false;
            remaining -= BYTES_PER_RECORD;
            return true;
        }

        boolean take(long bytes) {
            if (remaining < BYTES_PER_RECORD ||
                bytes > (remaining - BYTES_PER_RECORD) / BYTES_PER_LITERAL_BYTE) {
                return false;
            }
            remaining -= BYTES_PER_RECORD + bytes * BYTES_PER_LITERAL_BYTE;
            return true;
        }

        void stop() {
            stopped = true;
        }

        boolean stopped() {
            return stopped;
        }
    }

    // Swift String values may contain any scalar, including controls; JSON escapes them.
    private static String swiftStringText(byte[] bytes, int length, boolean ascii) {
        if (length < 0 || length > bytes.length) return null;
        for (int index = 0; index < length; index++) {
            if (ascii && bytes[index] < 0) return null;
        }
        try {
            return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes, 0, length)).toString();
        } catch (CharacterCodingException invalid) {
            return null;
        }
    }

    private static JsonObject swiftStringOmission(SwiftLiteralLayout layout, long word, long object) {
        return swiftStringOmission(layout, word, object, "capacity");
    }

    private static JsonObject swiftStringOmission(
        SwiftLiteralLayout layout,
        long word,
        long object,
        String reason
    ) {
        JsonObject item = new JsonObject();
        item.addProperty("representation", layout.representation());
        if (layout.address() == null) {
            item.add("address", JsonNull.INSTANCE);
        } else {
            item.addProperty("address", canonicalAddress(layout.address()));
        }
        item.addProperty("byte_length", layout.byteLength());
        item.addProperty("reason", reason);
        item.add("words", swiftStringWords(word, object));
        return item;
    }

    private static JsonObject swiftStringItem(
        String value,
        SwiftLiteralLayout layout,
        long word,
        long object
    ) {
        JsonObject item = new JsonObject();
        item.addProperty("value", value);
        item.addProperty("representation", layout.representation());
        if (layout.address() == null) {
            item.add("address", JsonNull.INSTANCE);
        } else {
            item.addProperty("address", canonicalAddress(layout.address()));
        }
        item.add("words", swiftStringWords(word, object));
        return item;
    }

    private static JsonArray swiftStringWords(long word, long object) {
        JsonArray words = new JsonArray();
        words.add("0x" + Long.toUnsignedString(word, 16));
        words.add("0x" + Long.toUnsignedString(object, 16));
        return words;
    }

    private static String exclusiveAddress(Address inclusive) {
        Address next = inclusive.next();
        if (next != null && next.getAddressSpace().equals(inclusive.getAddressSpace())) {
            return canonicalAddress(next);
        }
        BigInteger offset = new BigInteger(Long.toUnsignedString(inclusive.getOffset()));
        return canonicalOffset(inclusive.getAddressSpace(), offset.add(BigInteger.ONE));
    }

    private static String diagnosticMessage(String value) {
        if (value == null || value.isBlank()) {
            return "native decompiler returned no detail";
        }
        return value.replaceAll("[\\r\\n]+", " ");
    }

    private JsonArray inventory(
        List<InventoryItem> inventory,
        String factsName) throws Exception {
        JsonArray result = new JsonArray();
        for (InventoryItem item : inventory) {
            monitor.checkCancelled();
            result.add(resultItem(item, factsName));
        }
        return result;
    }

    private static JsonObject resultItem(InventoryItem item, String factsName) {
        JsonObject result = new JsonObject();
        result.addProperty("address", canonicalAddress(item.address));
        result.addProperty("value", item.value);
        if (factsName != null) {
            result.add(factsName, item.facts.deepCopy());
        }
        if (item.symbol != null) {
            result.add("symbol", item.symbol.deepCopy());
        }
        return result;
    }

    private static JsonObject memoryRegion(MemoryBlock block, String imageBase) {
        JsonObject permissions = new JsonObject();
        permissions.addProperty("available", true);
        permissions.addProperty("source", "ghidra-memory-block");
        JsonObject result = new JsonObject();
        result.addProperty("name", block.getName());
        result.addProperty("start", canonicalAddress(block.getStart()));
        result.addProperty("end", exclusiveEnd(block));
        result.addProperty("readable", block.isRead());
        result.addProperty("writable", block.isWrite());
        result.addProperty("executable", block.isExecute());
        result.add("permissions", permissions);
        result.addProperty("provenance", "ghidra-memory-block");
        result.addProperty("address_space", block.getStart().getAddressSpace().getName());
        result.addProperty("image_base", imageBase);
        result.addProperty("initialized", block.isInitialized());
        result.addProperty("overlay", block.isOverlay());
        return result;
    }

    private static JsonObject procedureIdentity(Function function) {
        JsonObject result = new JsonObject();
        result.addProperty("address", canonicalAddress(function.getEntryPoint()));
        result.addProperty("name", procedureName(function));
        Symbol symbol = function.getSymbol();
        result.add("symbol", symbol == null ? JsonNull.INSTANCE : symbolMetadata(symbol));
        result.add("classification", functionClassification(function));
        result.add("body", functionBody(function));
        return result;
    }

    /** Observe the entire AddressSet; range endpoints are inclusive, not a guessed span. */
    private static JsonObject functionBody(Function function) {
        JsonArray ranges = new JsonArray();
        BigInteger total = BigInteger.ZERO;
        Address first = null;
        Address last = null;
        AddressSpace space = null;
        boolean multipleSpaces = false;
        AddressRangeIterator iterator = function.getBody().getAddressRanges(true);
        while (iterator.hasNext()) {
            AddressRange range = iterator.next();
            Address start = range.getMinAddress();
            Address end = range.getMaxAddress();
            if (start.getAddressSpace().getAddressableUnitSize() != 1) {
                throw new IllegalStateException("Function body byte coverage requires a byte-addressed space");
            }
            JsonObject value = new JsonObject();
            value.addProperty("start", canonicalAddress(start));
            value.addProperty("end", canonicalAddress(end));
            ranges.add(value);
            BigInteger begin = new BigInteger(Long.toUnsignedString(start.getOffset()));
            BigInteger finish = new BigInteger(Long.toUnsignedString(end.getOffset()));
            total = total.add(finish.subtract(begin).add(BigInteger.ONE));
            if (first == null) {
                first = start;
                space = start.getAddressSpace();
            } else if (!space.equals(start.getAddressSpace())) {
                multipleSpaces = true;
            }
            last = end;
        }
        JsonObject result = new JsonObject();
        result.addProperty("available", true);
        result.addProperty("provenance", "ghidra-function-body-address-set");
        result.add("ranges", ranges);
        result.addProperty("total_bytes", safeBodyByteCount(total));
        if (multipleSpaces) {
            result.add("span_bytes", JsonNull.INSTANCE);
        } else {
            BigInteger span = first == null ? BigInteger.ZERO :
                new BigInteger(Long.toUnsignedString(last.getOffset()))
                    .subtract(new BigInteger(Long.toUnsignedString(first.getOffset())))
                    .add(BigInteger.ONE);
            result.addProperty("span_bytes", safeBodyByteCount(span));
        }
        result.addProperty("non_contiguous", ranges.size() > 1);
        result.addProperty("contains_entry", function.getBody().contains(function.getEntryPoint()));
        return result;
    }

    private static long safeBodyByteCount(BigInteger value) {
        if (value.signum() < 0 || value.compareTo(BigInteger.valueOf(9007199254740991L)) > 0) {
            throw new IllegalStateException("Function body byte coverage exceeds exact JSON integer range");
        }
        return value.longValueExact();
    }

    private static String exclusiveEnd(MemoryBlock block) {
        Address next = block.getEnd().next();
        if (next != null && next.getAddressSpace().equals(block.getStart().getAddressSpace())) {
            return canonicalAddress(next);
        }
        BigInteger start = new BigInteger(Long.toUnsignedString(block.getStart().getOffset()));
        return canonicalOffset(
            block.getStart().getAddressSpace(),
            start.add(BigInteger.valueOf(block.getSize()))
        );
    }

    private static String canonicalAddress(Address address) {
        return canonicalOffset(
            address.getAddressSpace(),
            new BigInteger(Long.toUnsignedString(address.getOffset()))
        );
    }

    private static String canonicalOffset(AddressSpace space, BigInteger offset) {
        String value = "0x" + offset.toString(16);
        if (space.equals(sessionDefaultAddressSpace)) {
            return value;
        }
        return encodeAddressSpace(space.getName()) + ":" + value;
    }

    private Address requireAddress(JsonObject params, String name) {
        return parseReaAddress(requireString(params, name));
    }

    private static boolean isExplicitReaAddress(String value) {
        if (value.regionMatches(true, 0, "0x", 0, 2) &&
            isHexadecimal(value, 2, value.length()))
            return true;
        int separator = value.toLowerCase(Locale.ROOT).lastIndexOf(":0x");
        if (separator <= 0 || !isHexadecimal(value, separator + 3, value.length()))
            return false;
        // Classify the encoded space iteratively. A repeated regex alternation
        // can exhaust Java's stack on a long ordinary symbol name.
        for (int index = 0; index < separator; index++) {
            char item = value.charAt(index);
            if ((item >= 'A' && item <= 'Z') ||
                (item >= 'a' && item <= 'z') ||
                (item >= '0' && item <= '9') ||
                item == '.' || item == '_' || item == '~' || item == '-')
                continue;
            if (item != '%' || index + 2 >= separator ||
                !isHexadecimal(value, index + 1, index + 3))
                return false;
            index += 2;
        }
        return true;
    }

    private static boolean isHexadecimal(String value, int start, int end) {
        if (start >= end) return false;
        for (int index = start; index < end; index++) {
            char item = value.charAt(index);
            if (!((item >= '0' && item <= '9') ||
                  (item >= 'a' && item <= 'f') ||
                  (item >= 'A' && item <= 'F')))
                return false;
        }
        return true;
    }

    private Address parseReaAddress(String value) {
        Address address = tryParseAddress(value);
        if (address == null) {
            throw new RequestFailure("invalid_request", "Unknown or invalid Ghidra address: " + value);
        }
        return address;
    }

    private Address tryParseAddress(String value) {
        try {
            String spaceName = null;
            String offset = value;
            int separator = value.toLowerCase(Locale.ROOT).lastIndexOf(":0x");
            if (separator >= 0) {
                spaceName = decodeAddressSpace(value.substring(0, separator));
                offset = value.substring(separator + 3);
            }
            else if (value.startsWith("0x") || value.startsWith("0X")) {
                offset = value.substring(2);
            }
            if (!isHexadecimal(offset, 0, offset.length())) {
                return null;
            }
            AddressSpace space = spaceName == null
                ? currentProgram.getAddressFactory().getDefaultAddressSpace()
                : currentProgram.getAddressFactory().getAddressSpace(spaceName);
            if (space == null) return null;
            Address address = space.getAddress(offset);
            BigInteger requestedOffset = new BigInteger(offset, 16);
            BigInteger parsedOffset = new BigInteger(Long.toUnsignedString(address.getOffset()));
            if (!requestedOffset.equals(parsedOffset))
                throw new RequestFailure("invalid_request",
                    "Ghidra address offset cannot be represented without truncation in space " +
                    space.getName() + ": requested " + value + ", parsed " + canonicalAddress(address));
            return address;
        }
        catch (RequestFailure failure) { throw failure; }
        catch (Exception exception) {
            return null;
        }
    }

    private static String encodeAddressSpace(String value) {
        StringBuilder result = new StringBuilder();
        for (byte item : value.getBytes(StandardCharsets.UTF_8)) {
            int unsigned = Byte.toUnsignedInt(item);
            if ((unsigned >= 'A' && unsigned <= 'Z') ||
                (unsigned >= 'a' && unsigned <= 'z') ||
                (unsigned >= '0' && unsigned <= '9') ||
                unsigned == '.' || unsigned == '_' || unsigned == '~' || unsigned == '-') {
                result.append((char) unsigned);
            }
            else {
                result.append('%');
                result.append(Character.toUpperCase(Character.forDigit(unsigned >>> 4, 16)));
                result.append(Character.toUpperCase(Character.forDigit(unsigned & 0xf, 16)));
            }
        }
        return result.toString();
    }

    private static String decodeAddressSpace(String value) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int index = 0; index < value.length();) {
            char item = value.charAt(index);
            if (item == '%') {
                if (index + 2 >= value.length()) {
                    throw new RequestFailure("invalid_request", "Address space encoding is invalid");
                }
                int high = Character.digit(value.charAt(index + 1), 16);
                int low = Character.digit(value.charAt(index + 2), 16);
                if (high < 0 || low < 0) {
                    throw new RequestFailure("invalid_request", "Address space encoding is invalid");
                }
                bytes.write((high << 4) | low);
                index += 3;
            }
            else if ((item >= 'A' && item <= 'Z') ||
                     (item >= 'a' && item <= 'z') ||
                     (item >= '0' && item <= '9') ||
                     item == '.' || item == '_' || item == '~' || item == '-') {
                bytes.write((byte) item);
                index += 1;
            }
            else {
                throw new RequestFailure("invalid_request", "Address space encoding is invalid");
            }
        }
        return bytes.toString(StandardCharsets.UTF_8);
    }

    private static String normalizedSymbolType(Symbol symbol) {
        String value = symbol.getSymbolType().toString()
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", "_")
            .replaceAll("^_+|_+$", "");
        return value.isEmpty() ? "unknown" : value;
    }

    private static JsonObject symbolMetadata(Symbol symbol) {
        JsonObject facts = new JsonObject();
        facts.addProperty("primary", symbol.isPrimary());
        facts.addProperty("dynamic", symbol.isDynamic());
        facts.addProperty("external", symbol.isExternal());
        facts.addProperty("type", normalizedSymbolType(symbol));
        facts.addProperty("source", normalizedSource(symbol.getSource()));
        return facts;
    }

    private static String normalizedSource(SourceType source) {
        return source.name().toLowerCase(Locale.ROOT);
    }

    private static ValueMatcher literalMatcher(String pattern) {
        return value -> value.contains(pattern);
    }

    // REA's host owns Unicode simple folding. Keep all non-ASCII source values
    // for its final predicate, and filter ASCII-only values without Java regexes.
    private static ValueMatcher literalCandidateMatcher(String asciiPattern) {
        if (asciiPattern != null && asciiPattern.chars().anyMatch(character -> character > 127))
            throw new RequestFailure("invalid_request", "ASCII candidate contains a non-ASCII character");
        return value -> {
            if (value.chars().anyMatch(character -> character > 127)) return true;
            return asciiPattern != null && value.toLowerCase(Locale.ROOT).contains(asciiPattern);
        };
    }

    private static ValueMatcher regexMatcher(String expression, boolean caseSensitive) {
        Pattern pattern;
        try {
            pattern = Pattern.compile(
                expression,
                caseSensitive ? 0 : Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
            );
        }
        catch (PatternSyntaxException exception) {
            // Java wraps compiler stack exhaustion in PatternSyntaxException
            // without retaining its cause. This producer reason is not bad syntax.
            if (exception.getDescription().equals("Stack overflow during pattern compilation"))
                throw regexStackExhausted(expression, "compiling");
            throw new RequestFailure("invalid_request", "Invalid regex pattern " + expression + ": " + exception.getDescription() + " at index " + exception.getIndex());
        }
        catch (StackOverflowError exhausted) {
            throw regexStackExhausted(expression, "compiling");
        }
        return value -> {
            try {
                return pattern.matcher(value).find();
            }
            catch (StackOverflowError exhausted) {
                throw regexStackExhausted(expression, "matching");
            }
        };
    }

    // The host queue owns session lifetime, including concurrent cancellation.
    private static RequestFailure regexStackExhausted(String expression, String stage) {
        return new RequestFailure("regex_stack_exhausted",
            "Ghidra's Java regex engine exhausted its stack while " + stage +
            " pattern " + expression + ".");
    }

    private static SessionDescriptor readDescriptor(Path path) throws IOException {
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("REA session descriptor is invalid");
        }
        JsonElement parsed = JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8));
        Set<String> keys = new HashSet<>(DESCRIPTOR_KEYS);
        if (parsed.isJsonObject() && parsed.getAsJsonObject().has("analysis_extensions"))
            keys.add("analysis_extensions");
        if (parsed.isJsonObject() && parsed.getAsJsonObject().has("decompile_timeout_seconds"))
            keys.add("decompile_timeout_seconds");
        if (parsed.isJsonObject() && parsed.getAsJsonObject().has("existing_project"))
            keys.add("existing_project");
        JsonObject object = requireObject(parsed, keys);
        int decompileTimeout = 0;
        if (object.has("decompile_timeout_seconds")) {
            decompileTimeout = requireInteger(object, "decompile_timeout_seconds");
            if (decompileTimeout < 1 || decompileTimeout > MAX_DECOMPILE_TIMEOUT_SECONDS)
                throw new IllegalArgumentException("REA session descriptor is invalid");
        }
        return new SessionDescriptor(
            requireString(object, "transport"),
            requireString(object, "endpoint_path"),
            requireString(object, "token"),
            requireString(object, "run_id"),
            requireSha256(object, "target_sha256"),
            requireString(object, "provider_version"),
            requireString(object, "profile_digest"),
            object.has("analysis_extensions") ? object.getAsJsonArray("analysis_extensions") : new JsonArray(),
            decompileTimeout,
            object.has("existing_project") && requireBoolean(object, "existing_project")
        );
    }

    private static Request parseRequest(String line, String expectedToken) {
        JsonElement parsed = JsonParser.parseString(line);
        Set<String> keys = new HashSet<>(REQUEST_KEYS);
        if (parsed.isJsonObject() && parsed.getAsJsonObject().has("decompile_timeout_seconds"))
            keys.add("decompile_timeout_seconds");
        JsonObject object = requireObject(parsed, keys);
        Integer timeout = null;
        if (object.has("decompile_timeout_seconds")) {
            JsonElement value = object.get("decompile_timeout_seconds");
            timeout = value.isJsonNull() ? 0 : requireInteger(object, "decompile_timeout_seconds");
            if (!value.isJsonNull() && (timeout < 1 || timeout > MAX_DECOMPILE_TIMEOUT_SECONDS))
                throw new IllegalArgumentException("Invalid per-request decompile deadline");
        }
        int id = requireInteger(object, "id");
        if (id <= 0 || !constantTimeEquals(requireString(object, "token"), expectedToken)) {
            throw new IllegalArgumentException("Bridge request authentication failed");
        }
        JsonElement params = object.get("params");
        if (params == null || !params.isJsonObject()) {
            throw new IllegalArgumentException("Bridge request parameters are invalid");
        }
        return new Request(id, requireString(object, "method"), params.getAsJsonObject(), timeout);
    }

    private static JsonObject requireObject(JsonElement element, Set<String> keys) {
        if (!element.isJsonObject()) {
            throw new IllegalArgumentException("JSON object required");
        }
        JsonObject object = element.getAsJsonObject();
        if (!object.keySet().equals(keys)) {
            throw new IllegalArgumentException("JSON object fields are invalid");
        }
        return object;
    }

    private static void requireKeys(JsonObject object, Set<String> keys) {
        if (!object.keySet().equals(keys)) {
            throw new RequestFailure("invalid_request", "Bridge request fields are invalid");
        }
    }

    private void requireDocument(JsonObject params) {
        String document = optionalString(params, "document");
        if (document != null && !document.equals(currentProgram.getName())) {
            throw new RequestFailure("not_found", "Unknown Ghidra Program identity: " + document + "; active program: " + currentProgram.getName());
        }
    }

    private static String optionalString(JsonObject object, String name) {
        JsonElement value = object.get(name);
        if (value == null || value.isJsonNull()) {
            return null;
        }
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new RequestFailure("invalid_request", name + " must be a string or null");
        }
        String result = value.getAsString();
        if (result.isEmpty()) {
            throw new RequestFailure("invalid_request", name + " cannot be empty");
        }
        return result;
    }

    private static String requireString(JsonObject object, String name) {
        JsonElement value = object.get(name);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            throw new RequestFailure("invalid_request", name + " must be a string");
        }
        String result = value.getAsString();
        if (result.isEmpty()) {
            throw new RequestFailure("invalid_request", name + " cannot be empty");
        }
        return result;
    }

    private static String requireSha256(JsonObject object, String name) {
        String value = requireString(object, name);
        if (!value.matches("[a-f0-9]{64}")) {
            throw new IllegalArgumentException(name + " must be lowercase SHA-256");
        }
        return value;
    }

    private static int requireInteger(JsonObject object, String name) {
        JsonElement value = object.get(name);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException("JSON integer required");
        }
        int result = value.getAsInt();
        if (value.getAsDouble() != result) {
            throw new IllegalArgumentException("JSON integer required");
        }
        return result;
    }

    private static int requireBoundedInteger(
            JsonObject object,
            String name,
            int minimum,
            int maximum) {
        try {
            int value = requireInteger(object, name);
            if (value < minimum || value > maximum) {
                throw new RequestFailure(
                    "invalid_request",
                    name + " is outside its supported range"
                );
            }
            return value;
        }
        catch (IllegalArgumentException exception) {
            throw new RequestFailure("invalid_request", name + " must be an integer");
        }
    }

    private static boolean requireBoolean(JsonObject object, String name) {
        JsonElement value = object.get(name);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) {
            throw new RequestFailure("invalid_request", name + " must be a boolean");
        }
        return value.getAsBoolean();
    }

    private static boolean constantTimeEquals(String provided, String expected) {
        return MessageDigest.isEqual(
            provided.getBytes(StandardCharsets.UTF_8),
            expected.getBytes(StandardCharsets.UTF_8)
        );
    }

    private static void writeSuccess(BufferedWriter writer, int id, JsonElement result)
            throws IOException {
        JsonObject response = new JsonObject();
        response.addProperty("id", id);
        response.addProperty("ok", true);
        response.add("result", result);
        writeResponse(writer, response);
    }

    private static void writeFailure(
            BufferedWriter writer,
            int id,
            String code,
            String message) throws IOException {
        JsonObject error = new JsonObject();
        error.addProperty("code", code);
        error.addProperty("message", message);
        JsonObject response = new JsonObject();
        response.addProperty("id", id);
        response.addProperty("ok", false);
        response.add("error", error);
        writeResponse(writer, response);
    }

    private static void writeResponse(BufferedWriter writer, JsonObject response) throws IOException {
        String encoded = GSON.toJson(response);
        // Gson leaves UTF-16 surrogates literal. Escape them in JSON so even
        // diagnostics quoting ill-formed caller text remain lossless UTF-8.
        int start = 0;
        for (int index = 0; index < encoded.length(); index++) {
            if (!Character.isSurrogate(encoded.charAt(index))) continue;
            writer.write(encoded, start, index - start);
            writer.write("\\u" + Integer.toHexString(encoded.charAt(index)));
            start = index + 1;
        }
        writer.write(encoded, start, encoded.length() - start);
        writer.newLine();
        writer.flush();
    }

    private static String safeMessage(Exception exception) {
        String message = exception.getMessage();
        return message == null || message.isBlank() ? "operation failed" : message;
    }

    private interface ValueMatcher {
        boolean matches(String value);
    }

    private static final Comparator<InventoryItem> INVENTORY_ORDER =
        Comparator.comparing(InventoryItem::address)
            .thenComparing(InventoryItem::value)
            .thenComparing(item -> GSON.toJson(item.facts));
    private static final Comparator<Reference> REFERENCE_ORDER =
        Comparator.comparing(Reference::getFromAddress)
            .thenComparing(Reference::getToAddress)
            .thenComparing(reference -> reference.getReferenceType().getName())
            .thenComparingInt(Reference::getOperandIndex)
            .thenComparing(Reference::isPrimary);

    private record InventoryItem(Address address, String value, JsonObject facts, JsonObject symbol) {}
    private record AddressNameRequest(String inputAddress, Address address, String name) {}
    private record AddressNameDestination(long namespace, String leaf) {}
    private record AddressNameTarget(Address address, Namespace namespace, String leaf) {
        AddressNameDestination destination() {
            return new AddressNameDestination(namespace.getID(), leaf);
        }
    }
    private record AddressNameConflict(Namespace namespace, String leaf, List<Address> requesters, List<Address> holders) {}
    private record AddressNameFailure(String reason, AddressNameConflict conflict) {}
    private record FunctionEntry(Function function, InventoryItem item) {}
    private record FunctionAnalysisObservation(JsonObject dossier, List<String> limitations, JsonObject relationshipCoverage, boolean decompilerFailed) {}
    private record CallBoundaryObservation(List<String> limitations, Integer unrepresentedCalleeCalls, JsonArray unresolvedCalls) {}
    private record SwiftStringLiteralDecode(JsonArray literals, JsonArray omissions) {}
    private record SwiftLiteralLayout(
        String representation,
        Address address,
        long byteLength,
        boolean ascii,
        String smallValue
    ) {}
    private record InstructionScan(List<Instruction> instructions, boolean truncated) {}
    private record SessionDescriptor(
        String transport,
        String endpointPath,
        String token,
        String runId,
        String targetSha256,
        String providerVersion,
        String profileDigest,
        JsonArray analysisExtensions,
        int decompileTimeoutSeconds,
        boolean existingProject
    ) {}
    private record Request(int id, String method, JsonObject params, Integer decompileTimeoutSeconds) {}

    private static final class RequestFailure extends RuntimeException {
        private final String code;

        RequestFailure(String code, String message) {
            super(message);
            this.code = code;
        }
    }

}
