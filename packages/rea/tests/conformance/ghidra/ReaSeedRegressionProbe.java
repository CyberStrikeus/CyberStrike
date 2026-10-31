//@category REA Verification

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Program;

/** Run the production seed script against a minimal 32-bit import. */
public final class ReaSeedRegressionProbe extends GhidraScript {
    @Override
    public void run() throws Exception {
        currentProgram.getMemory().createUninitializedBlock(
            ".bss", toAddr(0x1000), 0x20, false
        );
        runScript("ReaGhidraApplySeeds.java", new String[] { getScriptArgs()[0] });
        JsonObject report = JsonParser.parseString(
            currentProgram.getOptions(Program.PROGRAM_INFO)
                .getString("REA analysis seeds", null)
        ).getAsJsonObject();
        require(report.get("entries").getAsInt() == 5, "all seeds accounted for");
        require(report.get("function_created").getAsInt() == 2,
            "out-of-range seed must not disturb descending function order");
        require(report.get("function_failed").getAsInt() == 0, "no swallowed function entry");
        require(getFunctionAt(toAddr(0)).getName().equals("seed_low"), "lower function name");
        require(getFunctionAt(toAddr(1)).getName().equals("seed_high"), "higher function name");
        require(report.get("label_applied").getAsInt() == 1, "mapped BSS label applied");
        require(currentProgram.getSymbolTable().getPrimarySymbol(toAddr(0x1000))
            .getName().equals("seed_global"), "BSS label name");
        require(report.get("unmapped").getAsInt() == 2,
            "only out-of-range function and uninitialized code seed are skipped");
        require(report.get("code_decoded").getAsInt() == 0, "BSS is not decoded");
        println("REA_SEED_REGRESSION_OK " + report);
    }

    private void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
