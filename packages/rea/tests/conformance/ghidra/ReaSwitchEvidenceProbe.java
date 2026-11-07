//@category REA Verification

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import generic.jar.ResourceFile;
import ghidra.app.decompiler.ClangCaseToken;
import ghidra.app.decompiler.ClangNode;
import ghidra.app.decompiler.ClangToken;
import ghidra.app.script.GhidraScript;
import ghidra.app.script.GhidraScriptProvider;
import ghidra.app.script.GhidraScriptUtil;
import ghidra.framework.Application;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.pcode.JumpTable;
import ghidra.program.model.pcode.PcodeBlock;
import ghidra.program.model.pcode.PcodeBlockBasic;
import ghidra.program.model.pcode.PcodeOp;
import ghidra.program.model.pcode.PcodeOpAST;
import java.io.File;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Executes the production bridge's typed switch evidence methods on detached Ghidra objects.
 * This is a pinned-model reflection fixture, not a natural compiler ambiguity reproduction.
 * It never executes the bridge run method or modifies the imported program/database.
 * Pass the exact bridge source path as the single script argument; source resolution fails closed.
 */
public class ReaSwitchEvidenceProbe extends GhidraScript {
    private GhidraScript bridge;
    private Method typedCases;
    private Method exactValue;
    private final JsonArray checks = new JsonArray();

    private static void setField(Class<?> owner, Object object, String name, Object value)
            throws Exception {
        Field field = owner.getDeclaredField(name);
        field.setAccessible(true);
        field.set(object, value);
    }

    private static Object field(Object result, String name) throws Exception {
        Field field = result.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(result);
    }

    private static Map<?, ?> cases(Object result) throws Exception {
        Object value = field(result, "cases");
        if (!(value instanceof Map<?, ?> map)) throw new IllegalStateException("cases is not Map");
        return map;
    }

    private static Set<?> set(Object result, String name) throws Exception {
        Object value = field(result, name);
        if (!(value instanceof Set<?> values)) throw new IllegalStateException(name + " is not Set");
        return values;
    }

    private static Object invoke(Method method, Object target, Object... args) throws Exception {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException exception) {
            throw new IllegalStateException("Production method failed: " + method.getName(), exception.getCause());
        }
    }

    private void require(String name, boolean condition) {
        if (!condition) throw new IllegalStateException("Switch evidence assertion failed: " + name);
        checks.add(name);
    }

    private PcodeBlockBasic block(Address start) throws Exception {
        Constructor<PcodeBlockBasic> constructor = PcodeBlockBasic.class.getDeclaredConstructor();
        constructor.setAccessible(true);
        PcodeBlockBasic block = constructor.newInstance();
        setField(PcodeBlockBasic.class, block, "cover", new AddressSet(start, start.add(15)));
        return block;
    }

    private static PcodeOpAST append(PcodeBlockBasic block, Address address, int opcode)
            throws Exception {
        PcodeOpAST operation = new PcodeOpAST(address, 0, opcode, 0);
        Method append = PcodeBlockBasic.class.getDeclaredMethod("insertEnd", PcodeOp.class);
        append.setAccessible(true);
        append.invoke(block, operation);
        return operation;
    }

    private static void incoming(PcodeBlockBasic destination, PcodeBlockBasic source)
            throws Exception {
        Method add = PcodeBlock.class.getDeclaredMethod("addInEdge", PcodeBlock.class, int.class);
        add.setAccessible(true);
        add.invoke(destination, source, 0);
    }

    private static ClangCaseToken token(String text, long magnitude, PcodeOp operation)
            throws Exception {
        ClangCaseToken token = new ClangCaseToken(null);
        setField(ClangToken.class, token, "text", text);
        setField(ClangCaseToken.class, token, "value", magnitude);
        setField(ClangCaseToken.class, token, "op", operation);
        return token;
    }

    private Object value(String text, long magnitude) throws Exception {
        return invoke(exactValue, null, token(text, magnitude, null));
    }

    private static boolean hasUnknownLabelDetail(
        Object result, String label, long magnitude, Address target, Address dispatch
    ) throws Exception {
        for (Object item : set(result, "limitations")) {
            if (item instanceof String detail &&
                detail.contains(label) &&
                detail.contains(Long.toUnsignedString(magnitude)) &&
                detail.contains("0x" + Long.toUnsignedString(target.getOffset(), 16)) &&
                detail.contains("0x" + Long.toUnsignedString(dispatch.getOffset(), 16))) return true;
        }
        return false;
    }

    private Object evidence(Address dispatch, List<Address> destinations, ClangNode... tokens)
            throws Exception {
        JumpTable table = new JumpTable(dispatch, new ArrayList<>(destinations), false, 0);
        return invoke(typedCases, bridge, table, List.of(tokens));
    }

    private void numericChecks() throws Exception {
        require("positive_decimal", Objects.equals(value("3", 3), 3L));
        require("unsigned32_literal_not_rewritten", Objects.equals(value("0xfffffff9", 4294967289L), 4294967289L));
        require("negative_embedded_token_sign", Objects.equals(value("-3", 3), -3L));
        require("negative_hex", Objects.equals(value("-0x3", 3), -3L));
        require("zero", Objects.equals(value("0", 0), 0L));
        require("magnitude_mismatch_unknown", value("-3", 2) == null);
        require("signed_encoding_is_not_magnitude", value("-3", -3) == null);
        require("symbol_label_unknown", value("NAMED_CASE", 3) == null);
        require("compound_label_unknown", value("1 + 2", 3) == null);
        require("safe_positive_boundary", Objects.equals(value("9007199254740991", 9007199254740991L), 9007199254740991L));
        require("safe_negative_boundary", Objects.equals(value("-9007199254740991", 9007199254740991L), -9007199254740991L));
        require("safe_hex_boundary", Objects.equals(value("0x1fffffffffffff", 9007199254740991L), 9007199254740991L));
        require("unsafe_positive_unknown", value("9007199254740992", 9007199254740992L) == null);
        require("unsafe_negative_unknown", value("-9007199254740992", 9007199254740992L) == null);
        require("unsigned64_unknown", value("0xffffffffffffffff", -1L) == null);
    }

    private void graphChecks() throws Exception {
        Address dispatch = toAddr(0x1000);
        Address otherDispatch = toAddr(0x2000);
        Address target = toAddr(0x3000);
        Address otherTarget = toAddr(0x4000);
        PcodeBlockBasic first = block(dispatch);
        PcodeBlockBasic second = block(otherDispatch);
        append(first, dispatch, PcodeOp.BRANCHIND);
        append(second, otherDispatch, PcodeOp.BRANCHIND);
        PcodeBlockBasic destination = block(target);
        PcodeOp body = append(destination, target.add(5), PcodeOp.COPY);
        ClangCaseToken label = token("3", 3, body);
        Object none = evidence(dispatch, List.of(target), label);
        require("no_dispatch_not_attributed", cases(none).isEmpty() && set(none, "defaults").isEmpty());
        incoming(destination, first);
        Object one = evidence(dispatch, List.of(target), label);
        require("unique_dispatch_block_start", Objects.equals(cases(one).get(3L), target));
        require("instruction_offset_is_not_destination", !body.getSeqnum().getTarget().equals(target));
        Object wrong = evidence(otherDispatch, List.of(target), label);
        require("wrong_dispatch_not_attributed", cases(wrong).isEmpty() && set(wrong, "defaults").isEmpty());
        Object absent = evidence(dispatch, List.of(otherTarget), label);
        require("target_not_in_table_not_attributed", cases(absent).isEmpty());

        Object signed = evidence(dispatch, List.of(target), token("-3", 3, body), label);
        require("signed_and_positive_distinct", cases(signed).size() == 2 && Objects.equals(cases(signed).get(-3L), target) && Objects.equals(cases(signed).get(3L), target));
        Object shared = evidence(dispatch, List.of(target), token("1", 1, body), token("2", 2, body));
        require("shared_destination_keeps_all_labels", cases(shared).size() == 2 && Objects.equals(cases(shared).get(1L), target) && Objects.equals(cases(shared).get(2L), target));
        Object defaultRole = evidence(dispatch, List.of(target), token("default", 1, body));
        require("default_ordinary_off_is_role", cases(defaultRole).isEmpty() && set(defaultRole, "defaults").contains(target));
        Object defaultShared = evidence(dispatch, List.of(target), token("default", 1, body), token("1", 1, body));
        require("default_and_numeric_can_share_target", Objects.equals(cases(defaultShared).get(1L), target) && set(defaultShared, "defaults").contains(target));
        Object unsafe = evidence(dispatch, List.of(target), token("9007199254740992", 9007199254740992L, body));
        require("unsafe64_target_preserved_unknown", cases(unsafe).isEmpty() && set(unsafe, "unknownTargets").contains(target) && hasUnknownLabelDetail(unsafe, "9007199254740992", 9007199254740992L, target, dispatch));
        Object mismatch = evidence(dispatch, List.of(target), token("-3", 2, body));
        require("magnitude_mismatch_target_preserved_unknown", cases(mismatch).isEmpty() && set(mismatch, "unknownTargets").contains(target) && hasUnknownLabelDetail(mismatch, "-3", 2, target, dispatch));

        PcodeBlockBasic conflictBlock = block(otherTarget);
        incoming(conflictBlock, first);
        PcodeOp conflictBody = append(conflictBlock, otherTarget.add(5), PcodeOp.COPY);
        Object conflict = evidence(dispatch, List.of(target, otherTarget), label, token("3", 3, conflictBody), label);
        require("conflicting_value_retracted", cases(conflict).isEmpty() && set(conflict, "ambiguousValues").contains(3L));
        require("conflicting_destinations_preserved_unknown", set(conflict, "unknownTargets").contains(target) && set(conflict, "unknownTargets").contains(otherTarget) && !set(conflict, "limitations").isEmpty());

        incoming(destination, second);
        require("api_first_dispatch_is_insufficient", label.getSwitchOp().getSeqnum().getTarget().equals(dispatch));
        Object multiple = evidence(dispatch, List.of(target), label, token("default", 1, body));
        require("multiple_dispatches_rejected", cases(multiple).isEmpty() && set(multiple, "defaults").isEmpty());
        require("multiple_dispatch_target_preserved_unknown", set(multiple, "unknownTargets").contains(target) && !set(multiple, "limitations").isEmpty());
        Object multipleOther = evidence(otherDispatch, List.of(target), label);
        require("multiple_dispatch_rejected_for_other_table", cases(multipleOther).isEmpty() && set(multipleOther, "unknownTargets").contains(target));
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Expected exact ReaGhidraBridge.java source path");
        File expected = new File(args[0]).getCanonicalFile();
        ResourceFile source = GhidraScriptUtil.findScriptByName("ReaGhidraBridge.java");
        if (source == null) throw new IllegalStateException("ReaGhidraBridge.java is absent from scriptPath");
        File actual = new File(source.getAbsolutePath()).getCanonicalFile();
        if (!expected.equals(actual)) throw new IllegalStateException("Bridge source mismatch: expected " + expected + ", resolved " + actual);
        GhidraScriptProvider provider = GhidraScriptUtil.getProvider(source);
        if (provider == null) throw new IllegalStateException("No official script provider for " + source);
        bridge = provider.getScriptInstance(source, errorWriter);
        if (bridge == null) throw new IllegalStateException("Official provider returned no bridge instance");
        bridge.set(getState(), getControls());
        typedCases = bridge.getClass().getDeclaredMethod("typedJumpTableCases", JumpTable.class, List.class);
        typedCases.setAccessible(true);
        exactValue = bridge.getClass().getDeclaredMethod("exactTypedCaseValue", ClangCaseToken.class);
        exactValue.setAccessible(true);
        numericChecks();
        graphChecks();
        JsonObject report = new JsonObject();
        report.addProperty("schema_version", 1);
        report.addProperty("status", "passed");
        report.addProperty("ghidra_version", Application.getApplicationVersion());
        report.addProperty("bridge_source_path", actual.toString());
        report.addProperty("bridge_source_sha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(actual.toPath()))));
        report.addProperty("check_count", checks.size());
        report.add("checks", checks);
        report.addProperty("scope", "production private methods on detached Ghidra model objects; no bridge run or imported-program mutation; reflection depends on pinned model internals");
        println("REA_SWITCH_EVIDENCE_PROBE_JSON " + report);
        println("REA_SWITCH_EVIDENCE_PROBE_COMPLETE");
    }
}
