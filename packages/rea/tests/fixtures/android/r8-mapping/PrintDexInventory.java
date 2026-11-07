import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedDexFile;
import com.android.tools.smali.dexlib2.iface.ClassDef;
import com.google.gson.Gson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/** Independent DEX inventory: no REA mapping parser, bridge or JADX display identities. */
public final class PrintDexInventory {
  public static void main(String[] arguments) throws Exception {
    if (arguments.length != 1) throw new IllegalArgumentException("Expected one raw .dex path");
    Path path = Path.of(arguments[0]);
    long bytes = Files.size(path);
    if (bytes > 16L * 1024 * 1024)
      throw new IllegalArgumentException("This small-fixture oracle admits at most 16 MiB of DEX");
    var dex = new DexBackedDexFile(Opcodes.getDefault(), Files.readAllBytes(path));
    List<ClassDef> classes = new ArrayList<>(dex.getClasses());
    classes.sort(Comparator.comparing(ClassDef::getType));
    List<Map<String, Object>> inventory = new ArrayList<>();
    for (ClassDef cls : classes) {
      List<Map<String, String>> fields = new ArrayList<>();
      for (var field : cls.getFields())
        fields.add(Map.of("raw_name", field.getName(), "dex_type", field.getType()));
      fields.sort(Comparator.comparing((Map<String, String> field) -> field.get("raw_name"))
          .thenComparing(field -> field.get("dex_type")));
      List<Map<String, String>> methods = new ArrayList<>();
      for (var method : cls.getMethods()) {
        String descriptor = "(" + method.getParameterTypes().stream()
            .map(CharSequence::toString).collect(Collectors.joining()) + ")" + method.getReturnType();
        methods.add(Map.of("raw_name", method.getName(), "dex_descriptor", descriptor));
      }
      methods.sort(Comparator.comparing((Map<String, String> method) -> method.get("raw_name"))
          .thenComparing(method -> method.get("dex_descriptor")));
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("raw_type", cls.getType());
      row.put("fields", fields);
      row.put("methods", methods);
      inventory.add(row);
    }
    System.out.println(new Gson().toJson(inventory));
  }
}
