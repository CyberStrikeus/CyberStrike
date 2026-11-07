import ghidra.app.script.GhidraScript;
import ghidra.program.database.mem.FileBytes;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSpace;
import ghidra.program.model.listing.Program;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.mem.MemoryBlockSourceInfo;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Rebuild a GameCube/Wii DOL memory map from the validated load ranges REA's TypeScript
 * admission wrote. BinaryLoader maps the whole file once at address 0; this
 * script replaces that block with text, data, and BSS blocks at their load addresses.
 */
public final class ReaGhidraPrepareDol extends GhidraScript {
    // Canonical v2 header, 18 section rows, 12 gap rows and entry, using uint32 hex.
    private static final int MAX_PLAN_BYTES = 13 + 18 * 49 + 12 * 30 + 17;
    private static final class Section {
        final String kind;
        final int index;
        final long fileOffset;
        final long address;
        final long size;

        Section(String kind, int index, long fileOffset, long address, long size) {
            this.kind = kind;
            this.index = index;
            this.fileOffset = fileOffset;
            this.address = address;
            this.size = size;
        }
    }

    private record BssGap(long address, long size) {}

    @Override
    public void run() throws Exception {
        String[] arguments = getScriptArgs();
        if (arguments.length != 1) {
            throw new IllegalArgumentException(
                "GameCube DOL preparation requires exactly one section table path"
            );
        }
        if (!currentProgram.getExecutableFormat().equals("Raw Binary") ||
            !currentProgram.getLanguageID().getIdAsString().startsWith("PowerPC:BE:32:")) {
            throw new IllegalArgumentException(
                "GameCube DOL preparation requires a BinaryLoader import in big-endian 32-bit PowerPC"
            );
        }
        Path tablePath = Path.of(arguments[0]);
        if (!Files.isRegularFile(tablePath, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalArgumentException("GameCube DOL section table is not a regular file");
        }
        if (Files.size(tablePath) > MAX_PLAN_BYTES) {
            throw new IllegalArgumentException("GameCube DOL plan exceeds the canonical format's byte bound");
        }

        List<Section> sections = new ArrayList<>();
        List<BssGap> bssGaps = new ArrayList<>();
        int expectedSections = -1;
        int expectedGaps = -1;
        long entry = -1;
        for (String line : Files.readAllLines(tablePath)) {
            String[] fields = line.trim().split("\\s+");
            switch (fields[0]) {
                case "plan" -> {
                    requireFields(fields, 4, line);
                    if (expectedSections >= 0 || !fields[1].equals("2")) {
                        throw new IllegalArgumentException("Duplicate or unsupported GameCube DOL plan header");
                    }
                    expectedSections = Integer.parseInt(fields[2]);
                    expectedGaps = Integer.parseInt(fields[3]);
                    // A DOL has 18 slots, including at most 11 data slots and 12 BSS gaps.
                    if (expectedSections < 1 || expectedSections > 18 || expectedGaps < 0 || expectedGaps > 12) {
                        throw new IllegalArgumentException("GameCube DOL plan counts exceed the format's slot bounds");
                    }
                }
                case "section" -> {
                    requireFields(fields, 6, line);
                    if (expectedSections < 0 || sections.size() >= expectedSections) {
                        throw new IllegalArgumentException("GameCube DOL section exceeds its declared count");
                    }
                    sections.add(new Section(
                        fields[1],
                        Integer.parseInt(fields[2]),
                        Long.decode(fields[3]),
                        Long.decode(fields[4]),
                        Long.decode(fields[5])
                    ));
                }
                case "bss-gap" -> {
                    requireFields(fields, 3, line);
                    if (expectedGaps < 0 || bssGaps.size() >= expectedGaps) {
                        throw new IllegalArgumentException("GameCube DOL BSS gap exceeds its declared count");
                    }
                    long address = Long.decode(fields[1]);
                    long size = Long.decode(fields[2]);
                    if (address < 0 || size <= 0) {
                        throw new IllegalArgumentException("GameCube DOL BSS gap is not a positive range");
                    }
                    bssGaps.add(new BssGap(address, size));
                }
                case "entry" -> {
                    requireFields(fields, 2, line);
                    entry = Long.decode(fields[1]);
                }
                default -> throw new IllegalArgumentException("Unknown GameCube DOL table line: " + line);
            }
        }
        if (expectedSections != sections.size() || expectedGaps != bssGaps.size() || entry < 0) {
            throw new IllegalArgumentException("GameCube DOL section table is incomplete");
        }

        Memory memory = currentProgram.getMemory();
        List<FileBytes> files = memory.getAllFileBytes();
        if (files.size() != 1) {
            throw new IllegalStateException("GameCube DOL preparation requires exactly one imported file image");
        }
        FileBytes fileBytes = files.get(0);
        AddressSpace space = currentProgram.getAddressFactory().getDefaultAddressSpace();

        // Remove the whole-file block before creating section blocks, so no two blocks claim one address.
        for (MemoryBlock block : memory.getBlocks()) {
            for (MemoryBlockSourceInfo source : block.getSourceInfos()) {
                if (source.getFileBytes().isPresent() && source.getFileBytes().get().equals(fileBytes)) {
                    memory.removeBlock(block, monitor);
                    break;
                }
            }
        }

        for (Section section : sections) {
            if (section.fileOffset + section.size > fileBytes.getSize()) {
                throw new IllegalArgumentException(
                    "GameCube DOL " + section.kind + " " + section.index + " exceeds the imported file"
                );
            }
            boolean text = section.kind.equals("text");
            if (!text && !section.kind.equals("data")) {
                throw new IllegalArgumentException("Unknown GameCube DOL section kind: " + section.kind);
            }
            MemoryBlock block = memory.createInitializedBlock(
                "." + section.kind + section.index,
                space.getAddress(section.address),
                fileBytes,
                section.fileOffset,
                section.size,
                false
            );
            block.setRead(true);
            block.setWrite(!text);
            block.setExecute(text);
        }

        // Apply the domain owner's exact uninitialized ranges; do not reinterpret BSS here.
        int gapIndex = 0;
        for (BssGap gap : bssGaps) {
            MemoryBlock block = memory.createUninitializedBlock(
                ".bss" + gapIndex++,
                space.getAddress(gap.address()),
                gap.size(),
                false
            );
            block.setRead(true);
            block.setWrite(true);
            block.setExecute(false);
        }

        Address entryAddress = space.getAddress(entry);
        MemoryBlock entryBlock = memory.getBlock(entryAddress);
        if (entryBlock == null || !entryBlock.isExecute()) {
            throw new IllegalArgumentException("GameCube DOL entry must lie in an executable section");
        }
        addEntryPoint(entryAddress);
        if (!disassemble(entryAddress) || createFunction(entryAddress, "__start") == null) {
            throw new IllegalStateException("GameCube DOL entry cannot be decoded as a function");
        }
        currentProgram.getOptions(Program.PROGRAM_INFO).setBoolean("REA raw binary prepared", true);
        currentProgram.getOptions(Program.PROGRAM_INFO).setBoolean("REA GameCube DOL prepared", true);
    }

    private static void requireFields(String[] fields, int count, String line) {
        if (fields.length != count) {
            throw new IllegalArgumentException("Malformed GameCube DOL table line: " + line);
        }
    }

}
