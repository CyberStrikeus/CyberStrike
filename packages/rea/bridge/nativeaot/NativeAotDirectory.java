package rea.extensions.nativeaot;

import ghidra.app.util.importer.MessageLog;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Program;
import ghidra.util.task.TaskMonitor;
import java.util.LinkedHashSet;
import nativeaot.rtr.ReadyToRunDirectory;
import nativeaot.rtr.ReadyToRunSection;
import nativeaot.rtr.SignatureReadyToRunLocator;
import nativeaot.rtr.SymbolReadyToRunLocator;

/** Validate the producer's NativeAOT row layout before database mutation. */
final class NativeAotDirectory {
    record Located(Address address, ReadyToRunDirectory directory, String discovery) {}

    static Located locate(Program program, TaskMonitor monitor, MessageLog log) throws Exception {
        Address[] symbols = SymbolReadyToRunLocator.instance.locateModules(program, monitor, log);
        String discovery = symbols.length == 0 ? "signature-heuristic" : "symbol";
        Address[] found = symbols.length == 0
            ? SignatureReadyToRunLocator.instance.locateModules(program, monitor, log) : symbols;
        var candidates = new LinkedHashSet<Address>();
        for (Address address : found) if (address.getOffset() != 0) candidates.add(address);
        if (candidates.isEmpty()) return null;
        if (candidates.size() != 1)
            throw new UnsupportedOperationException("Ambiguous NativeAOT directory candidates: " + candidates);
        Address address = candidates.iterator().next();
        var memory = program.getMemory();
        byte[] header = new byte[16];
        if (memory.getBytes(address, header) != header.length)
            throw new IllegalArgumentException("Incomplete NativeAOT header at " + address);
        int count = Short.toUnsignedInt(memory.getShort(address.add(12)));
        if (count < 1 || count > 80 || Byte.toUnsignedInt(header[14]) != 24 || header[15] != 1)
            throw new UnsupportedOperationException("Unsupported NativeAOT row layout at " + address +
                ": sections=" + count + ", entry_size=" + Byte.toUnsignedInt(header[14]) + ", entry_type=" + Byte.toUnsignedInt(header[15]));
        byte[] rows = new byte[count * 24];
        if (memory.getBytes(address.add(16), rows) != rows.length)
            throw new IllegalArgumentException("Incomplete NativeAOT directory rows at " + address);
        ReadyToRunDirectory directory = ReadyToRunDirectory.readAtAddress(program, address);
        if (directory.getMajorVersion() != 9 || directory.getMinorVersion() != 1)
            throw new UnsupportedOperationException("Unsupported NativeAOT RTR format " +
                directory.getMajorVersion() + "." + directory.getMinorVersion() + " at " + address + "; verified format is 9.1 (.NET 8.0.22 Linux x64 fixture).");
        var types = new LinkedHashSet<Integer>();
        for (ReadyToRunSection section : directory.getSections()) {
            monitor.checkCancelled();
            if (!types.add(section.getType())) throw new IllegalArgumentException("Duplicate NativeAOT section " + section.getType() + " at " + address);
            // ModuleInfoRow flags bit 0 declares an end pointer. ThreadStaticIndex
            // (204) is a single-address entry with flags=0 and an absent end.
            if (section.getFlags() != 0 && section.getFlags() != 1)
                throw new UnsupportedOperationException("Unsupported NativeAOT section flags " + section.getFlags() + " for section " + section.getType());
            boolean hasEnd = section.getFlags() == 1;
            if (!hasEnd && section.getEnd() != 0)
                throw new IllegalArgumentException("NativeAOT single-address section " + section.getType() + " reports an unexpected end");
            if (hasEnd && Long.compareUnsigned(section.getStart(), section.getEnd()) > 0)
                throw new IllegalArgumentException("Reversed NativeAOT section " + section.getType() + " at " + address);
            if (section.getStart() != 0 && (!hasEnd || section.getStart() != section.getEnd()) &&
                (!memory.contains(address.getNewAddress(section.getStart())) ||
                 (hasEnd && !memory.contains(address.getNewAddress(section.getEnd() - 1)))))
                throw new IllegalArgumentException("Unmapped NativeAOT section " + section.getType() + " at " + address);
        }
        if (directory.getSectionByType(ReadyToRunSection.DEHYDRATED_DATA) == null)
            throw new UnsupportedOperationException("NativeAOT directory at " + address + " has no DEHYDRATED_DATA; non-dehydrated layouts are not verified.");
        for (int type : new int[] { ReadyToRunSection.DEHYDRATED_DATA, ReadyToRunSection.FROZEN_OBJECT_REGION }) {
            ReadyToRunSection section = directory.getSectionByType(type);
            if (section != null && section.getFlags() != 1)
                throw new IllegalArgumentException("NativeAOT section " + type + " requires an end pointer");
        }
        return new Located(address, directory, discovery);
    }
}
