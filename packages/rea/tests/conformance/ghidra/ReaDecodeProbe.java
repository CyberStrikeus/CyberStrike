//@category REA Verification

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Instruction;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Decodes source-owned bytes in the imported language's default context; no
 * context register is set. Arguments are the expected language ID, then one
 * mnemonic/length[/operand] expectation per instruction from the first byte.
 * An operand expectation must equal one complete operand, so "msp" does not
 * accept "msplim".
 */
public class ReaDecodeProbe extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        require(args.length >= 2, "Expected a language ID and instruction expectations");
        String language = currentProgram.getLanguageID().getIdAsString();
        require(language.equals(args[0]), "Imported language " + language);
        Address address = currentProgram.getMemory().getMinAddress();
        for (int index = 1; index < args.length; index++) {
            String[] expected = args[index].split("/", 3);
            require(expected.length >= 2, "Malformed expectation " + args[index]);
            if (getInstructionAt(address) == null) disassemble(address);
            Instruction instruction = getInstructionAt(address);
            require(instruction != null, "No instruction decoded at " + address);
            String text = instruction.toString().toLowerCase(Locale.ROOT);
            String decoded = instruction.getMnemonicString().toLowerCase(Locale.ROOT)
                + "/" + instruction.getLength();
            Set<String> operands = new HashSet<>();
            for (int operand = 0; operand < instruction.getNumOperands(); operand++)
                operands.add(instruction.getDefaultOperandRepresentation(operand)
                    .toLowerCase(Locale.ROOT));
            println("REA_DECODE " + address + " " + text + " operands=" + operands);
            require(decoded.equals(expected[0] + "/" + expected[1])
                && (expected.length == 2 || operands.contains(expected[2])),
                "Expected " + args[index] + " at " + address + ", decoded " + text);
            address = address.add(instruction.getLength());
        }
        println("REA_DECODE_OK " + String.join(" ", args));
    }

    private static void require(boolean condition, String label) {
        if (!condition) throw new IllegalStateException(label);
    }
}
