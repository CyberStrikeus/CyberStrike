import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.mem.MemoryBlockSourceInfo;

/** Seed the caller-supplied raw-binary entry before default auto-analysis. */
public final class ReaGhidraPrepareRaw extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] arguments = getScriptArgs();
        if (arguments.length != 2) {
            throw new IllegalArgumentException(
                "Raw binary preparation requires the committed language and entry address"
            );
        }
        String expectedLanguage = arguments[0];
        String entryHex = arguments[1];
        if (!currentProgram.getLanguageID().getIdAsString().equals(expectedLanguage) ||
            !currentProgram.getExecutableFormat().equals("Raw Binary")) {
            throw new IllegalArgumentException(
                "Raw binary preparation requires the committed language and BinaryLoader import"
            );
        }
        Address entry = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(entryHex);
        MemoryBlock block = entry == null ? null : currentProgram.getMemory().getBlock(entry);
        boolean fileStart = false;
        if (block != null) {
            // Processor-defined zero page/stack blocks can precede the imported file.
            for (MemoryBlockSourceInfo source : block.getSourceInfos()) {
                if (source.getFileBytes().isPresent() && source.getFileBytesOffset() == 0 &&
                    entry.equals(source.getMinAddress())) {
                    fileStart = true;
                    break;
                }
            }
        }
        if (!fileStart) {
            throw new IllegalArgumentException(
                "Raw binary import must map file offset 0 at the caller-supplied entry"
            );
        }
        addEntryPoint(entry);
        if (!disassemble(entry) || createFunction(entry, "entry") == null) {
            throw new IllegalStateException("Raw binary entry cannot be decoded as a function");
        }
        currentProgram.getOptions(Program.PROGRAM_INFO).setBoolean("REA raw binary prepared", true);
    }
}
