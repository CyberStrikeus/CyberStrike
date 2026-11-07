//@category REA Verification

import java.io.ByteArrayInputStream;
import java.io.PrintWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Locale;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import ghidra.app.script.GhidraScriptUtil;
import ghidra.app.util.headless.HeadlessScript;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.decompiler.DecompileProcess.DisposeState;
import ghidra.util.task.TaskMonitor;

/** Real source-identity cases unavailable through ordinary single-file CLI imports. */
public final class ReaFileOffsetSourceProbe extends HeadlessScript {
    @Override
    public void run() throws Exception {
        var file = GhidraScriptUtil.findScriptByName("ReaGhidraBridge.java");
        var bridge = GhidraScriptUtil.getProvider(file).getScriptInstance(file, new PrintWriter(System.out, true));
        bridge.set(state, monitor, new PrintWriter(System.out, true));
        var space = bridge.getClass().getDeclaredField("sessionDefaultAddressSpace");
        space.setAccessible(true);
        space.set(null, currentProgram.getAddressFactory().getDefaultAddressSpace());
        var identity = bridge.getClass().getDeclaredField("admittedTargetSha256");
        identity.setAccessible(true);
        identity.set(bridge, currentProgram.getExecutableSHA256().toLowerCase(Locale.ROOT));
        var resolve = bridge.getClass().getDeclaredMethod("resolveDecompileProcedure", String.class, JsonObject.class);
        resolve.setAccessible(true);
        var reverse = bridge.getClass().getDeclaredMethod("addressToFileOffset", JsonObject.class);
        reverse.setAccessible(true);

        var memory = currentProgram.getMemory();
        var original = memory.getAllFileBytes().get(0);
        byte[] bytes = new byte[Math.toIntExact(original.getSize())];
        require(original.getOriginalBytes(0, bytes) == bytes.length, "complete fixture source");
        byte[] auxiliary = new byte[0x1000];
        auxiliary[0x910] = (byte)0xc3;
        var foreign = memory.createFileBytes("auxiliary.bin", 0, auxiliary.length,
            new ByteArrayInputStream(auxiliary), monitor);
        var address = toAddr(0x140100000L);
        memory.createInitializedBlock("auxiliary", address, foreign, 0, auxiliary.length, false);
        var entry = address.add(0x910);
        currentProgram.getFunctionManager().createFunction("foreign_only", entry,
            new AddressSet(entry), SourceType.USER_DEFINED);
        rejected(resolve, bridge, "no loaded source mapping", "file-offset:0x910", new JsonObject());
        rejectedCode(reverse, bridge, "file_mapping_absent",
            "has no authoritative mapping to the admitted target file", reverseInput("0x140100910"));

        // Well-formed addresses without source bytes keep distinct outcomes.
        memory.createUninitializedBlock("rea_uninitialized", toAddr(0x140400000L), 0x100, false);
        rejectedCode(reverse, bridge, "address_uninitialized",
            "is in uninitialized Ghidra memory block rea_uninitialized", reverseInput("0x140400010"));
        rejectedCode(reverse, bridge, "address_unmapped",
            "is outside every Ghidra memory block", reverseInput("0x140500000"));

        // A source object's declared original-file start does not make its local
        // offsets a complete, digest-matched target representation.
        var partial = memory.createFileBytes("partial.bin", 0x200, 0x200,
            new ByteArrayInputStream(bytes, 0x200, 0x200), monitor);
        memory.createInitializedBlock("partial", toAddr(0x140300000L), partial, 0, 0x200, false);
        rejectedCode(reverse, bridge, "file_mapping_absent",
            "has no authoritative mapping to the admitted target file", reverseInput("0x140300010"));
        var selected = (Function)resolve.invoke(bridge, "file-offset:0x210", new JsonObject());
        require(selected.getEntryPoint().equals(toAddr(0x140001010L)), "original target selected despite other sources");
        var mapped = (JsonObject)reverse.invoke(bridge, reverseInput("0x140001010"));
        require(mapped.get("file_offset").getAsLong() == 0x210, "original target round trip");

        // Inject backend failures after real source/function resolution. This
        // verifies context propagation, not a naturally failing decompiler.
        var pseudocode = bridge.getClass().getDeclaredMethod("procedurePseudocode", JsonObject.class);
        pseudocode.setAccessible(true);
        var decompiler = bridge.getClass().getDeclaredField("decompiler");
        decompiler.setAccessible(true);
        JsonObject request = new JsonObject();
        request.add("document", JsonNull.INSTANCE);
        request.addProperty("procedure", "file-offset:0x210");
        for (DisposeState disposition : new DisposeState[] { DisposeState.NOT_DISPOSED, DisposeState.DISPOSED_ON_CANCEL }) {
            decompiler.set(bridge, new DecompInterface() {
                @Override
                public DecompileResults decompileFunction(Function function, int timeout, TaskMonitor taskMonitor) {
                    return new DecompileResults(function, currentProgram.getLanguage(),
                        currentProgram.getCompilerSpec(), null, "Injected backend failure", null, disposition);
                }
            });
            Throwable failure = rejected(pseudocode, bridge,
                "Selector file-offset:0x210 mapped to analysis address 0x140001010 and procedure 0x140001010", request);
            var code = failure.getClass().getDeclaredField("code");
            code.setAccessible(true);
            require(code.get(failure).equals(disposition == DisposeState.DISPOSED_ON_CANCEL
                ? "decompile_cancelled" : "decompile_failed"), "backend failure code retained");
        }

        var duplicate = memory.createFileBytes("duplicate.bin", 0, bytes.length,
            new ByteArrayInputStream(bytes), monitor);
        memory.createInitializedBlock("duplicate", toAddr(0x140201000L), duplicate, 0x200, 0x200, false);
        rejected(resolve, bridge, "multiple loaded mappings", "file-offset:0x210", new JsonObject());
        println("REA_FILE_OFFSET_SOURCE_OK foreign/partial/uninitialized/unmapped rejected; original round trip; duplicate ambiguity; injected backend failure context retained");
    }

    private JsonObject reverseInput(String address) {
        JsonObject params = new JsonObject();
        params.add("document", JsonNull.INSTANCE);
        params.addProperty("address", address);
        return params;
    }

    private Throwable rejected(Method method, Object bridge, String reason, Object... arguments) throws Exception {
        try {
            method.invoke(bridge, arguments);
        } catch (InvocationTargetException rejected) {
            require(rejected.getCause().getMessage().contains(reason), "expected mapping failure: " + reason);
            return rejected.getCause();
        }
        throw new AssertionError("Expected mapping failure: " + reason);
    }

    private void rejectedCode(Method method, Object bridge, String code, String reason, Object... arguments) throws Exception {
        Throwable failure = rejected(method, bridge, reason, arguments);
        var field = failure.getClass().getDeclaredField("code");
        field.setAccessible(true);
        require(field.get(failure).equals(code), "expected mapping failure code: " + code);
    }

    private void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
