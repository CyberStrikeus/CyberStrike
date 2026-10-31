import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Program;
import java.math.BigInteger;

/** Seed the declared DOS COM analysis context before default auto-analysis. */
public final class ReaGhidraPrepareCom extends GhidraScript {
    @Override
    public void run() throws Exception {
        if (!currentProgram.getLanguageID().getIdAsString().equals("x86:LE:16:Real Mode") ||
            !currentProgram.getExecutableFormat().equals("Raw Binary")) {
            throw new IllegalArgumentException("DOS COM preparation requires raw x86 real-mode import");
        }
        Address entry = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress("1000:0100");
        Address start = currentProgram.getMinAddress();
        Address end = currentProgram.getMaxAddress();
        if (!entry.equals(start) || end.subtract(start) + 1 > 0xff00) {
            throw new IllegalArgumentException("DOS COM import must map 1..65280 bytes at 1000:0100");
        }
        for (String name : new String[] { "CS", "DS", "ES", "SS" }) {
            monitor.checkCancelled();
            currentProgram.getProgramContext().setValue(
                currentProgram.getRegister(name), start, end, BigInteger.valueOf(0x1000)
            );
        }
        addEntryPoint(entry);
        if (!disassemble(entry) || createFunction(entry, "entry") == null) {
            throw new IllegalStateException("DOS COM entry cannot be decoded as a function");
        }
        currentProgram.getOptions(Program.PROGRAM_INFO).setBoolean("REA DOS COM prepared", true);
    }
}
