import com.atxx.jhmcp.*;
import com.google.gson.*;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedDexFile;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedClassDef;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedMethod;
import io.modelcontextprotocol.kotlin.sdk.server.*;
import io.modelcontextprotocol.kotlin.sdk.types.*;
import jadx.api.*;
import jadx.api.plugins.input.data.annotations.EncodedValue;
import jadx.api.plugins.input.data.attributes.JadxAttrType;
import jadx.api.plugins.input.data.ICodeReader;
import jadx.api.plugins.input.data.IMethodRef;
import jadx.api.plugins.input.insns.InsnIndexType;
import jadx.api.plugins.input.insns.Opcode;
import jadx.core.codegen.TypeGen;
import jadx.core.dex.info.MethodInfo;
import jadx.core.dex.instructions.args.ArgType;
import jadx.core.dex.nodes.*;
import jadx.core.xmlgen.BinaryXMLParser;
import java.io.PrintStream;
import java.io.StringReader;
import java.io.InputStream;
import java.io.IOException;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.stream.Collectors;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import kotlin.Unit;
import kotlin.ResultKt;
import kotlin.coroutines.Continuation;
import kotlin.coroutines.CoroutineContext;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.coroutines.intrinsics.IntrinsicsKt;
import kotlinx.coroutines.BuildersKt;
import kotlinx.io.CoreKt;
import kotlinx.io.JvmCoreKt;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;

/** REA-owned metadata boundary for the unmodified jadx-headless-mcp 0.7.1 JAR. */
class ReaJadxBridge {
  private static final Gson JSON = new Gson();
  private final SessionHolder holder;
  private JadxSession indexedSession;
  private Map<String, List<ClassSnapshot>> classes = Map.of();
  private JadxSession manifestSession;
  private ManifestSnapshot manifestSnapshot;
  private ExternalInventory externalInventory;

  private record MethodSnapshot(String name, String rawName, String shortId, List<String> bodyAbsenceMarkers,
      Map<String, Object> summary) {}
  private record ClassSnapshot(JavaClass node, List<MethodSnapshot> methods, Map<String, Object> summary,
      Map<String, Object> summaryWithValues) {}
  private record ManifestSnapshot(String text, Map<String, Object> summary) {}
  private record ExternalMethod(MethodInfo info, Map<String, Object> summary) {}
  private record ExternalInventory(JadxSession session, String className, String methodName,
      List<ExternalMethod> methods) {}

  private static final class InputFailure extends IllegalArgumentException {
    final String field;
    InputFailure(String field, String message) { super(message); this.field = field; }
  }
  private static final class ReferenceLimit extends IllegalArgumentException {
    final String stage;
    ReferenceLimit(String stage) { super("External reference representation limit"); this.stage = stage; }
  }

  private ReaJadxBridge(SessionHolder holder) { this.holder = holder; }

  private static CallToolResult text(String value, boolean failed) {
    return new CallToolResult(List.of(new TextContent(value, null, null)), failed, null, null);
  }

  private static CallToolResult json(Object value) { return text(JSON.toJson(value), false); }

  /** Translate the typed load outcome before upstream drops its exception identity. */
  static Object loadResult(Object result) {
    try { ResultKt.throwOnFailure(result); }
    catch (Throwable failure) {
      if (failure instanceof java.util.concurrent.CancellationException
          || failure instanceof Error && !(failure instanceof OutOfMemoryError)) return result;
      if (failure instanceof OutOfMemoryError) {
        String reason = failure.getMessage();
        boolean heap = "Java heap space".equals(reason) || "GC overhead limit exceeded".equals(reason);
        Map<String, Object> reply = new LinkedHashMap<>();
        reply.put("kind", "jvm-memory-failure");
        reply.put("memory_area", heap ? "heap" : "unknown");
        reply.put("exception_type", "java.lang.OutOfMemoryError");
        if (reason != null) reply.put("message", reason);
        reply.put("max_heap_bytes", Runtime.getRuntime().maxMemory());
        return text(JSON.toJson(reply), true);
      }
      return text("load failed: " + failure.getMessage(), true);
    }
    SessionHolder.LoadResult loaded = (SessionHolder.LoadResult) result;
    Map<String, Object> reply = new LinkedHashMap<>();
    reply.put("state", "LOADED");
    reply.put("apk_path", loaded.getApkPath());
    reply.put("class_count", loaded.getClassCount());
    reply.put("raw_class_count", loaded.getRawClassCount());
    reply.put("resource_count", loaded.getResourceCount());
    reply.put("load_duration_ms", loaded.getLoadDurationMs());
    reply.put("decompile_timeout_ms", loaded.getDecompileTimeoutMs());
    reply.put("threads", loaded.getThreads());
    reply.put("code_cache_size", loaded.getCodeCacheSize());
    reply.put("resources", loaded.getResourceMode());
    if (!loaded.getIncludePackages().isEmpty()) reply.put("include_packages", loaded.getIncludePackages());
    if (!loaded.getExcludePackages().isEmpty()) reply.put("exclude_packages", loaded.getExcludePackages());
    return json(reply);
  }

  private Object load(kotlinx.serialization.json.JsonObject arguments, SessionConfig defaults,
      Continuation<? super CallToolResult> continuation) {
    JsonObject args = JsonParser.parseString(arguments.toString()).getAsJsonObject();
    String path = string(args, "path");
    SessionConfig options = defaults.withLoadOverrides(
        optionalString(args, "include_packages"), optionalString(args, "exclude_packages"),
        args.has("threads") ? integer(args, "threads", 1) : null,
        args.has("code_cache_size") ? integer(args, "code_cache_size", 64) : null,
        optionalString(args, "resources"));
    clearManifest();
    return loadCall(next -> holder.load(path, options, next), continuation);
  }

  static Object loadCall(kotlin.jvm.functions.Function1<Continuation<SessionHolder.LoadResult>, Object> load,
      Continuation<? super CallToolResult> continuation) {
    var forwarded = new java.util.concurrent.atomic.AtomicBoolean();
    Continuation<SessionHolder.LoadResult> resumed = new Continuation<>() {
      public CoroutineContext getContext() { return continuation.getContext(); }
      public void resumeWith(Object result) {
        if (!forwarded.compareAndSet(false, true)) throw new IllegalStateException("Load resumed twice");
        Object translated;
        try { translated = loadResult(result); }
        catch (Throwable failure) { translated = ResultKt.createFailure(failure); }
        // Keep the consumer outside the translation catch, including inline completion.
        continuation.resumeWith(translated);
      }
    };
    Object result;
    try { result = load.invoke(resumed); }
    catch (Throwable failure) {
      if (forwarded.get()) ResultKt.throwOnFailure(ResultKt.createFailure(failure));
      result = ResultKt.createFailure(failure);
    }
    if (result == IntrinsicsKt.getCOROUTINE_SUSPENDED()) return result;
    Object translated = loadResult(result);
    ResultKt.throwOnFailure(translated);
    return translated;
  }

  private static String optionalString(JsonObject args, String name) {
    return args.has(name) ? string(args, name) : null;
  }

  private static String string(JsonObject args, String name) {
    JsonElement value = args.get(name);
    if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString())
      throw new IllegalArgumentException(name + " must be a string");
    return value.getAsString();
  }

  private static boolean flag(JsonObject args, String name) {
    JsonElement value = args.get(name);
    if (value == null) return false;
    if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean())
      throw new IllegalArgumentException(name + " must be a boolean");
    return value.getAsBoolean();
  }

  private static int integer(JsonObject args, String name, int fallback) {
    JsonElement value = args.get(name);
    if (value == null) return fallback;
    if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber())
      throw new IllegalArgumentException(name + " must be a nonnegative integer");
    try {
      int result = value.getAsBigDecimal().intValueExact();
      if (result < 0) throw new ArithmeticException();
      return result;
    } catch (ArithmeticException error) {
      throw new IllegalArgumentException(name + " must be a nonnegative integer", error);
    }
  }

  private JadxSession session() {
    JadxSession current = holder.current();
    if (current == null) throw new IllegalArgumentException("No APK loaded");
    return current;
  }

  private void clearManifest() {
    manifestSession = null;
    manifestSnapshot = null;
    externalInventory = null;
  }

  // One bounded DEX at a time, beside the already admitted analysis JVM. The
  // response allowance accounts for worst-case JSON escaping before retention.
  private static final int NATIVE_DEX_BYTES = 64 * 1024 * 1024;
  private static final long NATIVE_TOTAL_DEX_BYTES = 256L * 1024 * 1024;
  // This JSON is escaped again inside an 8 MiB MCP frame.
  private static final long NATIVE_JSON_BYTES = 4L * 1024 * 1024;

  /** The bundled decoder allocates its declared UTF-16 length before validating bytes. */
  private static final class NativeDex extends DexBackedDexFile {
    private OptionalIndexedSection<String> boundedStrings;
    NativeDex(byte[] bytes) { super(Opcodes.getDefault(), bytes); }

    @Override public OptionalIndexedSection<String> getStringSection() {
      if (boundedStrings == null) {
        var source = super.getStringSection();
        boundedStrings = new OptionalIndexedSection<>() {
          @Override public int size() { return source.size(); }
          @Override public int getOffset(int index) { return source.getOffset(index); }
          @Override public String getOptional(int index) { return index == -1 ? null : get(index); }
          @Override public String get(int index) {
            int offset = getBuffer().readSmallUint(source.getOffset(index));
            int units = getDataBuffer().readerAt(offset).readSmallUleb128();
            if (units > NATIVE_JSON_BYTES / 6
                || units > getDataBuffer().getBuf().length - offset)
              throw new IllegalArgumentException("DEX string exceeds the native decoding allowance");
            return source.get(index);
          }
        };
      }
      return boundedStrings;
    }
  }

  private static void checkNativeInterrupted() {
    if (Thread.currentThread().isInterrupted())
      throw new java.util.concurrent.CancellationException("Native declaration inventory interrupted");
  }

  private static final class NativeInventory {
    final List<Map<String, Object>> methods = new ArrayList<>();
    final List<String> unknowns = new ArrayList<>();
    long retainedBytes = 1024;
    int dexEntries;
    int examinedDexEntries;
    int examinedClasses;
    int examinedMethods;
    boolean partial;
    boolean diagnosticLimit;

    void unknown(String reason) {
      partial = true;
      long bytes = 64L + reason.length() * 6L;
      if (unknowns.size() < 16 && retainedBytes + bytes <= NATIVE_JSON_BYTES - 4096) {
        unknowns.add(reason);
        retainedBytes += bytes;
      } else if (!diagnosticLimit) {
        diagnosticLimit = true;
        unknowns.add("Additional native-inventory limitations exceed the retained diagnostic allowance.");
      }
    }

    boolean retain(Map<String, Object> method, long bytes) {
      if (retainedBytes + bytes > NATIVE_JSON_BYTES - 4096) {
        unknown("Native declarations exceed the 4 MiB retained JSON allowance; remaining declarations are unknown.");
        return false;
      }
      retainedBytes += bytes;
      methods.add(method);
      return true;
    }

    Map<String, Object> result() {
      return Map.of("scope", "apk-root-dex-declarations", "methods", List.copyOf(methods),
          "coverage", Map.of("status", partial ? "partial" : "complete",
              "dex_entries", dexEntries, "examined_dex_entries", examinedDexEntries,
              "examined_classes", examinedClasses, "examined_methods", examinedMethods),
          "unknowns", List.copyOf(unknowns));
    }
  }

  /** Match Android's standard root multidex carriers, without a basename guess. */
  private static boolean nativeDexEntry(String name) {
    return name.equals("classes.dex") || name.matches("classes[0-9]+\\.dex");
  }

  private static byte[] readNativeDex(ZipFile archive, ZipEntry entry) throws IOException {
    long size = entry.getSize();
    if (size < 0 || size > NATIVE_DEX_BYTES)
      throw new IllegalArgumentException("DEX exceeds the 64 MiB single-member read allowance");
    byte[] bytes = new byte[(int) size];
    CRC32 crc = new CRC32();
    try (InputStream input = archive.getInputStream(entry)) {
      int offset = 0;
      while (offset < bytes.length) {
        checkNativeInterrupted();
        int read = input.read(bytes, offset, Math.min(65536, bytes.length - offset));
        if (read < 0) throw new IOException("DEX is shorter than its ZIP declaration");
        if (read == 0) continue;
        crc.update(bytes, offset, read);
        offset += read;
      }
      if (input.read() != -1) throw new IOException("DEX exceeds its ZIP declaration");
    }
    if (entry.getCrc() < 0 || entry.getCrc() != crc.getValue())
      throw new IOException("DEX does not match its ZIP CRC32 declaration");
    return bytes;
  }

  /** Raw DEX ownership precedes JADX's duplicate-class selection and aliases. */
  static Map<String, Object> nativeDeclarations(Path apk) {
    NativeInventory inventory = new NativeInventory();
    try (ZipFile archive = new ZipFile(apk.toFile())) {
      Map<String, Integer> names = new HashMap<>();
      var directory = archive.entries();
      while (directory.hasMoreElements()) {
        checkNativeInterrupted();
        ZipEntry entry = directory.nextElement();
        if (!entry.isDirectory() && nativeDexEntry(entry.getName())) {
          inventory.dexEntries++;
          names.merge(entry.getName(), 1, Integer::sum);
        }
      }
      long totalBytes = 0;
      int entryIndex = -1;
      directory = archive.entries();
      while (directory.hasMoreElements()) {
        checkNativeInterrupted();
        ZipEntry entry = directory.nextElement();
        entryIndex++;
        String path = entry.getName();
        if (entry.isDirectory() || !nativeDexEntry(path)) continue;
        if (names.get(path) != 1) {
          inventory.unknown("Duplicate root DEX entry name cannot be selected uniquely by the ZIP reader: " + path);
          continue;
        }
        if (entry.getSize() < 0 || entry.getSize() > NATIVE_DEX_BYTES
            || entry.getSize() > NATIVE_TOTAL_DEX_BYTES - totalBytes) {
          inventory.unknown("Root DEX member exceeds the 64 MiB member or 256 MiB total read allowance: " + path);
          continue;
        }
        totalBytes += entry.getSize();
        try {
          DexBackedDexFile dex = new NativeDex(readNativeDex(archive, entry));
          var classes = dex.getClassSection();
          for (int classIndex = 0; classIndex < classes.size(); classIndex++) {
            checkNativeInterrupted();
            DexBackedClassDef cls = classes.get(classIndex);
            String type = cls.getType();
            if (!type.startsWith("L") || !type.endsWith(";"))
              throw new IllegalArgumentException("Class definition has no reference type");
            String className = type.substring(1, type.length() - 1).replace('/', '.');
            // Passing false retains duplicate encoded method references too.
            for (Iterable<? extends DexBackedMethod> group : List.of(
                cls.getDirectMethods(false), cls.getVirtualMethods(false))) {
              for (DexBackedMethod method : group) {
                checkNativeInterrupted();
                inventory.examinedMethods++;
                if ((method.getAccessFlags() & 0x100) == 0) continue;
                String methodName = method.getName();
                String returnType = method.getReturnType();
                long characters = 2L + returnType.length();
                for (CharSequence parameter : method.getParameterTypes()) {
                  characters += parameter.length();
                  if (characters * 6L > NATIVE_JSON_BYTES) break;
                }
                long bytes = 512L + 6L * (className.length() + methodName.length()
                    + path.length() + characters);
                if (inventory.retainedBytes + bytes > NATIVE_JSON_BYTES - 4096) {
                  inventory.unknown("Native declarations exceed the 4 MiB retained JSON allowance; remaining declarations are unknown.");
                  return inventory.result();
                }
                StringBuilder descriptor = new StringBuilder((int) characters).append('(');
                for (CharSequence parameter : method.getParameterTypes()) descriptor.append(parameter);
                descriptor.append(')').append(returnType);
                Map<String, Object> row = Map.of("source_index", inventory.methods.size(),
                    "class_name", className, "method_name", methodName, "descriptor", descriptor.toString(),
                    "dex_entry", path, "dex_entry_index", entryIndex, "class_index", classIndex,
                    "method_index", method.getMethodIndex());
                if (!inventory.retain(row, bytes)) return inventory.result();
              }
            }
            inventory.examinedClasses++;
          }
          inventory.examinedDexEntries++;
        } catch (IOException | RuntimeException failure) {
          if (failure instanceof java.util.concurrent.CancellationException) throw (RuntimeException) failure;
          inventory.unknown("Root DEX native declarations could not be fully read from " + path + ": "
              + failure.getClass().getSimpleName()
              + (failure.getMessage() == null ? "" : " (" + failure.getMessage() + ")"));
        }
      }
    } catch (IOException failure) {
      // A failed archive close must fail the operation so the provider retires
      // its owned JVM; do not cache a result with lost file-resource ownership.
      throw new IllegalArgumentException("APK ZIP native declaration inventory could not finish its reader", failure);
    }
    return inventory.result();
  }

  /** Original archive identity, never a deobfuscated basename or name suffix. */
  private ManifestSnapshot manifest(JadxSession current) {
    if (manifestSession != current || manifestSnapshot == null) {
      ResourceFile selected = null;
      for (ResourceFile resource : current.getResources()) {
        if (resource.getType() != ResourceType.MANIFEST
            || !resource.getOriginalName().equals("AndroidManifest.xml")) continue;
        if (selected != null)
          throw new IllegalArgumentException("Root AndroidManifest.xml resource identity is ambiguous");
        selected = resource;
      }
      if (selected == null) throw new IllegalArgumentException("Root AndroidManifest.xml not found");
      String xml = manifestText(selected);
      ManifestSnapshot snapshot = new ManifestSnapshot(xml, manifestSummary(xml));
      manifestSnapshot = snapshot;
      manifestSession = current;
    }
    return manifestSnapshot;
  }

  /** Decode with resource names but without JADX's class alias substitution. */
  static String manifestText(ResourceFile resource) {
    var decompiler = resource.getDecompiler();
    // BinaryXMLParser resolves android:name against its root's class identities
    // and replaces raw '$' and relative names with Java-style aliases. A fresh
    // root owns no classes, while its resource-name table preserves reference
    // rendering from the loaded target.
    RootNode root = new RootNode(decompiler.getArgs());
    root.getConstValues().setResourcesNames(decompiler.getRoot().getConstValues().getResourcesNames());
    try {
      return ResourcesLoader.decodeStream(resource,
          (size, input) -> new BinaryXMLParser(root).parse(input).getCodeStr());
    } catch (jadx.core.utils.exceptions.JadxException failure) {
      throw new IllegalArgumentException("Root AndroidManifest.xml did not decode as text", failure);
    }
  }

  /** One parsed XML owner supplies namespace-aware values alongside the exact decoded text. */
  static Map<String, Object> manifestSummary(String xml) {
    Element root;
    try {
      // Match REA's existing JDK XML setup: document types are unsupported.
      // Parse an in-memory string; XInclude and external DTD/schema I/O stay disabled.
      DocumentBuilderFactory factory = DocumentBuilderFactory.newDefaultNSInstance();
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setXIncludeAware(false);
      factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
      factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      root = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml)))
          .getDocumentElement();
    } catch (javax.xml.parsers.ParserConfigurationException | org.xml.sax.SAXException
        | java.io.IOException failure) {
      throw new IllegalArgumentException("Root AndroidManifest.xml is not supported well-formed XML", failure);
    }
    if (!root.getTagName().equals("manifest") || root.getNamespaceURI() != null)
      throw new IllegalArgumentException("AndroidManifest.xml root must be an unnamespaced <manifest>");
    String android = "http://schemas.android.com/apk/res/android";
    String minSdk = "";
    String targetSdk = "";
    List<String> permissions = new ArrayList<>();
    for (Node child = root.getFirstChild(); child != null; child = child.getNextSibling()) {
      if (!(child instanceof Element element) || element.getNamespaceURI() != null) continue;
      if (element.getTagName().equals("uses-sdk")) {
        minSdk = element.getAttributeNS(android, "minSdkVersion");
        targetSdk = element.getAttributeNS(android, "targetSdkVersion");
      } else if (element.getTagName().equals("uses-permission")) {
        String permission = element.getAttributeNS(android, "name");
        if (!permission.isEmpty()) permissions.add(permission);
      }
    }
    Map<String, Object> summary = new LinkedHashMap<>();
    summary.put("package", root.getAttribute("package"));
    summary.put("version_name", root.getAttributeNS(android, "versionName"));
    summary.put("version_code", root.getAttributeNS(android, "versionCode"));
    summary.put("min_sdk", minSdk);
    summary.put("target_sdk", targetSdk);
    summary.put("permissions", List.copyOf(permissions));
    return Collections.unmodifiableMap(summary);
  }

  private void indexClasses() {
    JadxSession current = session();
    if (indexedSession != current) {
      Map<String, List<ClassSnapshot>> index = new LinkedHashMap<>();
      if (!current.getClasses().isEmpty()) {
        JadxDecompiler decompiler = current.getClasses().get(0).getClassNode().root().getDecompiler();
        // JavaClass.getMethods/getFields/getInnerClasses all load code. Raw nodes do not.
        // Snapshot every identity before code generation can rewrite aliases or members.
        for (JavaClass cls : decompiler.getClassesWithInners()) {
          ClassNode node = cls.getClassNode();
          List<MethodNode> ordered = new ArrayList<>(node.getMethods());
          ordered.sort(Comparator.comparing(MethodNode::getAlias));
          List<MethodSnapshot> methods = ordered.stream().map(method -> {
            String name = method.getAlias();
            String shortId = method.getMethodInfo().getShortId();
            String rawName = method.getMethodInfo().getName();
            if (!shortId.startsWith(rawName + "("))
              throw new IllegalStateException("JADX method ID has no raw-name prefix: " + shortId);
            String descriptor = shortId.substring(rawName.length());
            List<String> bodyAbsenceMarkers = new ArrayList<>();
            if (method.getAccessFlags().isNative()) bodyAbsenceMarkers.add("native_method");
            if (method.getAccessFlags().isAbstract()) bodyAbsenceMarkers.add("abstract_method");
            String signature = name + "(" + method.getArgTypes().stream()
                .map(Object::toString).collect(Collectors.joining(", "))
                + "): " + method.getReturnType().toString();
            return new MethodSnapshot(name, rawName, shortId, List.copyOf(bodyAbsenceMarkers), Map.of(
                "name", name, "raw_name", rawName, "signature", signature,
                "dex_descriptor", descriptor,
                "is_constructor", method.isConstructor(), "def_pos", 0));
          }).toList();
          List<FieldNode> orderedFields = new ArrayList<>(node.getFields());
          orderedFields.sort(Comparator.comparing(FieldNode::getAlias));
          List<Map<String, Object>> fields = new ArrayList<>();
          List<Map<String, Object>> valuedFields = new ArrayList<>();
          boolean anyValue = false;
          for (FieldNode field : orderedFields) {
            // Raw DEX identity for mapping lookups; the display type can carry generics.
            Map<String, Object> entry = Map.of("name", field.getAlias(),
                "raw_name", field.getFieldInfo().getName(),
                "type", field.getType().toString(),
                "dex_type", TypeGen.signature(field.getFieldInfo().getType()), "def_pos", 0);
            fields.add(entry);
            Map<String, Object> value = dexStaticValue(field);
            if (value == null) valuedFields.add(entry);
            else {
              anyValue = true;
              Map<String, Object> valued = new LinkedHashMap<>(entry);
              valued.put("dex_static_value", value);
              valuedFields.add(Collections.unmodifiableMap(valued));
            }
          }
          List<String> inner = node.getInnerClasses().stream().map(ClassNode::getFullName).toList();
          List<String> innerRaw = node.getInnerClasses().stream().map(ClassNode::getRawName).toList();
          Map<String, Object> summary = Map.of(
              "full_name", cls.getFullName(), "raw_name", cls.getRawName(), "name", cls.getName(),
              "method_count", methods.size(), "field_count", fields.size(),
              "inner_class_count", inner.size(), "inner_classes", inner, "inner_class_raw_names", innerRaw,
              "methods", methods.stream().map(MethodSnapshot::summary).toList(), "fields", List.copyOf(fields));
          // DEX static values are opt-in, so method and reference lookups keep the member-only reply.
          Map<String, Object> summaryWithValues = summary;
          if (anyValue) {
            Map<String, Object> copy = new LinkedHashMap<>(summary);
            copy.put("fields", List.copyOf(valuedFields));
            summaryWithValues = Collections.unmodifiableMap(copy);
          }
          ClassSnapshot snapshot = new ClassSnapshot(cls, methods, summary, summaryWithValues);
          index.computeIfAbsent(cls.getFullName(), ignored -> new ArrayList<>()).add(snapshot);
          // Keep the binary identity supplied by JADX; '$' can also be a literal
          // name character, so replacing separators would invent lookup aliases.
          if (!cls.getRawName().equals(cls.getFullName()))
            index.computeIfAbsent(cls.getRawName(), ignored -> new ArrayList<>()).add(snapshot);
        }
      }
      classes = Collections.unmodifiableMap(index);
      indexedSession = current;
    }
  }

  private ClassSnapshot selected(JsonObject args) {
    indexClasses();
    String name = string(args, "class_name");
    List<ClassSnapshot> candidates = classes.get(name);
    if (candidates == null) throw new InputFailure("class_name", "Exact class not found: " + name
        + "; use search_android_classes to discover fully qualified names.");
    if (candidates.size() != 1) throw new InputFailure("class_name", "Ambiguous metadata class identity: " + name
        + "; raw identities: " + candidates.stream().map(candidate -> candidate.node().getRawName()).toList());
    return candidates.get(0);
  }

  /** A static final field's class-definition static value; a static initializer can still assign it. */
  private static Map<String, Object> dexStaticValue(FieldNode field) {
    if (!field.getAccessFlags().isStatic() || !field.getAccessFlags().isFinal()) return null;
    EncodedValue encoded = field.get(JadxAttrType.CONSTANT_VALUE);
    if (encoded == null) return null;
    Object value = encoded.getValue();
    // JADX also attaches the shared null to static finals without a value, so null is never reported.
    // Wide and floating values keep their Java text instead of a lossy JSON number.
    return switch (encoded.getType()) {
      case ENCODED_BOOLEAN -> Map.of("type", "boolean", "value", value);
      case ENCODED_BYTE -> Map.of("type", "byte", "value", value);
      case ENCODED_SHORT -> Map.of("type", "short", "value", value);
      case ENCODED_CHAR -> Map.of("type", "char", "value", (int) (Character) value);
      case ENCODED_INT -> Map.of("type", "int", "value", value);
      case ENCODED_LONG -> Map.of("type", "long", "value", value.toString());
      case ENCODED_FLOAT -> Map.of("type", "float", "value", value.toString());
      case ENCODED_DOUBLE -> Map.of("type", "double", "value", value.toString());
      case ENCODED_STRING -> Map.of("type", "string", "value", value);
      default -> null;
    };
  }

  private List<MethodSnapshot> methods(ClassSnapshot cls, JsonObject args) {
    String name = string(args, "method_name");
    List<MethodSnapshot> result = cls.methods().stream().filter(method -> method.name().equals(name)).toList();
    if (result.isEmpty()) throw new InputFailure("method_name", "Method not found: " + name
        + "; use inspect_android_class to discover available methods.");
    return result;
  }

  private JavaMethod method(ClassSnapshot cls, MethodSnapshot selected) {
    JavaMethod result = cls.node().searchMethodByShortId(selected.shortId());
    if (result == null) throw new IllegalArgumentException("Method identity no longer available: " + selected.shortId());
    return result;
  }

  private JadxSession.SmartCode methodBody(JadxSession current, ClassSnapshot cls,
      MethodSnapshot selected, JavaMethod method) {
    // Access flags belong to the parsed member, before code generation rewrites it.
    // These methods have no Java body; source slicing can include unrelated members.
    if (!selected.bodyAbsenceMarkers().isEmpty())
      return new JadxSession.SmartCode("", "java", false, selected.bodyAbsenceMarkers());
    // Java code generation can fold all or part of <clinit> into field declarations.
    // Its method text cannot establish coverage, even when a static block remains.
    if (selected.shortId().equals("<clinit>()V"))
      return exactMethodSmali(current, cls, selected, List.of("static_initializer_disassembly"));
    String java = current.getMethodSource(method);
    if (java.startsWith("// ERROR:")) throw new IllegalArgumentException(java);
    // The upstream placeholder means only that Java code was omitted, including
    // methods merged into synthetic bridges. Access flags established absence above.
    if (java.isEmpty() || java.equals(
        "// method exists but has no decompiled body (native/abstract)"))
      return exactMethodSmali(current, cls, selected, List.of("java_body_unavailable"));
    List<String> markers = DecompileFailureKt.detectDecompileFailure(java);
    if (markers.stream().anyMatch(DecompileFailureKt.getSTRONG_FAILURE_MARKERS()::contains))
      return exactMethodSmali(current, cls, selected, markers);
    return new JadxSession.SmartCode(
        TextUtilKt.truncateToBytes(java, current.getMaxSourceBytes()), "java", false, markers);
  }

  private JadxSession.SmartCode exactMethodSmali(JadxSession current, ClassSnapshot cls,
      MethodSnapshot selected, List<String> markers) {
    JadxSession.MethodSmali smali = current.getMethodSmali(cls.node(), selected.rawName());
    String block = selectMethodSmali(smali, selected.shortId());
    return new JadxSession.SmartCode(
        TextUtilKt.truncateToBytes(block, current.getMaxSourceBytes()), "smali", true, markers);
  }

  private static String selectMethodSmali(JadxSession.MethodSmali smali, String shortId) {
    if (!smali.getFound())
      throw new IllegalArgumentException("JADX could not disassemble " + shortId
          + (smali.getNote() == null ? "" : ": " + smali.getNote()));
    // Upstream returns every same-name overload, and can return an unterminated
    // trailing block. Match the full original identity before applying output limits.
    List<String> matches = smali.getBlocks().stream().filter(block -> {
      String header = block.lines().findFirst().orElse("").strip();
      return header.startsWith(".method ") && header.endsWith(" " + shortId);
    }).toList();
    if (matches.size() != 1)
      throw new IllegalArgumentException("Disassembly could not establish one selected method: " + shortId);
    String block = matches.get(0);
    if (!block.stripTrailing().endsWith("\n.end method"))
      throw new IllegalArgumentException("Selected method disassembly is incomplete: " + shortId);
    return block;
  }

  // The local transport admits 8 MiB frames. Reserve 1 KiB for the fixed
  // JSON-RPC/CallToolResult envelope and generated numeric request id, and
  // account for JSON text being escaped again inside TextContent.
  private static final int MAX_XREF_TEXT_BYTES = 8 * 1024 * 1024 - 1024;
  // Leave room for the prototype reply, reference reply, retained raw calls,
  // normalized Evidence and their text/structured MCP copies, not just one frame.
  private static final int MAX_EXTERNAL_XREF_BYTES = MAX_XREF_TEXT_BYTES / 8;
  private static int escapedJsonBytes(Object value) {
    return JSON.toJson(JSON.toJson(value)).getBytes(StandardCharsets.UTF_8).length;
  }
  private static final class InvokeBudget {
    long remaining;
    InvokeBudget(long remaining) { this.remaining = Math.max(0, remaining); }
    boolean fitsText(long characters) {
      return remaining >= 256 && characters <= (remaining - 256) / 12;
    }
    boolean admit(Map<String, Object> site) {
      // Check a conservative two-layer escape bound before serialization.
      long bound = 256;
      for (Object value : site.values())
        if (value instanceof String text) bound += 12L * text.length();
      if (bound > remaining) return false;
      long bytes = escapedJsonBytes(site) - 2L + 1L;
      if (bytes > remaining) return false;
      remaining -= bytes;
      return true;
    }
  }
  private record DirectInvokes(List<Map<String, Object>> sites, boolean exhaustive) {}

  @FunctionalInterface private interface InvokeVisitor {
    void accept(MethodInfo target, int offset, int index, Opcode opcode);
  }

  /** Decode raw invoke identity once at the shared bridge boundary, without generating source. */
  private static void visitInvokes(MethodNode node, InvokeVisitor visitor) {
    checkNativeInterrupted();
    ICodeReader code = node.getCodeReader();
    if (code == null) return;
    code.visitInstructions(insn -> {
      checkNativeInterrupted();
      insn.decode();
      if (insn.getIndexType() != InsnIndexType.METHOD_REF) return;
      Opcode opcode = insn.getOpcode();
      if (!opcode.name().startsWith("INVOKE_")) return;
      IMethodRef ref = insn.getIndexAsMethod();
      ref.load();
      visitor.accept(MethodInfo.fromRef(node.root(), ref), insn.getOffset(), insn.getIndex(), opcode);
    });
  }

  /** Raw DEX invokes within one JADX using method; offsets are code units from its code start. */
  private static DirectInvokes directInvokes(JavaMethod source, MethodInfo target, InvokeBudget budget) {
    return directInvokes(source.getMethodNode(), target, budget);
  }

  private static void visitDirectInvokes(MethodNode node, MethodInfo target, InvokeVisitor visitor) {
    visitInvokes(node, (referenced, offset, index, opcode) -> {
      if (referenced.getRawFullId().equals(target.getRawFullId()))
        visitor.accept(referenced, offset, index, opcode);
    });
  }

  private static boolean referencesMethod(MethodNode node, MethodInfo target) {
    boolean[] found = {false};
    visitDirectInvokes(node, target, (referenced, offset, index, opcode) -> found[0] = true);
    return found[0];
  }

  private static DirectInvokes directInvokes(MethodNode node, MethodInfo target, InvokeBudget budget) {
    if (node.getCodeReader() == null) return null;
    List<Map<String, Object>> sites = new ArrayList<>();
    boolean[] exhaustive = {true};
    visitDirectInvokes(node, target, (referenced, offset, index, opcode) -> {
      Map<String, Object> site = Map.of(
          "dex_entry", node.getInputFileName(),
          "source_raw_method_id", node.getMethodInfo().getRawFullId(),
          "dex_code_unit_offset", offset,
          "dex_method_index", index,
          "opcode", opcode.name());
      if (budget.admit(site)) sites.add(site);
      else exhaustive[0] = false;
    });
    return new DirectInvokes(sites, exhaustive[0]);
  }

  private List<ClassSnapshot> sourceClasses() {
    indexClasses();
    Set<ClassSnapshot> seen = Collections.newSetFromMap(new IdentityHashMap<>());
    List<ClassSnapshot> result = new ArrayList<>();
    for (List<ClassSnapshot> group : classes.values())
      for (ClassSnapshot source : group) if (seen.add(source)) result.add(source);
    result.sort(Comparator.comparing(source -> source.node().getRawName()));
    return result;
  }

  private static long displayTypeCharacters(ArgType type) {
    if (type.isArray())
      return 2L * type.getArrayDimension() + displayTypeCharacters(type.getArrayRootElement());
    if (type.isPrimitive()) return type.getPrimitiveType().getLongName().length();
    if (type.isObject() && !type.isGeneric() && !type.isGenericType()) return type.getObject().length();
    throw new IllegalArgumentException("External prototype contains a non-DEX type");
  }

  private static Map<String, Object> externalMethodSummary(MethodInfo info, InvokeBudget budget) {
    String name = info.getName();
    long signatureCharacters = name.length() + 4L + displayTypeCharacters(info.getReturnType())
        + 2L * Math.max(0, info.getArgsCount() - 1);
    for (ArgType type : info.getArgumentsTypes()) signatureCharacters += displayTypeCharacters(type);
    long descriptorCharacters = info.getShortId().length() - (long) name.length();
    // Use parsed type facts and the existing short-id length before copying/joining strings.
    if (!budget.fitsText(2L * name.length() + descriptorCharacters + signatureCharacters))
      throw new ReferenceLimit("method_inventory");
    String descriptor = info.getShortId().substring(name.length());
    String signature = name + "(" + info.getArgumentsTypes().stream()
        .map(Object::toString).collect(Collectors.joining(", "))
        + "): " + info.getReturnType();
    Map<String, Object> summary = Map.of("name", name, "raw_name", name, "signature", signature,
        "dex_descriptor", descriptor, "is_constructor", info.isConstructor(), "def_pos", 0);
    if (!budget.admit(summary)) throw new ReferenceLimit("method_inventory");
    return summary;
  }

  /** Only directly referenced prototypes, not invented definitions or an external classpath. */
  private List<ExternalMethod> externalMethods(JsonObject args) {
    String className = string(args, "class_name");
    String methodName = string(args, "method_name");
    JadxSession current = session();
    if (externalInventory != null && externalInventory.session() == current
        && externalInventory.className().equals(className) && externalInventory.methodName().equals(methodName))
      return externalInventory.methods();
    // Retain only the latest bounded selection, never results from a replaced APK/session.
    externalInventory = null;
    SortedMap<String, ExternalMethod> methods = new TreeMap<>();
    boolean[] observedClass = {false};
    InvokeBudget budget = new InvokeBudget(MAX_EXTERNAL_XREF_BYTES
        - 4096L - 12L * (className.length() + (long) methodName.length()));
    for (ClassSnapshot source : sourceClasses()) {
      for (MethodSnapshot selected : source.methods()) {
        visitInvokes(method(source, selected).getMethodNode(), (info, offset, index, opcode) -> {
          if (!info.getDeclClass().getRawName().equals(className)) return;
          observedClass[0] = true;
          if (!info.getName().equals(methodName) || methods.containsKey(info.getShortId())) return;
          methods.put(info.getShortId(), new ExternalMethod(info, externalMethodSummary(info, budget)));
        });
      }
    }
    if (!observedClass[0]) throw new InputFailure("class_name",
        "No APK definition or direct DEX invoke references the exact class: " + className);
    if (methods.isEmpty()) throw new InputFailure("method_name",
        "No direct DEX invoke references " + className + "." + methodName);
    List<ExternalMethod> result = List.copyOf(methods.values());
    externalInventory = new ExternalInventory(current, className, methodName, result);
    return result;
  }

  private Map<String, Object> externalSummary(JsonObject args) {
    List<ExternalMethod> methods = externalMethods(args);
    return Map.of("class_name", string(args, "class_name"), "reference_target", "external",
        "observed_method_count", methods.size(),
        "prototypes", methods.stream().map(ExternalMethod::summary).toList());
  }

  private record ExternalCaller(MethodNode node, Map<String, Object> row) {}

  /** Reserve the complete using-node inventory before optional instruction positions. */
  private List<ExternalCaller> externalCallers(MethodInfo target, InvokeBudget budget) {
    List<ExternalCaller> callers = new ArrayList<>();
    for (ClassSnapshot source : sourceClasses()) {
      String className = String.valueOf(source.summary().get("full_name"));
      Map<String, Integer> overloads = new HashMap<>();
      for (MethodSnapshot candidate : source.methods()) {
        int overload = overloads.merge(candidate.name(), 1, Integer::sum) - 1;
        MethodNode node = method(source, candidate).getMethodNode();
        if (!referencesMethod(node, target)) continue;
        if (classes.get(className).size() != 1)
          throw new IllegalArgumentException("External caller has an ambiguous APK class identity: " + className);
        Map<String, Object> row = new LinkedHashMap<>(Map.of(
            "kind", "method", "name", candidate.name(), "full_name", className + "." + candidate.name(),
            "containing_class", className, "top_class", source.node().getTopParentClass().getFullName(),
            "def_pos", 0, "source_selector", Map.of("class_name", className,
                "method_name", candidate.name(), "overload_index", overload),
            "direct_invokes", List.of(), "direct_invokes_exhaustive", false));
        if (!budget.admit(row)) throw new ReferenceLimit("caller_inventory");
        callers.add(new ExternalCaller(node, row));
      }
    }
    return List.copyOf(callers);
  }

  private Map<String, Object> externalReferences(JsonObject args) {
    List<ExternalMethod> methods = externalMethods(args);
    if (methods.size() != 1 && !args.has("overload_index"))
      throw new InputFailure("overload_index", "Select one of " + methods.size() + " observed external prototypes");
    int index = integer(args, "overload_index", 0);
    if (index >= methods.size()) throw new InputFailure("overload_index", "External prototype index out of range: " + index);
    ExternalMethod method = methods.get(index);
    MethodInfo target = method.info();
    Map<String, Object> selected = method.summary();
    InvokeBudget budget = new InvokeBudget(MAX_EXTERNAL_XREF_BYTES
        - 4096L - escapedJsonBytes(selected));
    List<ExternalCaller> callers = externalCallers(target, budget);
    List<Map<String, Object>> items = new ArrayList<>();
    for (ExternalCaller caller : callers) {
      DirectInvokes invokes = directInvokes(caller.node(), target, budget);
      caller.row().put("direct_invokes", invokes.sites());
      caller.row().put("direct_invokes_exhaustive", invokes.exhaustive());
      items.add(caller.row());
    }
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("target", string(args, "class_name") + "." + target.getName());
    result.put("reference_target", "external");
    result.put("reference_scope", "direct_dex_invokes");
    result.put("dex_descriptor", selected.get("dex_descriptor"));
    result.put("reported_signature", selected.get("signature"));
    result.put("overload_index", index);
    result.put("total", items.size());
    result.put("count", items.size());
    result.put("resolve_line", false);
    result.put("items", items);
    return result;
  }

  private CallToolResult handle(String name, kotlinx.serialization.json.JsonObject input) {
    JsonObject args = JsonParser.parseString(input.toString()).getAsJsonObject();
    if (name.equals("rea_jvm_status")) return json(Map.of(
        "engine_reported_version", BuildInfo.VERSION,
        "max_heap_bytes", Runtime.getRuntime().maxMemory(),
        "available_processors", Runtime.getRuntime().availableProcessors(),
        "java_version", System.getProperty("java.version"),
        "metadata_scope", "parsed_members"));
    if (name.equals("rea_native_declarations"))
      return json(nativeDeclarations(Path.of(string(args, "path"))));
    JadxSession current = session();
    if (name.equals("get_app_info")) return json(manifest(current).summary());
    if (name.equals("get_android_manifest"))
      return text(TextUtilKt.truncateToBytes(manifest(current).text(), current.getMaxSourceBytes()), false);
    if (name.equals("list_classes")) {
      List<String> names = current.getClassFqns();
      String query = args.has("query") ? string(args, "query") : "";
      int offset = integer(args, "offset", 0);
      int limit = integer(args, "limit", 200);
      int start = Math.min(offset, names.size());
      int end = start;
      List<String> items;
      if (query.isEmpty()) {
        end = (int) Math.min((long) start + limit, names.size());
        items = names.subList(start, end);
      } else {
        items = new ArrayList<>();
        while (end < names.size() && items.size() < limit) {
          String nameInInventory = names.get(end++);
          if (nameInInventory.contains(query)) items.add(nameInInventory);
        }
      }
      return json(Map.of("total_classes", names.size(), "next_offset", end,
          "scope", "top_level", "offset", offset, "limit", limit,
          "items", items));
    }
    indexClasses();
    if (flag(args, "reference_target") && !classes.containsKey(string(args, "class_name"))) {
      if (name.equals("get_class_summary")) return json(externalSummary(args));
      if (name.equals("get_xrefs_to_method")) return json(externalReferences(args));
      throw new InputFailure("class_name", "External prototypes are only available to method reference queries");
    }
    ClassSnapshot cls = selected(args);
    if (name.equals("get_class_summary"))
      return json(flag(args, "dex_static_values") ? cls.summaryWithValues() : cls.summary());
    if (name.equals("get_method_body")) {
      List<MethodSnapshot> overloads = methods(cls, args);
      int index = integer(args, "overload_index", 0);
      if (index >= overloads.size()) throw new InputFailure("overload_index", "overload_index out of range: " + index);
      JavaMethod method = method(cls, overloads.get(index));
      JadxSession.SmartCode code = methodBody(current, cls, overloads.get(index), method);
      return json(Map.of("class_name", cls.summary().get("full_name"),
          "method_name", overloads.get(index).name(), "full_name", method.getFullName(),
          "dex_descriptor", overloads.get(index).summary().get("dex_descriptor"),
          "overload_index", index, "overload_count", overloads.size(),
          "mode", code.getKind(), "fell_back", code.getFellBack(),
          "markers", code.getMarkers(), "body", code.getText()));
    }
    List<JavaNode> uses;
    String target = (String) cls.summary().get("full_name");
    MethodSnapshot selectedMethod = null;
    int overloadIndex = 0;
    if (name.equals("get_xrefs_to_class")) uses = cls.node().getUseIn();
    else {
      List<MethodSnapshot> overloads = methods(cls, args);
      if (overloads.size() != 1 && !args.has("overload_index"))
        throw new InputFailure("overload_index", "Select one of " + overloads.size() + " method overloads");
      overloadIndex = integer(args, "overload_index", 0);
      if (overloadIndex >= overloads.size())
        throw new InputFailure("overload_index", "overload_index out of range: " + overloadIndex);
      selectedMethod = overloads.get(overloadIndex);
      target += "." + selectedMethod.name();
      uses = method(cls, selectedMethod).getUseIn();
    }
    // REA consumes all references without materializing source line information.
    MethodInfo targetInfo = selectedMethod == null ? null : method(cls, selectedMethod).getMethodNode().getMethodInfo();
    List<Map<String, Object>> items = uses.stream().map(node -> {
      Map<String, Object> item = new LinkedHashMap<>(current.describeUsage(node, false));
      if (targetInfo != null && node instanceof JavaMethod) {
        item.put("direct_invokes", List.of());
        item.put("direct_invokes_exhaustive", false);
      }
      return item;
    }).toList();
    Map<String, Object> result = new LinkedHashMap<>(Map.of("target", target,
        "total", uses.size(), "count", items.size(), "resolve_line", false, "items", items));
    if (selectedMethod != null) {
      result.put("overload_index", overloadIndex);
      result.put("reported_signature", selectedMethod.summary().get("signature"));
    }
    if (targetInfo != null) {
      InvokeBudget budget = new InvokeBudget(MAX_XREF_TEXT_BYTES - escapedJsonBytes(result));
      for (int index = 0; index < uses.size(); index++) {
        if (!(uses.get(index) instanceof JavaMethod source)) continue;
        DirectInvokes invokes = directInvokes(source, targetInfo, budget);
        Map<String, Object> item = items.get(index);
        if (invokes == null) {
          item.remove("direct_invokes");
          item.remove("direct_invokes_exhaustive");
        } else {
          item.put("direct_invokes", invokes.sites());
          item.put("direct_invokes_exhaustive", invokes.exhaustive());
        }
      }
    }
    return json(result);
  }

  private static void registerBridgeTool(Server server, ReaJadxBridge bridge, String name,
      ToolSchema schema, String description) {
    Tool tool = new Tool(name, schema, description, null, null, null, null, null, null);
    server.addTool(tool, (connection, request, continuation) -> {
      try { return bridge.handle(name, request.getArguments()); }
      catch (InputFailure error) { return text(JSON.toJson(Map.of(
          "kind", "invalid-input", "field", error.field, "message", error.getMessage())), true); }
      catch (ReferenceLimit error) { return text(JSON.toJson(Map.of(
          "kind", "reference-output-limit", "stage", error.stage,
          "limit_bytes", MAX_EXTERNAL_XREF_BYTES)), true); }
      catch (IllegalArgumentException error) { return text(error.getMessage(), true); }
    });
  }

  public static void main(String[] args) throws Exception {
    PrintStream protocolOut = System.out;
    System.setOut(System.err);
    SessionConfig defaults = new SessionConfig(
        1048576, 0, 90000L, 1, List.of(), List.of(), 64, ResourceMode.FULL);
    SessionHolder holder = new SessionHolder(defaults);
    ServerCapabilities capabilities = new ServerCapabilities(
        new ServerCapabilities.Tools(null), null, null, null, null, null, null, Map.of());
    Server server = new Server(new Implementation("rea-jadx-bridge", "10", null, null, null),
        new ServerOptions(capabilities), "", ignored -> Unit.INSTANCE);
    SessionToolsKt.registerSessionTools(server, holder);
    ClassToolsKt.registerClassTools(server, holder);
    MethodToolsKt.registerMethodTools(server, holder);
    XrefToolsKt.registerXrefTools(server, holder);
    ReaJadxBridge bridge = new ReaJadxBridge(holder);
    Tool loadTool = server.getTools().get("load_apk").getTool();
    server.removeTool("load_apk");
    server.addTool(loadTool, (connection, request, continuation) ->
        bridge.load(request.getArguments(), defaults, continuation));
    Set<String> consumed = Set.of("load_apk",
        "list_classes", "get_class_summary", "get_method_body",
        "get_xrefs_to_class", "get_xrefs_to_method");
    for (String name : new ArrayList<>(server.getTools().keySet()))
      if (!consumed.contains(name)) server.removeTool(name);
    Tool diagnostics = new Tool("rea_jvm_status",
        new ToolSchema(null, new kotlinx.serialization.json.JsonObject(Map.of()), List.of(), null),
        "Observed worker JVM and metadata scope", null, null, null, null, null, null);
    server.addTool(diagnostics, (connection, request, continuation) -> bridge.handle("rea_jvm_status", request.getArguments()));
    registerBridgeTool(server, bridge, "rea_native_declarations",
        new ToolSchema(null, new kotlinx.serialization.json.JsonObject(Map.of("path",
            new kotlinx.serialization.json.JsonObject(Map.of("type",
                kotlinx.serialization.json.JsonElementKt.JsonPrimitive("string"))))), List.of("path"), null),
        "Original ACC_NATIVE declarations from the admitted APK's standard root DEX members, without loading or decompiling the APK.");
    for (String name : List.of("get_app_info", "get_android_manifest")) {
      String description = name.equals("get_app_info")
          ? "Namespace-aware summary of the exact root AndroidManifest.xml resource."
          : "Exact decoded root AndroidManifest.xml text, bounded by the session source byte limit.";
      registerBridgeTool(server, bridge, name,
          new ToolSchema(null, new kotlinx.serialization.json.JsonObject(Map.of()), List.of(), null), description);
    }
    for (String name : List.of("list_classes", "get_class_summary",
        "get_method_body", "get_xrefs_to_class", "get_xrefs_to_method")) {
      Tool tool = server.getTools().get(name).getTool();
      server.removeTool(name);
      List<String> fields = switch (name) {
        case "list_classes" -> List.of("offset", "limit");
        case "get_method_body" -> List.of("class_name", "method_name", "overload_index");
        case "get_xrefs_to_method" -> List.of("class_name", "method_name", "overload_index");
        default -> List.of("class_name");
      };
      Map<String, kotlinx.serialization.json.JsonElement> properties = new LinkedHashMap<>();
      for (String field : fields) properties.put(field, tool.getInputSchema().getProperties().get(field));
      if (name.equals("list_classes")) properties.put("query",
          new kotlinx.serialization.json.JsonObject(Map.of(
              "type", kotlinx.serialization.json.JsonElementKt.JsonPrimitive("string"))));
      if (name.equals("get_class_summary")) properties.put("dex_static_values",
          new kotlinx.serialization.json.JsonObject(Map.of(
              "type", kotlinx.serialization.json.JsonElementKt.JsonPrimitive("boolean"))));
      if (name.equals("get_class_summary") || name.equals("get_xrefs_to_method"))
        properties.put("reference_target", new kotlinx.serialization.json.JsonObject(Map.of(
            "type", kotlinx.serialization.json.JsonElementKt.JsonPrimitive("boolean"))));
      if (name.equals("get_class_summary")) properties.put("method_name",
          new kotlinx.serialization.json.JsonObject(Map.of(
              "type", kotlinx.serialization.json.JsonElementKt.JsonPrimitive("string"))));
      String description = switch (name) {
        case "list_classes" -> "Pages of case-sensitive matching top-level class names; offset and next_offset are inventory positions, limit bounds matching rows. Omitted or empty query inventories all names.";
        case "get_class_summary" -> "Parsed member metadata for one exact class name; no source generation. Set dex_static_values to include encoded static final field values.";
        case "get_method_body" -> "Source for an exact class and stable same-name overload index; static initializers use smali to preserve folded field initialization.";
        default -> "Complete static using-node inventory for an exact class or selected method overload; one node may contain multiple invoke instructions, and source lines are unresolved.";
      };
      registerBridgeTool(server, bridge, name,
          new ToolSchema(null, new kotlinx.serialization.json.JsonObject(properties),
              tool.getInputSchema().getRequired(), null), description);
    }
    CountDownLatch done = new CountDownLatch(1);
    server.onClose(() -> { done.countDown(); return Unit.INSTANCE; });
    StdioServerTransport transport = new StdioServerTransport(
        CoreKt.buffered(JvmCoreKt.asSource(System.in)),
        CoreKt.buffered(JvmCoreKt.asSink(protocolOut)));
    transport.onClose(() -> { done.countDown(); return Unit.INSTANCE; });
    ServerSession connection = null;
    try {
      connection = BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
          (scope, continuation) -> server.createSession(transport, continuation));
      done.await();
    } finally {
      try {
        if (connection != null) {
          ServerSession connected = connection;
          // Unsubscribe the connection before the SDK joins its notification service.
          BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
              (scope, continuation) -> connected.close(continuation));
        }
      } finally {
        try {
          BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
              (scope, continuation) -> server.close(continuation));
        } finally {
          bridge.clearManifest();
          BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
              (scope, continuation) -> holder.unload(continuation));
        }
      }
    }
  }
}
