import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.FlowType;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.pcode.PcodeOp;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

/**
 * Undo wrong no-return flags from auto-analysis. A function flagged no-return that contains a
 * real RET is an ordinary function (stream readers, cxa_guard_acquire, ...). Known returning
 * libc/TLS imports have no body to inspect, so clear their flags by exact external ABI name.
 * Callers treated the call as a terminator and the decompiler truncated them. Clear the flag, then re-disassemble only
 * the call sites of the functions that were cleared and refit their owning functions in place.
 */
public final class ReaGhidraNoReturnFix extends GhidraScript {
  private static final Set<String> RETURNING_IMPORTS = Set.of(
      "malloc", "__tls_get_addr", "memcpy", "memset", "strlen", "__errno_location");

  @Override
  public void run() throws Exception {
    // Windows P0 does not admit analysis-database mutation.
    if (System.getProperty("os.name", "").startsWith("Windows")) return;
    FunctionManager fm = currentProgram.getFunctionManager();
    Listing li = currentProgram.getListing();
    Set<Address> cleared = new HashSet<>();
    Deque<Address> pending = new ArrayDeque<>();
    for (Function f : fm.getExternalFunctions()) {
      monitor.checkCancelled();
      // Do not apply import-name assumptions to local functions or to arbitrary externals.
      if (!f.hasNoReturn() || !RETURNING_IMPORTS.contains(externalAbiName(f))) continue;
      f.setNoReturn(false);
      enqueueReturning(f, cleared, pending);
    }
    for (Function f : fm.getFunctions(true)) {
      monitor.checkCancelled();
      if (clearDecodedReturn(f, li)) {
        enqueueReturning(f, cleared, pending);
      }
    }
    int redone = 0;
    TreeSet<Address> owners = new TreeSet<>();
    while (!pending.isEmpty()) {
      Address target = pending.removeFirst();
      TreeSet<Address> sites = new TreeSet<>();
      // References include computed import calls after Ghidra resolves their destination.
      // Collect before redisassembly mutates the reference table.
      for (Reference reference : currentProgram.getReferenceManager().getReferencesTo(target)) {
        monitor.checkCancelled();
        sites.add(reference.getFromAddress());
      }
      for (Address s : sites) {
        monitor.checkCancelled();
        Instruction ins = li.getInstructionAt(s);
        if (ins == null) continue;
        FlowType ft = ins.getFlowType();
        if (!(ft.isCall() && ft.isTerminal())) continue;
        Address[] flows = ins.getFlows();
        boolean callsTarget = false;
        for (Address flow : flows) {
          if (flow.equals(target)) callsTarget = true;
        }
        if (!callsTarget) continue;
        // Do not redisassemble into an independently identified function.
        Address next = ins.getMaxAddress().add(1);
        if (fm.getFunctionAt(next) != null || !currentProgram.getMemory().contains(next)) continue;
        Function owner = fm.getFunctionContaining(s);
        if (owner != null && !owner.isThunk()) owners.add(owner.getEntryPoint());
        clearListing(ins.getMinAddress(), ins.getMaxAddress());
        disassemble(s);
        redone++;
        // Refit the body in place so the name, signature and calling convention survive.
        if (owner != null && !owner.isThunk()) {
          CreateFunctionCmd.fixupFunctionBody(currentProgram, owner, monitor);
          // Auto-analysis may have propagated the false flag to this truncated caller.
          // Its RET becomes visible only now; repair its callers in the same pass.
          if (clearDecodedReturn(owner, li)) enqueueReturning(owner, cleared, pending);
        }
      }
    }
    // No analyzeChanges here: on libpl2.so it adds about 70 s, which pushes startup past the 330 s deadline.
    println(
        "REA no-return fix: cleared=" + cleared.size() + " sites=" + redone + " refit=" + owners.size());
  }

  private void enqueueReturning(Function function, Set<Address> cleared, Deque<Address> pending) {
    if (cleared.add(function.getEntryPoint())) pending.addLast(function.getEntryPoint());
    // A thunk inherits the flag of the function it forwards to, including through other thunks.
    Address[] thunks = function.getFunctionThunkAddresses(true);
    if (thunks == null) return;
    for (Address thunk : thunks) {
      if (cleared.add(thunk)) pending.addLast(thunk);
    }
  }

  private String externalAbiName(Function function) {
    String name = function.getName();
    // Mach-O stores C-linkage symbols with one object-format underscore prefix.
    if (currentProgram.getExecutableFormat().contains("Mach-O") && name.startsWith("_"))
      return name.substring(1);
    return name;
  }

  private boolean clearDecodedReturn(Function function, Listing listing) throws Exception {
    if (!function.hasNoReturn() || function.isThunk()) return false;
    for (Instruction instruction : listing.getInstructions(function.getBody(), true)) {
      monitor.checkCancelled();
      FlowType flow = instruction.getFlowType();
      if (flow.isJump() || flow.isCall()) continue;
      for (PcodeOp operation : instruction.getPcode()) {
        if (operation.getOpcode() != PcodeOp.RETURN) continue;
        function.setNoReturn(false);
        return true;
      }
    }
    return false;
  }
}
