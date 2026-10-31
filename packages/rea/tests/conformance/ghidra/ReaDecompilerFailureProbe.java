//@category REA Verification

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import generic.jar.ResourceFile;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileProcess.DisposeState;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.app.script.GhidraScriptUtil;
import ghidra.app.util.headless.HeadlessAnalyzer;
import ghidra.app.util.headless.HeadlessScript;
import ghidra.framework.Application;
import ghidra.program.model.listing.Function;
import ghidra.util.task.TaskMonitor;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

/**
 * Replaces the bridge decompiler after real import and analysis so one procedure's
 * decompilation fails. Verifies that analyze_function still returns the listing-backed
 * facts. This injection does not establish which natural inputs make Ghidra fail.
 */
public class ReaDecompilerFailureProbe extends GhidraScript {
    private static final String INJECTED = "Injected backend failure";
    private static final List<String> LISTING_FACETS = List.of(
        "assembly", "comments", "callers", "callees", "incoming_references",
        "outgoing_references", "referenced_strings", "referenced_names", "basic_blocks",
        "unresolved_calls");
    private final JsonArray checks = new JsonArray();

    private void require(String name, boolean condition) {
        if (!condition) throw new IllegalStateException("Decompiler failure assertion failed: " + name);
        checks.add(name);
    }

    private Function exportedFunction(String name) {
        Function selected = null;
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (!f.isThunk() && (f.getName().equals(name) || f.getName().equals("_" + name)) &&
                currentProgram.getSymbolTable().isExternalEntryPoint(f.getEntryPoint())) {
                if (selected != null) throw new IllegalStateException("Ambiguous fixture export " + name);
                selected = f;
            }
        }
        if (selected == null) throw new IllegalStateException("Missing fixture export " + name);
        return selected;
    }

    private GhidraScript script(String name, File expected) throws Exception {
        ResourceFile source = GhidraScriptUtil.findScriptByName(name);
        if (source == null || !expected.equals(new File(source.getAbsolutePath()).getCanonicalFile()))
            throw new IllegalStateException("Fixture resolved an unexpected script: " + name);
        GhidraScript instance = GhidraScriptUtil.getProvider(source).getScriptInstance(source, errorWriter);
        instance.set(getState(), getControls());
        // Match HeadlessScript.runScript's nested-script setup before invoking
        // the real request handler, which checks the current analysis status.
        Method headless = HeadlessScript.class.getDeclaredMethod("setHeadlessInstance", HeadlessAnalyzer.class);
        headless.setAccessible(true);
        headless.invoke(instance, HeadlessAnalyzer.getInstance());
        return instance;
    }

    private static DecompInterface failing(Function expected, DisposeState disposition) {
        return new DecompInterface() {
            @Override
            public DecompileResults decompileFunction(Function function, int timeout, TaskMonitor taskMonitor) {
                if (!function.equals(expected))
                    throw new IllegalStateException("Unexpected decompilation of " + function.getName());
                return new DecompileResults(function, function.getProgram().getLanguage(),
                    function.getProgram().getCompilerSpec(), null, INJECTED, null, disposition);
            }
        };
    }

    private static String failureCode(Throwable failure) throws Exception {
        Field code = failure.getClass().getDeclaredField("code");
        code.setAccessible(true);
        return (String) code.get(failure);
    }

    private static String reason(JsonObject value) {
        JsonElement reason = value.get("reason");
        return reason == null ? null : reason.getAsString();
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) throw new IllegalArgumentException("Expected exact bridge directory");
        File directory = new File(args[0]).getCanonicalFile();
        GhidraScript bridge = script("ReaGhidraBridge.java", new File(directory, "ReaGhidraBridge.java"));
        Field space = bridge.getClass().getDeclaredField("sessionDefaultAddressSpace");
        space.setAccessible(true);
        space.set(null, currentProgram.getAddressFactory().getDefaultAddressSpace());
        Method initialize = bridge.getClass().getDeclaredMethod("initializeDecompiler");
        initialize.setAccessible(true);
        initialize.invoke(bridge);

        // Exercise the real production error factory, without claiming a natural regex overflow.
        Method regexFactory = bridge.getClass().getDeclaredMethod(
            "regexStackExhausted", String.class, String.class);
        regexFactory.setAccessible(true);
        Throwable regexFailure = (Throwable) regexFactory.invoke(null, "(a+)+$", "matching");
        require("regex_failure_preserves_stage_and_pattern",
                failureCode(regexFailure).equals("regex_stack_exhausted") &&
                regexFailure.getMessage().contains("matching pattern (a+)+$."));
        require("regex_failure_leaves_lifecycle_to_provider",
                !regexFailure.getMessage().contains("session") &&
                !regexFailure.getMessage().contains("Use literal"));
        Class<?> requestType = Class.forName(bridge.getClass().getName() + "$Request", true, bridge.getClass().getClassLoader());
        Class<?> descriptorType = Class.forName(bridge.getClass().getName() + "$SessionDescriptor", true, bridge.getClass().getClassLoader());
        Constructor<?> requestConstructor = requestType.getDeclaredConstructor(int.class, String.class, JsonObject.class);
        requestConstructor.setAccessible(true);
        Method analyze = bridge.getClass().getDeclaredMethod("handleRequest", requestType, descriptorType);
        analyze.setAccessible(true);
        Method pseudocode = bridge.getClass().getDeclaredMethod("procedurePseudocode", JsonObject.class);
        pseudocode.setAccessible(true);
        Field decompiler = bridge.getClass().getDeclaredField("decompiler");
        decompiler.setAccessible(true);
        DecompInterface real = (DecompInterface) decompiler.get(bridge);

        Function target = exportedFunction("rea_cross_branch");
        String procedure = "0x" + Long.toUnsignedString(target.getEntryPoint().getOffset(), 16);
        JsonObject query = new JsonObject();
        query.addProperty("procedure", procedure);
        // Exercise the actual wire response producer, including cache metadata.
        Object request = requestConstructor.newInstance(1, "analyze_function", query);
        JsonObject pseudocodeQuery = new JsonObject();
        pseudocodeQuery.add("document", JsonNull.INSTANCE);
        pseudocodeQuery.addProperty("procedure", procedure);

        JsonObject baseline;
        JsonObject degraded;
        try {
            baseline = (JsonObject) analyze.invoke(bridge, request, null);
            JsonObject value = baseline.getAsJsonObject("value");
            require("healthy_snapshot_policy_preserved", !baseline.has("cache_policy"));
            require("baseline_pseudocode_available", !value.get("pseudocode").getAsString().isEmpty() &&
                value.getAsJsonObject("facet_availability").getAsJsonObject("pseudocode").get("available").getAsBoolean());
            require("baseline_native_api_available", value.getAsJsonObject("native_api").get("available").getAsBoolean());
            require("baseline_assembly_present", value.getAsJsonArray("assembly").size() > 0);
            require("baseline_callers_present", value.getAsJsonArray("callers").size() > 0);
            require("baseline_callees_present", value.getAsJsonArray("callees").size() > 0);
            require("baseline_multiple_blocks_present", value.getAsJsonArray("basic_blocks").size() > 1);

            decompiler.set(bridge, failing(target, DisposeState.NOT_DISPOSED));
            degraded = (JsonObject) analyze.invoke(bridge, request, null);
            JsonObject dossier = degraded.getAsJsonObject("value");
            require("decompiler_failure_is_live", degraded.get("cache_policy").getAsString().equals("live"));
            String expected = "Ghidra decompilation failed: " + INJECTED;
            require("dossier_returned", dossier.getAsJsonObject("procedure").get("address").getAsString()
                .equals(value.getAsJsonObject("procedure").get("address").getAsString()));
            JsonObject facets = dossier.getAsJsonObject("facet_availability");
            require("pseudocode_unavailable_with_failure", dossier.get("pseudocode").getAsString().isEmpty() &&
                !facets.getAsJsonObject("pseudocode").get("available").getAsBoolean() &&
                expected.equals(reason(facets.getAsJsonObject("pseudocode"))));
            require("native_api_unavailable_with_failure",
                !dossier.getAsJsonObject("native_api").get("available").getAsBoolean() &&
                expected.equals(reason(dossier.getAsJsonObject("native_api"))));
            require("native_value_flow_unavailable_with_failure",
                !dossier.getAsJsonObject("native_value_flow").get("available").getAsBoolean() &&
                expected.equals(reason(dossier.getAsJsonObject("native_value_flow"))));
            for (String facet : LISTING_FACETS)
                require("listing_facet_unchanged_" + facet, dossier.get(facet).equals(value.get(facet)));
            for (String facet : List.of("assembly", "comments", "callers", "callees", "references", "strings_names", "cfg"))
                require("facet_availability_unchanged_" + facet,
                    facets.get(facet).equals(value.getAsJsonObject("facet_availability").get(facet)));
            require("relationship_coverage_unchanged",
                degraded.get("relationship_coverage").equals(baseline.get("relationship_coverage")));
            boolean named = false;
            for (JsonElement item : dossier.getAsJsonArray("limitations"))
                named |= item.getAsString().startsWith(expected + ". Pseudocode, the native API boundary") &&
                    item.getAsString().contains("were still collected");
            require("failure_limitation_named", named);

            try {
                pseudocode.invoke(bridge, pseudocodeQuery);
                throw new IllegalStateException("Pseudocode request unexpectedly succeeded");
            } catch (InvocationTargetException failure) {
                require("pseudocode_request_still_fails",
                    failureCode(failure.getCause()).equals("decompile_failed") &&
                    failure.getCause().getMessage().equals(expected));
            }

            decompiler.set(bridge, failing(target, DisposeState.DISPOSED_ON_CANCEL));
            try {
                analyze.invoke(bridge, request, null);
                throw new IllegalStateException("Cancelled decompilation unexpectedly returned a dossier");
            } catch (InvocationTargetException failure) {
                require("cancellation_still_ends_request",
                    failureCode(failure.getCause()).equals("decompile_cancelled"));
            }

            // A decompile that reaches REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS degrades the
            // same way, names the setting, and stays out of snapshots.
            Field limit = bridge.getClass().getDeclaredField("decompileTimeoutSeconds");
            limit.setAccessible(true);
            limit.setInt(bridge, 5);
            String limitText = "exceeded the 5-second limit set by REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS";
            decompiler.set(bridge, failing(target, DisposeState.DISPOSED_ON_TIMEOUT));
            JsonObject timedOut = (JsonObject) analyze.invoke(bridge, request, null);
            JsonObject timedOutDossier = timedOut.getAsJsonObject("value");
            require("timed_out_decompile_is_live",
                timedOut.has("cache_policy") && timedOut.get("cache_policy").getAsString().equals("live"));
            String timedOutReason = reason(timedOutDossier.getAsJsonObject("facet_availability")
                .getAsJsonObject("pseudocode"));
            require("timed_out_pseudocode_names_limit", timedOutReason != null &&
                timedOutReason.startsWith("Ghidra decompilation of ") && timedOutReason.endsWith(limitText));
            require("timed_out_native_api_names_limit",
                !timedOutDossier.getAsJsonObject("native_api").get("available").getAsBoolean() &&
                timedOutReason.equals(reason(timedOutDossier.getAsJsonObject("native_api"))));
            require("timed_out_listing_unchanged",
                timedOutDossier.get("assembly").equals(value.get("assembly")) &&
                timedOutDossier.get("basic_blocks").equals(value.get("basic_blocks")));
            try {
                pseudocode.invoke(bridge, pseudocodeQuery);
                throw new IllegalStateException("Timed-out pseudocode request unexpectedly succeeded");
            } catch (InvocationTargetException failure) {
                require("timed_out_pseudocode_request_names_limit",
                    failureCode(failure.getCause()).equals("decompile_timed_out") &&
                    failure.getCause().getMessage().endsWith(limitText));
            }
            limit.setInt(bridge, 0);

            decompiler.set(bridge, real);
            JsonObject recovered = (JsonObject) analyze.invoke(bridge, request, null);
            require("session_recovers_after_failure", recovered.getAsJsonObject("value")
                .getAsJsonObject("facet_availability").getAsJsonObject("pseudocode").get("available").getAsBoolean());
        } finally {
            decompiler.set(bridge, real);
            real.dispose();
        }

        JsonObject report = new JsonObject();
        report.addProperty("status", "passed");
        report.addProperty("ghidra_version", Application.getApplicationVersion());
        report.addProperty("target_sha256", currentProgram.getExecutableSHA256());
        byte[] bytes = Files.readAllBytes(new File(directory, "ReaGhidraBridge.java").toPath());
        report.addProperty("ReaGhidraBridge.java",
            HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)));
        report.add("checks", checks);
        report.add("baseline", baseline);
        report.add("degraded", degraded);
        println("REA_DECOMPILER_FAILURE_PROBE_JSON " + report);
    }
}
