package rea.extensions.nativeaot;

import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import ghidra.program.model.data.DataType;
import ghidra.program.model.listing.Program;
import ghidra.util.task.TaskMonitor;
import nativeaot.objectmodel.MethodTable;
import nativeaot.objectmodel.MethodTableManager;

/** Translate a selected recovered type into provider-neutral metadata evidence. */
final class NativeAotTypeMetadata {
    static JsonObject describe(Program program, MethodTableManager manager, NativeAotDirectory.Located located,
        DataType type, JsonObject report, JsonObject derivedRange, TaskMonitor monitor) throws Exception {
        for (MethodTable table : manager.getMethodTables()) {
            monitor.checkCancelled();
            boolean sameType = type.getPathName().equals(table.getMTType().getPathName()) ||
                (table.getInstanceType() != null && type.getPathName().equals(table.getInstanceType().getPathName()));
            if (!sameType) continue;
            JsonObject result = new JsonObject();
            result.addProperty("format", "dotnet-nativeaot");
            result.addProperty("status", report.get("status").getAsString());
            result.addProperty("header_address", NativeAotExtension.address(located.address()));
            result.addProperty("format_major", located.directory().getMajorVersion());
            result.addProperty("format_minor", located.directory().getMinorVersion());
            result.addProperty("method_table_address", NativeAotExtension.address(table.getAddress()));
            result.addProperty("name_origin", table == manager.getObjectMT() || table == manager.getStringMT() ? "inferred" : "generated");
            result.add("original_name", JsonNull.INSTANCE);
            result.addProperty("base_size_bytes", table.getBaseSize());
            result.add("related_type", identity(manager, table.getRelatedTypeAddress()));
            JsonArray interfaces = new JsonArray();
            for (long value : table.getInterfaceAddresses()) if (value != 0) interfaces.add(identity(manager, value));
            result.add("interfaces", interfaces);
            JsonArray slots = new JsonArray();
            for (int slot = 0; slot < table.getVTableSlotCount(); slot++) {
                monitor.checkCancelled();
                long value = table.getVTableSlot(slot);
                JsonObject target = new JsonObject();
                target.addProperty("slot", slot);
                target.addProperty("slot_address", NativeAotExtension.address(table.getAddress().add(24 + slot * 8L)));
                target.add("target_address", value == 0 ? JsonNull.INSTANCE : new com.google.gson.JsonPrimitive("0x" + Long.toUnsignedString(value, 16)));
                var function = value == 0 ? null : program.getFunctionManager().getFunctionAt(table.getAddress().getNewAddress(value));
                target.add("procedure_name", function == null ? JsonNull.INSTANCE : new com.google.gson.JsonPrimitive(function.getName(true)));
                target.addProperty("basis", "method-table-pointer");
                slots.add(target);
            }
            result.add("virtual_slots", slots);
            result.add("derived_memory", derivedRange.deepCopy());
            result.add("diagnostics", report.get("diagnostics").deepCopy());
            JsonArray limitations = new JsonArray();
            limitations.add("Type identities and relationships are recovered by upstream heuristics. Original source names and custom field layouts are not recovered.");
            limitations.add("Method prototypes are inferred, not original signatures. REA preserves pre-recovery calling conventions and the loaded compiler default for new functions.");
            limitations.add("Rehydrated metadata bytes are derived analysis-memory content; their original file offsets and runtime behavior remain unknown.");
            limitations.add("Verified workflow: .NET 8.0.22 NativeAOT RTR 9.1, Linux x64 ELF / Windows x64 PE on Linux; other runtime layouts and hosts are unverified.");
            result.add("limitations", limitations);
            return result;
        }
        return null;
    }

    private static com.google.gson.JsonElement identity(MethodTableManager manager, long value) throws Exception {
        if (value == 0) return JsonNull.INSTANCE;
        JsonObject result = new JsonObject();
        result.addProperty("address", "0x" + Long.toUnsignedString(value, 16));
        MethodTable table = manager.getMethodTable(value);
        result.add("type", table == null ? JsonNull.INSTANCE : new com.google.gson.JsonPrimitive(table.getMTType().getPathName()));
        return result;
    }
}
