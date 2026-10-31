import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSpace;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.SourceType;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * Apply caller-declared analysis seeds before default auto-analysis.
 *
 * The single argument is REA's canonical seed snapshot: one
 * {@code 0x<hex>\t(function|code|label)[\tname]} line per seed. Code seeds are
 * applied after functions (highest address first), then labels. The outcome is stored as a
 * program property that the bridge reports during its handshake.
 */
public final class ReaGhidraApplySeeds extends GhidraScript {
    static final String REPORT_OPTION = "REA analysis seeds";

    private record Seed(Address address, String kind, String name) {}

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 1) {
            throw new IllegalArgumentException("REA seed script requires exactly one seed file");
        }
        Path path = Path.of(args[0]);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("REA seed file is not a regular file");
        }
        byte[] bytes = Files.readAllBytes(path);
        String sha256 = HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-256").digest(bytes)
        );
        AddressSpace space = currentProgram.getAddressFactory().getDefaultAddressSpace();
        List<Seed> seeds = new ArrayList<>();
        for (String line : new String(bytes, StandardCharsets.UTF_8).split("\n")) {
            if (line.isEmpty()) continue;
            String[] fields = line.split("\t", -1);
            if (fields.length < 2 || fields.length > 3 || !fields[0].startsWith("0x")) {
                throw new IllegalArgumentException("REA seed snapshot is malformed");
            }
            Address address;
            try {
                address = space.getAddress(Long.parseUnsignedLong(fields[0].substring(2), 16));
            } catch (ghidra.program.model.address.AddressOutOfBoundsException e) {
                address = null;
            }
            seeds.add(new Seed(address, fields[1], fields.length == 3 ? fields[2] : null));
        }

        // Highest address first: a function body computed before analysis stops at
        // an existing function entry, so later creations cannot swallow earlier ones.
        seeds.sort((left, right) -> {
            if (left.address() == null) return right.address() == null ? 0 : 1;
            if (right.address() == null) return -1;
            return right.address().compareTo(left.address());
        });
        int unmapped = 0;
        int logged = 0;
        int codeDecoded = 0, codeFailed = 0;
        int functionCreated = 0, functionExisting = 0, functionFailed = 0;
        int labelApplied = 0, labelFailed = 0;
        for (String pass : new String[] { "function", "code", "label" }) {
            for (Seed seed : seeds) {
                if (!seed.kind().equals(pass)) continue;
                monitor.checkCancelled();
                MemoryBlock block = seed.address() == null
                    ? null
                    : currentProgram.getMemory().getBlock(seed.address());
                if (block == null || (!pass.equals("label") && !block.isInitialized())) {
                    unmapped++;
                    continue;
                }
                switch (pass) {
                    case "code" -> {
                        if (decoded(seed.address())) codeDecoded++;
                        else {
                            codeFailed++;
                            if (logged++ < 20) println("REA seed failed: code " + seed.address() + " " + why(seed.address()));
                        }
                    }
                    case "function" -> {
                        Function existing = getFunctionAt(seed.address());
                        if (existing != null) {
                            functionExisting++;
                            if (seed.name() != null) {
                                existing.setName(seed.name(), SourceType.USER_DEFINED);
                            }
                        } else if (decoded(seed.address()) &&
                            createFunction(seed.address(), seed.name()) != null) {
                            functionCreated++;
                        } else {
                            functionFailed++;
                            if (logged++ < 20) println("REA seed failed: function " + seed.address() + " " + why(seed.address()));
                        }
                    }
                    default -> {
                        try {
                            createLabel(seed.address(), seed.name(), true, SourceType.USER_DEFINED);
                            labelApplied++;
                        } catch (Exception e) {
                            labelFailed++;
                        }
                    }
                }
            }
        }
        String report = "{\"format\":\"rea-ghidra-seeds-v1\",\"sha256\":\"" + sha256 + "\"" +
            ",\"entries\":" + seeds.size() +
            ",\"function_created\":" + functionCreated +
            ",\"function_existing\":" + functionExisting +
            ",\"function_failed\":" + functionFailed +
            ",\"code_decoded\":" + codeDecoded +
            ",\"code_failed\":" + codeFailed +
            ",\"label_applied\":" + labelApplied +
            ",\"label_failed\":" + labelFailed +
            ",\"unmapped\":" + unmapped + "}";
        currentProgram.getOptions(Program.PROGRAM_INFO).setString(REPORT_OPTION, report);
        println("REA seeds applied: " + report);
    }

    private String why(Address address) {
        if (getDataAt(address) != null) return "defined data " + getDataAt(address).getDataType().getName();
        var containing = getInstructionContaining(address);
        if (containing != null && !containing.getAddress().equals(address))
            return "inside instruction at " + containing.getAddress();
        Function owner = getFunctionContaining(address);
        if (owner != null) return "inside function " + owner.getEntryPoint();
        return getInstructionAt(address) == null ? "undecodable" : "function creation refused";
    }

    /** Decode one instruction flow at an address, keeping an existing decode. */
    private boolean decoded(Address address) {
        if (getInstructionAt(address) != null) return true;
        if (getDataAt(address) != null || getInstructionContaining(address) != null) {
            return false;
        }
        disassemble(address);
        return getInstructionAt(address) != null;
    }
}
