import ghidra.app.script.GhidraScript;
import ghidra.program.database.SpecExtension;
import ghidra.program.model.data.AbstractFloatDataType;
import ghidra.program.model.data.DataType;
import ghidra.program.model.data.DoubleDataType;
import ghidra.program.model.data.FloatDataType;
import ghidra.program.model.data.FunctionDefinition;
import ghidra.program.model.data.IntegerDataType;
import ghidra.program.model.data.ParameterDefinition;
import ghidra.program.model.data.TypeDef;
import ghidra.program.model.lang.CompilerSpec;
import ghidra.program.model.lang.PrototypeModel;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Parameter;
import ghidra.program.model.listing.Program;
import ghidra.program.model.listing.VariableStorage;
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
 * Soft-float o32 passes and returns float/double values exactly where same-size integers go.
 * Ghidra's MIPS32 compiler specifications model only hard-float o32, so every typed float
 * prototype (functions, externals, thunks via their targets, and function-pointer definitions)
 * would otherwise read $f12/$f14/$f0. Derive a program-specific prototype model from the
 * program's own default o32 model with its floating-point entries and rules removed, install it
 * as a specification extension, and assign it to every callable whose formal types use floats.
 */
public final class ReaGhidraMipsSoftFloat extends GhidraScript {
  static final String REPORT_KEY = "REA MIPS soft-float storage";
  static final String POLICY = "o32-soft-float-prototype-v1";
  static final String PROTOTYPE = "__rea_soft_float";
  private static final Pattern FPU_REGISTER = Pattern.compile("f\\d+(_\\d+)?");

  @Override
  public void run() throws Exception {
    String processor = currentProgram.getLanguage().getProcessor().toString();
    if (!processor.equals("MIPS") || currentProgram.getDefaultPointerSize() != 4)
      throw new IllegalStateException(
          "REA soft-float storage requires a 32-bit MIPS program, not " + processor);
    CompilerSpec spec = currentProgram.getCompilerSpec();
    PrototypeModel base = spec.getDefaultCallingConvention();
    new SpecExtension(currentProgram)
        .addReplaceCompilerSpecExtension(softFloatPrototype(base, spec), monitor);
    PrototypeModel soft = currentProgram.getCompilerSpec().getCallingConvention(PROTOTYPE);
    if (soft == null)
      throw new IllegalStateException("REA soft-float prototype was not installed");
    requireIntegerStorage(
        soft.getStorageLocations(
            currentProgram,
            new DataType[] {
              FloatDataType.dataType, IntegerDataType.dataType, DoubleDataType.dataType,
              FloatDataType.dataType, DoubleDataType.dataType
            },
            false),
        "soft-float prototype self-check");
    int functions = 0;
    List<Function> callables = new ArrayList<>();
    currentProgram.getFunctionManager().getFunctions(true).forEach(callables::add);
    currentProgram.getFunctionManager().getExternalFunctions().forEach(callables::add);
    for (Function function : callables) {
      // A thunk's signature is its target's; the target is in this list.
      if (function.isThunk() || !usesFloat(function)) continue;
      if (function.hasCustomVariableStorage()) function.setCustomVariableStorage(false);
      function.setCallingConvention(PROTOTYPE);
      List<VariableStorage> storage = new ArrayList<>();
      storage.add(function.getReturn().getVariableStorage());
      for (Parameter parameter : function.getParameters()) storage.add(parameter.getVariableStorage());
      requireIntegerStorage(storage.toArray(VariableStorage[]::new), function.getName(true));
      functions += 1;
    }
    int definitions = 0;
    Iterator<DataType> types = currentProgram.getDataTypeManager().getAllDataTypes();
    while (types.hasNext()) {
      if (!(types.next() instanceof FunctionDefinition definition) || !usesFloat(definition))
        continue;
      definition.setCallingConvention(PROTOTYPE);
      definitions += 1;
    }
    // Written last: any failure above leaves no report, and REA refuses the session.
    currentProgram.getOptions(Program.PROGRAM_INFO).setString(
        REPORT_KEY,
        "{\"policy\":\"" + POLICY + "\",\"functions\":" + functions +
            ",\"definitions\":" + definitions + "}");
    println("REA MIPS soft-float prototype: functions=" + functions + " definitions=" + definitions);
  }

  /** The default o32 model without floating-point registers or float-consuming rules. */
  private static String softFloatPrototype(PrototypeModel base, CompilerSpec spec) throws Exception {
    XmlEncode encoder = new XmlEncode();
    base.encode(encoder, spec.getPcodeInjectLibrary());
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    Document document =
        factory.newDocumentBuilder().parse(new InputSource(new StringReader(encoder.toString())));
    Element root = document.getDocumentElement();
    if (!root.getTagName().equals("prototype"))
      throw new IllegalStateException("Unexpected default prototype encoding " + root.getTagName());
    root.setAttribute("name", PROTOTYPE);
    List<Node> removed = new ArrayList<>();
    collect(root.getElementsByTagName("pentry"), "metatype", "float", null, removed);
    collect(root.getElementsByTagName("consume"), "storage", "float", "rule", removed);
    if (removed.isEmpty())
      throw new IllegalStateException("Default prototype has no floating-point entries to remove");
    for (Node node : removed) node.getParentNode().removeChild(node);
    StringWriter xml = new StringWriter();
    var transformer = TransformerFactory.newInstance().newTransformer();
    transformer.setOutputProperty(OutputKeys.OMIT_XML_DECLARATION, "yes");
    transformer.transform(new DOMSource(document), new StreamResult(xml));
    return xml.toString();
  }

  /** Select matching elements, or their nearest `ancestor` element when one is named. */
  private static void collect(
      NodeList nodes, String attribute, String value, String ancestor, List<Node> selected) {
    for (int index = 0; index < nodes.getLength(); index += 1) {
      Element element = (Element) nodes.item(index);
      if (!value.equals(element.getAttribute(attribute))) continue;
      Node target = element;
      while (ancestor != null && target != null && !ancestor.equals(target.getNodeName()))
        target = target.getParentNode();
      if (target != null && !selected.contains(target)) selected.add(target);
    }
  }

  private static void requireIntegerStorage(VariableStorage[] storage, String owner) {
    for (VariableStorage item : storage) {
      if (item.isBadStorage() || item.isUnassignedStorage())
        throw new IllegalStateException("REA soft-float storage unresolved for " + owner);
      List<Register> registers = item.getRegisters();
      if (registers == null) continue; // stack-only storage
      for (Register register : registers) {
        if (FPU_REGISTER.matcher(register.getName()).matches())
          throw new IllegalStateException(
              "REA soft-float storage still uses " + register.getName() + " for " + owner);
      }
    }
  }

  private static boolean usesFloat(Function function) {
    if (isFloat(function.getReturn().getFormalDataType())) return true;
    for (Parameter parameter : function.getParameters()) {
      if (isFloat(parameter.getFormalDataType())) return true;
    }
    return false;
  }

  private static boolean usesFloat(FunctionDefinition definition) {
    if (isFloat(definition.getReturnType())) return true;
    for (ParameterDefinition argument : definition.getArguments()) {
      if (isFloat(argument.getDataType())) return true;
    }
    return false;
  }

  private static boolean isFloat(DataType type) {
    DataType current = type;
    while (current instanceof TypeDef typeDef) current = typeDef.getBaseDataType();
    return current instanceof AbstractFloatDataType;
  }
}
