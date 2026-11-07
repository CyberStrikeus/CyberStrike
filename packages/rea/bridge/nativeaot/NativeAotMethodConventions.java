package rea.extensions.nativeaot;

import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Program;
import ghidra.util.task.TaskMonitor;
import nativeaot.objectmodel.MethodTableManager;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;

/** Keep upstream's unconditional __thiscall assignment out of x64 ABI evidence. */
final class NativeAotMethodConventions {
    static Map<Address, String> capture(Program program, TaskMonitor monitor) throws Exception {
        Map<Address, String> result = new HashMap<>();
        var functions = program.getFunctionManager().getFunctions(true);
        while (functions.hasNext()) {
            monitor.checkCancelled();
            var function = functions.next();
            result.put(function.getEntryPoint(), function.getCallingConventionName());
        }
        return result;
    }

    static void restore(Program program, MethodTableManager manager, Map<Address, String> previous, TaskMonitor monitor) throws Exception {
        var visited = new HashSet<Address>();
        String defaultConvention = program.getCompilerSpec().getDefaultCallingConvention().getName();
        for (var table : manager.getMethodTables()) for (long target : table.getVTable()) {
            monitor.checkCancelled();
            Address address = table.getAddress().getNewAddress(target);
            if (!visited.add(address)) continue;
            var function = program.getFunctionManager().getFunctionAt(address);
            if (function == null) continue;
            String convention = previous.containsKey(address) ? previous.get(address) : defaultConvention;
            if (!java.util.Objects.equals(function.getCallingConventionName(), convention))
                function.setCallingConvention(convention);
        }
    }
}
