// Producer regressions run inside a real, ephemeral Ghidra analysis of the
// source-owned AArch64 fixture. No target code is executed and no decoded JSON
// fixture substitutes for the Java decoder under test.
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import ghidra.app.util.headless.HeadlessScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.lang.Register;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;

public class ReaSwiftDecoderRegressions extends HeadlessScript {
    private ReaGhidraBridge decoder;
    private Class<?> budgetClass;

    @Override
    public void run() throws Exception {
        decoder = new ReaGhidraBridge();
        setInherited(decoder, "currentProgram", currentProgram);
        setInherited(decoder, "monitor", monitor);
        setInherited(decoder, "sessionDefaultAddressSpace", currentProgram.getAddressFactory().getDefaultAddressSpace());
        budgetClass = Class.forName("ReaGhidraBridge$SwiftLiteralBudget", true, decoder.getClass().getClassLoader());
        Function copied = function("rea_swift_decoder_copied");
        JsonArray copiedValues = literals(decode(copied, 65536));
        require(copiedValues.size() > 0, "copied constant pair was not decoded");
        for (var element : copiedValues) {
            require(element.getAsJsonObject().get("value").getAsString().equals("ok"), "copied words invented text");
        }
        for (String name : new String[] {"select", "selected_copy", "padding", "utf8"}) {
            Object result = decode(function("rea_swift_decoder_" + name), 65536);
            require(literals(result).isEmpty(), name + " produced an invented Swift literal");
            require(omissions(result).isEmpty(), name + " was confused with capacity exhaustion");
        }
        for (String name : new String[] {"select", "selected_copy"}) {
            Function selected = function("rea_swift_decoder_" + name);
            require((Boolean) invoke("selectedValue", new Class<?>[] {Function.class, Instruction.class, Register.class}, selected, returnInstruction(selected), currentProgram.getRegister("x0")),
                name + " did not retain conditional-select provenance");
        }
        require(invoke("swiftLiteralLayout", new Class<?>[] {long.class, long.class}, 0x6261L, 0xe100000000000000L) == null,
            "nonzero small-string padding was accepted");
        require(invoke("swiftLiteralLayout", new Class<?>[] {long.class, long.class}, 0xc0L, 0xa100000000000000L) == null,
            "malformed small-string UTF-8 was accepted");
        rejectLarge("rea_swift_decoder_bad_terminator", 0xd000000000000003L);
        rejectLarge("rea_swift_decoder_bad_large_utf8", 0x1000000000000001L);
        // Zero covers provenance-state exhaustion; 8192 admits both register
        // cache entries and then rejects the retained literal/text charge.
        assertCapacityOmission(copied, 0);
        assertCapacityOmission(copied, 8192);
        require(getScriptArgs().length == 1, "Expected owned result path");
        Files.writeString(Path.of(getScriptArgs()[0]), "REA_SWIFT_DECODER_SAFEGUARDS_OK\n");
    }

    private void assertCapacityOmission(Function function, long remaining) throws Exception {
        Object exhausted = decode(function, remaining);
        require(literals(exhausted).isEmpty(), "capacity failure published decoded small text at budget " + remaining);
        JsonArray omitted = omissions(exhausted);
        require(omitted.size() == 1, "capacity failure did not stop subsequent use sites at budget " + remaining);
        JsonObject omission = omitted.get(0).getAsJsonObject();
        require(omission.get("reason").getAsString().equals("capacity"), "capacity omission lost its reason");
        require(!omission.has("value"), "omission claimed a retained literal value");
    }

    private Object decode(Function function, long remaining) throws Exception {
        Constructor<?> constructor = budgetClass.getDeclaredConstructor(long.class);
        constructor.setAccessible(true);
        return invoke("swiftStringLiterals", new Class<?>[] {Function.class, budgetClass}, function, constructor.newInstance(remaining));
    }

    private void rejectLarge(String name, long word) throws Exception {
        Address address = symbol(name).getAddress();
        long object = 0x8000000000000000L | ((address.getOffset() - 0x20) & 0x00ffffffffffffffL);
        Object layout = invoke("swiftLiteralLayout", new Class<?>[] {long.class, long.class}, word, object);
        require(layout != null, "large negative fixture did not reach the memory-text decoder");
        require(invoke("swiftLargeLiteralText", new Class<?>[] {layout.getClass()}, layout) == null,
            name + " was accepted as literal text");
    }

    private Instruction returnInstruction(Function function) {
        InstructionIterator instructions = currentProgram.getListing().getInstructions(function.getBody(), true);
        while (instructions.hasNext()) {
            Instruction instruction = instructions.next();
            if (instruction.getMnemonicString().equalsIgnoreCase("ret")) return instruction;
        }
        throw new AssertionError("Fixture has no return instruction");
    }

    private Function function(String name) {
        FunctionIterator functions = currentProgram.getFunctionManager().getFunctions(true);
        Function found = null;
        while (functions.hasNext()) {
            Function candidate = functions.next();
            if (!candidate.getName().equals(name) && !candidate.getName().equals("_" + name)) continue;
            require(found == null, "ambiguous fixture function " + name);
            found = candidate;
        }
        require(found != null, "missing fixture function " + name);
        return found;
    }

    private Symbol symbol(String name) {
        SymbolIterator symbols = currentProgram.getSymbolTable().getAllSymbols(true);
        Symbol found = null;
        while (symbols.hasNext()) {
            Symbol candidate = symbols.next();
            if (!candidate.getName().equals(name) && !candidate.getName().equals("_" + name)) continue;
            require(found == null, "ambiguous fixture symbol " + name);
            found = candidate;
        }
        require(found != null, "missing fixture symbol " + name);
        return found;
    }

    private Object invoke(String name, Class<?>[] types, Object... arguments) throws Exception {
        Method method = ReaGhidraBridge.class.getDeclaredMethod(name, types);
        method.setAccessible(true);
        return method.invoke(decoder, arguments);
    }

    private JsonArray literals(Object result) throws Exception { return array(result, "literals"); }
    private JsonArray omissions(Object result) throws Exception { return array(result, "omissions"); }
    private JsonArray array(Object result, String name) throws Exception {
        Method method = result.getClass().getDeclaredMethod(name);
        method.setAccessible(true);
        return (JsonArray) method.invoke(result);
    }

    private void setInherited(Object target, String name, Object value) throws Exception {
        for (Class<?> type = target.getClass(); type != null; type = type.getSuperclass()) {
            try {
                Field field = type.getDeclaredField(name);
                field.setAccessible(true);
                field.set(target, value);
                return;
            } catch (NoSuchFieldException nextOwner) { }
        }
        throw new AssertionError("Missing Ghidra state field " + name);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
