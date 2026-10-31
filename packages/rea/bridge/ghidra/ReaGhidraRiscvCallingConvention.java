import ghidra.app.script.GhidraScript;
import ghidra.program.database.SpecExtension;
import ghidra.program.model.data.DataType;
import ghidra.program.model.data.DoubleDataType;
import ghidra.program.model.data.Float16DataType;
import ghidra.program.model.data.FloatDataType;
import ghidra.program.model.data.FunctionDefinition;
import ghidra.program.model.data.IntegerDataType;
import ghidra.program.model.data.StructureDataType;
import ghidra.program.model.lang.CompilerSpec;
import ghidra.program.model.lang.Language;
import ghidra.program.model.lang.PrototypeModel;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Parameter;
import ghidra.program.model.listing.Program;
import ghidra.program.model.listing.VariableStorage;
import ghidra.program.model.pcode.Varnode;
import ghidra.program.model.pcode.XmlEncode;
import java.io.StringReader;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.regex.Pattern;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.transform.OutputKeys;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/**
 * Apply the committed RISC-V calling-convention policy after analysis. Ghidra's generic RV32
 * compiler specification models ilp32d. Each policy derives a program-specific prototype from the
 * program's own default prototype, as its {@link Policy} row and docs/ghidra-riscv.md state. The
 * script installs the prototype as a specification extension and assigns it, with dynamic
 * storage, to every non-thunk function, external function and function definition.
 */
public final class ReaGhidraRiscvCallingConvention extends GhidraScript {
  static final String REPORT_KEY = "REA RISC-V calling convention";
  /** RISC-V floating-point registers by ABI name: ft0-ft11, fs0-fs11 and fa0-fa7. */
  private static final Pattern FLOAT_REGISTER = Pattern.compile("f[ast]\\d+");

  /**
   * What a policy changes in the default ilp32d prototype. Every policy also passes values of 9
   * bytes or more, such as {@code long double}, by reference.
   *
   * @param floatEntryBytes the largest value a floating-point register may pass or return; 0
   *     removes those entries and every rule that assigns floating-point storage
   * @param preservesFloatRegisters whether fs0-fs11 stay preserved across calls
   */
  private record Policy(
      String id, String prototype, int floatEntryBytes, boolean preservesFloatRegisters) {}

  private static final List<Policy> POLICIES =
      List.of(new Policy("ilp32-prototype-v1", "__rea_ilp32", 0, false));

  @Override
  public void run() throws Exception {
    String[] arguments = getScriptArgs();
    Policy policy =
        POLICIES.stream()
            .filter(candidate -> arguments.length == 1 && candidate.id().equals(arguments[0]))
            .findFirst()
            .orElseThrow(
                () ->
                    new IllegalArgumentException(
                        "REA RISC-V calling convention requires one of the policies "
                            + POLICIES.stream().map(Policy::id).toList()));
    Language language = currentProgram.getLanguage();
    if (!language.getProcessor().toString().equals("RISCV")
        || currentProgram.getDefaultPointerSize() != 4)
      throw new IllegalStateException(
          "REA " + policy.id() + " requires a 32-bit RISC-V program, not "
              + language.getLanguageID());
    CompilerSpec spec = currentProgram.getCompilerSpec();
    new SpecExtension(currentProgram)
        .addReplaceCompilerSpecExtension(
            derive(spec.getDefaultCallingConvention(), spec, language, policy), monitor);
    PrototypeModel model =
        currentProgram.getCompilerSpec().getCallingConvention(policy.prototype());
    if (model == null)
      throw new IllegalStateException("REA " + policy.prototype() + " was not installed");
    selfCheck(model, policy, language);
    int functions = 0;
    List<Function> callables = new ArrayList<>();
    currentProgram.getFunctionManager().getFunctions(true).forEach(callables::add);
    currentProgram.getFunctionManager().getExternalFunctions().forEach(callables::add);
    for (Function function : callables) {
      // A thunk's signature is its target's; the target is in this list.
      if (function.isThunk()) continue;
      if (function.hasCustomVariableStorage()) function.setCustomVariableStorage(false);
      function.setCallingConvention(policy.prototype());
      if (policy.floatEntryBytes() == 0) {
        List<VariableStorage> storage = new ArrayList<>();
        storage.add(function.getReturn().getVariableStorage());
        for (Parameter parameter : function.getParameters())
          storage.add(parameter.getVariableStorage());
        // An untyped function has no assigned storage yet; the decompiler applies the
        // prototype when it recovers one.
        requireIntegerStorage(
            storage.toArray(VariableStorage[]::new), function.getName(true), true);
      }
      functions += 1;
    }
    int definitions = 0;
    Iterator<DataType> types = currentProgram.getDataTypeManager().getAllDataTypes();
    while (types.hasNext()) {
      if (!(types.next() instanceof FunctionDefinition definition)) continue;
      definition.setCallingConvention(policy.prototype());
      definitions += 1;
    }
    // Written last: any failure above leaves no report, and REA refuses the session.
    currentProgram.getOptions(Program.PROGRAM_INFO).setString(
        REPORT_KEY,
        "{\"policy\":\"" + policy.id() + "\",\"functions\":" + functions
            + ",\"definitions\":" + definitions + "}");
    println(
        "REA RISC-V " + policy.prototype() + ": functions=" + functions
            + " definitions=" + definitions);
  }

  /** The default ilp32d prototype changed as the policy states. */
  private static String derive(
      PrototypeModel base, CompilerSpec spec, Language language, Policy policy) throws Exception {
    XmlEncode encoder = new XmlEncode();
    base.encode(encoder, spec.getPcodeInjectLibrary());
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    Document document =
        factory.newDocumentBuilder().parse(new InputSource(new StringReader(encoder.toString())));
    Element root = document.getDocumentElement();
    if (!root.getTagName().equals("prototype"))
      throw new IllegalStateException("Unexpected default prototype encoding " + root.getTagName());
    root.setAttribute("name", policy.prototype());
    List<Element> floatEntries = new ArrayList<>();
    NodeList entries = root.getElementsByTagName("pentry");
    for (int index = 0; index < entries.getLength(); index += 1) {
      Element entry = (Element) entries.item(index);
      if (entry.getAttribute("storage").equals("float")) floatEntries.add(entry);
    }
    if (floatEntries.isEmpty())
      throw new IllegalStateException("Default prototype has no floating-point entries");
    if (policy.floatEntryBytes() == 0) {
      List<Node> removed = new ArrayList<>(floatEntries);
      NodeList rules = root.getElementsByTagName("rule");
      for (int index = 0; index < rules.getLength(); index += 1) {
        Element rule = (Element) rules.item(index);
        if (usesFloatStorage(rule)) removed.add(rule);
      }
      if (removed.size() == floatEntries.size())
        throw new IllegalStateException("Default prototype has no floating-point rules to remove");
      for (Node node : removed) node.getParentNode().removeChild(node);
    } else
      for (Element entry : floatEntries)
        entry.setAttribute("maxsize", Integer.toString(policy.floatEntryBytes()));
    // Values over 2 x XLEN go by reference. Returns need no rule: a value that the return
    // registers cannot hold already becomes a caller buffer passed in a0.
    NodeList inputs = root.getElementsByTagName("input");
    if (inputs.getLength() != 1)
      throw new IllegalStateException("Default prototype has no single input list");
    Element input = (Element) inputs.item(0);
    Element last = null;
    for (Node child = input.getFirstChild(); child != null; child = child.getNextSibling())
      if (child instanceof Element element && element.getTagName().equals("rule")) last = element;
    if (last == null || !joinsAnyValue(last))
      throw new IllegalStateException("Default prototype's input list does not end with a join");
    Element byReference = document.createElement("rule");
    Element datatype = document.createElement("datatype");
    datatype.setAttribute("name", "any");
    datatype.setAttribute("minsize", "9");
    byReference.appendChild(datatype);
    byReference.appendChild(document.createElement("convert_to_ptr"));
    input.insertBefore(byReference, last);
    if (!policy.preservesFloatRegisters()) {
      NodeList killedLists = root.getElementsByTagName("killedbycall");
      Element killed = killedLists.getLength() == 0 ? null : (Element) killedLists.item(0);
      if (killed == null) {
        killed = document.createElement("killedbycall");
        root.appendChild(killed);
      }
      List<Element> moved = new ArrayList<>();
      NodeList preservedLists = root.getElementsByTagName("unaffected");
      for (int list = 0; list < preservedLists.getLength(); list += 1) {
        NodeList preserved = preservedLists.item(list).getChildNodes();
        for (int index = 0; index < preserved.getLength(); index += 1) {
          if (preserved.item(index) instanceof Element varnode
              && isFloatRegister(varnode, language))
            moved.add(varnode);
        }
      }
      for (Element varnode : moved) {
        varnode.getParentNode().removeChild(varnode);
        killed.appendChild(varnode);
      }
    }
    StringWriter xml = new StringWriter();
    var transformer = TransformerFactory.newInstance().newTransformer();
    transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "yes");
    transformer.transform(new DOMSource(document), new StreamResult(xml));
    return xml.toString();
  }

  /** The installed prototype places each class of value as its policy states. */
  private void selfCheck(PrototypeModel model, Policy policy, Language language) {
    StructureDataType pair = new StructureDataType("rea_float_pair", 0);
    pair.add(FloatDataType.dataType);
    pair.add(FloatDataType.dataType);
    VariableStorage[] storage =
        model.getStorageLocations(
            currentProgram,
            new DataType[] {
              DoubleDataType.dataType, FloatDataType.dataType, DoubleDataType.dataType,
              IntegerDataType.dataType, pair, Float16DataType.dataType
            },
            false);
    VariableStorage quad = storage[storage.length - 1];
    if (quad.size() != currentProgram.getDefaultPointerSize() || quad.getRegister() == null)
      throw new IllegalStateException(
          "REA " + policy.prototype() + " does not pass a 16-byte value by reference: " + quad);
    if (policy.floatEntryBytes() == 0)
      requireIntegerStorage(storage, policy.prototype() + " self-check", false);
    if (policy.preservesFloatRegisters()) return;
    for (Varnode preserved : model.getUnaffectedList()) {
      Register register = language.getRegister(preserved.getAddress(), preserved.getSize());
      if (register != null && FLOAT_REGISTER.matcher(register.getName()).matches())
        throw new IllegalStateException(
            "REA " + policy.prototype() + " still preserves " + register.getName());
    }
  }

  private static boolean joinsAnyValue(Element rule) {
    List<Element> children = new ArrayList<>();
    for (Node child = rule.getFirstChild(); child != null; child = child.getNextSibling())
      if (child instanceof Element element) children.add(element);
    return children.size() == 2
        && children.get(0).getTagName().equals("datatype")
        && children.get(0).getAttribute("name").equals("any")
        && children.get(1).getTagName().equals("join");
  }

  /** Whether a rule's action, at any depth, assigns floating-point storage. */
  private static boolean usesFloatStorage(Element element) {
    NodeList children = element.getChildNodes();
    for (int index = 0; index < children.getLength(); index += 1) {
      if (!(children.item(index) instanceof Element child)) continue;
      if (child.getAttribute("storage").equals("float") || usesFloatStorage(child)) return true;
    }
    return false;
  }

  private static boolean isFloatRegister(Element varnode, Language language) {
    if (!varnode.getTagName().equals("varnode")
        || !varnode.getAttribute("space").equals("register"))
      return false;
    Register register =
        language.getRegister(
            language.getAddressFactory().getRegisterSpace()
                .getAddress(Long.decode(varnode.getAttribute("offset"))),
            Integer.parseInt(varnode.getAttribute("size")));
    return register != null && FLOAT_REGISTER.matcher(register.getName()).matches();
  }

  private static void requireIntegerStorage(
      VariableStorage[] storage, String owner, boolean allowUnassigned) {
    for (VariableStorage item : storage) {
      if (item.isBadStorage() || (!allowUnassigned && item.isUnassignedStorage()))
        throw new IllegalStateException("REA RISC-V storage unresolved for " + owner);
      List<Register> registers = item.getRegisters();
      if (registers == null) continue; // stack-only storage
      for (Register register : registers) {
        if (FLOAT_REGISTER.matcher(register.getName()).matches())
          throw new IllegalStateException(
              "REA RISC-V storage still uses " + register.getName() + " for " + owner);
      }
    }
  }
}
