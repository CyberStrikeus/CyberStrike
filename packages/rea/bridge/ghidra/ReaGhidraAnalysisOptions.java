import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import ghidra.app.plugin.core.analysis.AutoAnalysisManager;
import ghidra.app.services.Analyzer;
import ghidra.app.util.headless.HeadlessScript;
import ghidra.program.model.listing.Program;
import ghidra.util.classfinder.ClassSearcher;

/**
 * Disable the named auto-analyzers before default auto-analysis.
 *
 * REA_GHIDRA_DISABLED_ANALYZERS is process-wide, but Ghidra registers only the
 * installed analyzers whose canAnalyze(program) accepts this program. A name an
 * installed analyzer provides without being registered here is not applicable
 * and is recorded instead of rejected; a name no installed analyzer provides
 * aborts the import. The outcome is stored as a program property that the
 * bridge reports during its handshake.
 */
public final class ReaGhidraAnalysisOptions extends HeadlessScript {
    static final String REPORT_OPTION = "REA disabled analyzers";
    private static final String SETTING = "REA_GHIDRA_DISABLED_ANALYZERS";

    @Override
    public void run() throws Exception {
        String[] arguments = getScriptArgs();
        if (arguments.length != 1 || arguments[0].isBlank()) {
            throw new IllegalArgumentException(
                "ReaGhidraAnalysisOptions requires one comma-separated " + SETTING + " argument");
        }
        String[] names = arguments[0].split(",");
        boolean[] registered = new boolean[names.length];
        AutoAnalysisManager analysis = AutoAnalysisManager.getAnalysisManager(currentProgram);
        Map<String, String> options = getCurrentAnalysisOptionsAndValues(currentProgram);
        Set<String> installed = null;
        for (int index = 0; index < names.length; index++) {
            monitor.checkCancelled();
            String name = names[index].trim();
            names[index] = name;
            if (analysis.getAnalyzer(name) != null) {
                if (!options.containsKey(name)) {
                    throw new IllegalStateException(SETTING + " names " + name +
                        ", which Ghidra registered for this program without an enablement option");
                }
                registered[index] = true;
                continue;
            }
            if (installed == null) installed = installedAnalyzerNames();
            if (!installed.contains(name)) {
                throw new IllegalArgumentException(SETTING + " names " + name +
                    ", which is not an analyzer in this Ghidra installation");
            }
        }
        for (int index = 0; index < names.length; index++) {
            monitor.checkCancelled();
            if (registered[index]) setAnalysisOption(currentProgram, names[index], "false");
        }
        options = getCurrentAnalysisOptionsAndValues(currentProgram);
        JsonArray analyzers = new JsonArray();
        for (int index = 0; index < names.length; index++) {
            monitor.checkCancelled();
            String name = names[index];
            if (registered[index] && !"false".equals(options.get(name))) {
                throw new IllegalStateException(SETTING + " names " + name +
                    ", which remained enabled for this program");
            }
            JsonObject analyzer = new JsonObject();
            analyzer.addProperty("name", name);
            analyzer.addProperty("status", registered[index] ? "disabled" : "not_applicable");
            analyzers.add(analyzer);
        }
        JsonObject report = new JsonObject();
        report.addProperty("format", "rea-ghidra-disabled-analyzers-v1");
        report.add("analyzers", analyzers);
        currentProgram.getOptions(Program.PROGRAM_INFO).setString(REPORT_OPTION, report.toString());
        println("REA disabled analyzers: " + report);
    }

    /** The same analyzer universe AutoAnalysisManager filters by canAnalyze(program). */
    private static Set<String> installedAnalyzerNames() {
        Set<String> names = new HashSet<>();
        for (Analyzer analyzer : ClassSearcher.getInstances(Analyzer.class)) {
            names.add(analyzer.getName());
        }
        return names;
    }
}
