package rea.extensions.nativeaot;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import ghidra.app.util.importer.MessageLog;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.data.DataType;
import ghidra.program.model.listing.Program;
import ghidra.util.exception.CancelledException;
import ghidra.util.task.TaskMonitor;
import nativeaot.objectmodel.FrozenObjectAnnotator;
import nativeaot.objectmodel.MethodTableCrawler;
import nativeaot.objectmodel.MethodTableManager;
import nativeaot.rehydration.MetadataRehydratorNet80;
import nativeaot.rtr.ReadyToRunSection;
import java.util.ArrayList;
import java.util.List;
import java.security.MessageDigest;

/** Optional headless facade over the unchanged upstream analysis primitives. */
public final class NativeAotExtension {
    private MethodTableManager manager;
    private NativeAotDirectory.Located located;
    private JsonObject report;
    private final List<String> diagnostics = new ArrayList<>();
    private JsonObject derivedRange;

    public JsonObject analyze(Program program, TaskMonitor monitor) throws Exception {
        report = new JsonObject();
        report.addProperty("id", "nativeaot");
        report.addProperty("integration_api", 1);
        report.addProperty("source_revision", "effeb734fc570c32650f88b159608979dc7b423e");
        report.addProperty("source_revision_authority", "build-reported-unattested");
        report.addProperty("status", "not_applicable");
        report.addProperty("reason", "No NativeAOT directory with the supported row layout was found.");
        report.addProperty("method_tables", 0);
        if (!program.getLanguageID().getIdAsString().startsWith("x86:LE:64"))
            return failure("unsupported", "NativeAOT adapter supports x86-64 only.");
        MessageLog log = new MessageLog();
        int transaction = program.startTransaction("REA NativeAOT metadata recovery");
        boolean commit = false;
        String stage = "directory-discovery";
        try {
            located = NativeAotDirectory.locate(program, monitor, log);
            if (located == null) return finish(log);
            report.addProperty("header_address", address(located.address()));
            report.addProperty("discovery", located.discovery());
            report.addProperty("format_major", located.directory().getMajorVersion());
            report.addProperty("format_minor", located.directory().getMinorVersion());
            stage = "metadata-rehydration";
            var section = located.directory().getSectionByType(ReadyToRunSection.DEHYDRATED_DATA);
            Address start = located.address().getNewAddress(section.getStart());
            Address end = located.address().getNewAddress(section.getEnd());
            if (start.compareTo(end) >= 0) throw new IllegalArgumentException("Empty dehydrated section at " + start);
            var scan = new MetadataRehydratorNet80().rehydrate(program, new AddressSet(start, end).getFirstRange(), monitor, log);
            // Upstream reports an inclusive end at base + written length.
            long writtenLength = scan.getScanningRange().getLength() - 1;
            derivedRange = new JsonObject();
            derivedRange.addProperty("address", address(scan.getScanningRange().getMinAddress()));
            derivedRange.addProperty("size_bytes", writtenLength);
            derivedRange.addProperty("sha256", hashMemory(program, scan.getScanningRange().getMinAddress(), writtenLength, monitor));
            derivedRange.add("file_offset", JsonNull.INSTANCE);
            stage = "method-table-recovery";
            manager = MethodTableManager.createForDirectory(program, located.directory());
            var conventions = NativeAotMethodConventions.capture(program, monitor);
            new MethodTableCrawler(manager, program, scan).analyze(monitor, log);
            stage = "calling-convention-preservation";
            NativeAotMethodConventions.restore(program, manager, conventions, monitor);
            log.appendMsg("REA", "Preserved pre-recovery calling conventions; new functions use the loaded compiler specification default. Original method signatures remain unknown.");
            if (manager.getObjectMT() == null || manager.getMethodTableCount() == 0)
                throw new UnsupportedOperationException("No unambiguous System.Object method table was recovered at header " + located.address());
            stage = "frozen-object-annotation";
            if (manager.getStringMT() == null || scan.getPointerLocations().length == 0) {
                diagnostics.add("Frozen-object annotation unavailable: System.String table or pointer locations were not recovered.");
            } else {
                new FrozenObjectAnnotator(program, manager).analyze(located.directory(), scan.getPointerLocations(), monitor, log);
            }
            monitor.checkCancelled();
            report.addProperty("method_tables", manager.getMethodTableCount());
            JsonObject coverage = auditFrozenObjects(program, scan.getPointerLocations(), monitor);
            report.add("coverage", coverage);
            if (coverage.get("frozen_objects_annotated").getAsInt() != coverage.get("frozen_object_candidates").getAsInt())
                diagnostics.add("Some frozen-object candidates lack committed instance annotations; inspect coverage counts and Ghidra diagnostics.");
            report.addProperty("status", diagnostics.isEmpty() ? "complete" : "partial");
            report.add("reason", JsonNull.INSTANCE);
            report.add("derived_memory", derivedRange.deepCopy());
            JsonArray tables = new JsonArray();
            for (var mt : manager.getMethodTables()) {
                monitor.checkCancelled();
                JsonObject identity = new JsonObject();
                identity.addProperty("address", address(mt.getAddress()));
                identity.addProperty("type", mt.getMTType().getPathName());
                tables.add(identity);
            }
            report.add("types", tables);
            commit = true;
            return finish(log);
        } catch (CancelledException ex) {
            manager = null;
            throw ex;
        } catch (Exception ex) {
            manager = null;
            diagnostics.add(stage + ": " + ex.getClass().getSimpleName() + ": " + ex.getMessage());
            report.addProperty("status", ex instanceof UnsupportedOperationException ? "unsupported" : "failed");
            report.addProperty("reason", stage + ": " + ex.getMessage());
            return finish(log);
        } finally {
            program.endTransaction(transaction, commit);
        }
    }

    /** Inline discovery for the existing loaded-image inspection. */
    public JsonObject inspectImage() {
        JsonObject summary = new JsonObject();
        summary.addProperty("format", "dotnet-nativeaot");
        for (String key : new String[] { "status", "reason", "header_address", "discovery", "format_major", "format_minor", "method_tables", "derived_memory", "coverage", "diagnostics" })
            summary.add(key, report.has(key) ? report.get(key).deepCopy() : JsonNull.INSTANCE);
        summary.add("types", report.has("types") ? report.get("types").deepCopy() : new JsonArray());
        JsonArray limitations = new JsonArray();
        limitations.add("Recovery covers the reported metadata candidates; it does not reconstruct original C# source, custom field layouts, every runtime object, or execution behavior.");
        limitations.add("Method prototypes and parameter names remain Ghidra inferences; verify them against instructions and call sites. Pre-recovery conventions are retained rather than universally forcing __thiscall.");
        limitations.add("NativeAOT type identities and relationships are inferred; generated names are not original names. Derived memory has no original file offsets.");
        summary.add("limitations", limitations);
        return summary;
    }

    /** Read recovered relationships without restoring or mutating database state. */
    public JsonObject inspectDataType(Program program, DataType type, Address selected, TaskMonitor monitor) throws Exception {
        if (manager == null) return null;
        return NativeAotTypeMetadata.describe(program, manager, located, type, report, derivedRange, monitor);
    }

    private JsonObject auditFrozenObjects(Program program, Address[] pointerLocations, TaskMonitor monitor) throws Exception {
        JsonObject coverage = new JsonObject();
        int candidates = 0, annotated = 0;
        var section = located.directory().getSectionByType(ReadyToRunSection.FROZEN_OBJECT_REGION);
        if (section != null) for (Address location : section.getPointersInSection(pointerLocations)) {
            monitor.checkCancelled();
            var table = manager.getMethodTable(program.getMemory().getLong(location));
            if (table == null) continue;
            candidates++;
            var expected = table.getInstanceType();
            var actual = program.getListing().getDataAt(location);
            if (expected != null && actual != null && actual.getDataType().getPathName().equals(expected.getPathName())) annotated++;
        }
        coverage.addProperty("frozen_object_candidates", candidates);
        coverage.addProperty("frozen_objects_annotated", annotated);
        coverage.addProperty("basis", "rehydrated-pointer-candidates-and-committed-instance-types");
        return coverage;
    }

    private JsonObject finish(MessageLog log) {
        if (!log.toString().isBlank()) diagnostics.add(log.toString());
        JsonArray messages = new JsonArray();
        for (String message : diagnostics) messages.add(message);
        report.add("diagnostics", messages);
        return report;
    }

    private JsonObject failure(String status, String reason) {
        report.addProperty("status", status);
        report.addProperty("reason", reason);
        return finish(new MessageLog());
    }

    static String address(Address value) { return "0x" + Long.toUnsignedString(value.getOffset(), 16); }

    private static String hashMemory(Program program, Address start, long length, TaskMonitor monitor) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[65536];
        for (long offset = 0; offset < length;) {
            monitor.checkCancelled();
            int count = (int)Math.min(buffer.length, length - offset);
            if (program.getMemory().getBytes(start.add(offset), buffer, 0, count) != count)
                throw new IllegalStateException("Incomplete derived-memory read at " + start.add(offset));
            digest.update(buffer, 0, count);
            offset += count;
        }
        return java.util.HexFormat.of().formatHex(digest.digest());
    }
}
