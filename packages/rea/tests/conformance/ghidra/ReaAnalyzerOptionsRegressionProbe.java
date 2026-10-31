import ghidra.app.util.headless.HeadlessScript;
import ghidra.program.model.listing.Program;

/** Independent readback oracle for the production analyzer-options pre-script. */
public final class ReaAnalyzerOptionsRegressionProbe extends HeadlessScript {
    @Override
    public void run() throws Exception {
        String[] arguments = getScriptArgs();
        if (arguments.length != 1 || arguments[0].isBlank()) {
            throw new IllegalArgumentException("Expected one analyzer name");
        }
        monitor.checkCancelled();
        String name = arguments[0];
        String enabled = getCurrentAnalysisOptionsAndValues(currentProgram).get(name);
        if (!"false".equals(enabled)) {
            throw new IllegalStateException("Analyzer option is not disabled: " + name);
        }
        println("REA_ANALYZER_OPTIONS_DISABLED_OK " + name);
        println("REA_ANALYZER_OPTIONS_REPORT " +
            currentProgram.getOptions(Program.PROGRAM_INFO).getString("REA disabled analyzers", null));
    }
}
