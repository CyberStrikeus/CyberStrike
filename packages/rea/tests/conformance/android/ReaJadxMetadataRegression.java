import com.atxx.jhmcp.*;
import com.android.tools.smali.smali.Smali;
import com.android.tools.smali.smali.SmaliOptions;
import com.android.tools.smali.dexlib2.Opcodes;
import com.android.tools.smali.dexlib2.dexbacked.DexBackedDexFile;
import com.google.gson.*;
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult;
import io.modelcontextprotocol.kotlin.sdk.types.TextContent;
import jadx.api.*;
import jadx.core.dex.nodes.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlinx.coroutines.BuildersKt;

/** Real audited-JAR regression; synthetic protocol fixtures cannot prove absence of code generation. */
public class ReaJadxMetadataRegression {
  private static void require(boolean condition, String reason) {
    if (!condition) throw new AssertionError(reason);
  }

  private static JsonObject call(Method handle, Object bridge, String operation, JsonObject arguments)
      throws Exception {
    return JsonParser.parseString(callText(handle, bridge, operation, arguments)).getAsJsonObject();
  }

  private static String callText(Method handle, Object bridge, String operation, JsonObject arguments)
      throws Exception {
    var input = (kotlinx.serialization.json.JsonObject)
        kotlinx.serialization.json.Json.Default.parseToJsonElement(arguments.toString());
    CallToolResult response;
    try {
      response = (CallToolResult) handle.invoke(bridge, operation, input);
    } catch (InvocationTargetException failure) {
      throw new AssertionError(operation + " failed", failure.getCause());
    }
    require(!Boolean.TRUE.equals(response.isError()), operation + " returned an error");
    require(response.getContent().size() == 1 && response.getContent().get(0) instanceof TextContent,
        "Unsupported response envelope");
    return ((TextContent) response.getContent().get(0)).getText();
  }

  private static void verifyManifestSummary() {
    for (String prefix : List.of("android", "a")) {
      for (String encoded : List.of("one &amp; beta", "one &amp;amp; beta")) {
        String xml = "<manifest xmlns:" + prefix + "=\"http://schemas.android.com/apk/res/android\""
            + " xmlns:other=\"urn:unrelated\" package=\"org.example.root\" "
            + prefix + ":versionName=\"" + encoded + "\" " + prefix + ":versionCode=\"7\""
            + " other:versionName=\"decoy\"><uses-sdk " + prefix + ":minSdkVersion=\"23\" "
            + prefix + ":targetSdkVersion=\"35\"/><uses-permission " + prefix
            + ":name=\"org.example.MARKER\"/><application><uses-permission " + prefix
            + ":name=\"nested.decoy\"/></application></manifest>";
        Map<String, Object> summary = ReaJadxBridge.manifestSummary(xml);
        require(summary.get("package").equals("org.example.root"), "Wrong manifest package");
        require(summary.get("version_name").equals(
            encoded.equals("one &amp; beta") ? "one & beta" : "one &amp; beta"),
            "Version name lost XML entity identity: " + summary);
        require(summary.get("version_code").equals("7") && summary.get("min_sdk").equals("23")
            && summary.get("target_sdk").equals("35"), "Namespace prefix changed summary values");
        require(summary.get("permissions").equals(List.of("org.example.MARKER")),
            "Permission summary included a nested or unrelated declaration");
      }
    }
    for (String xml : List.of("<other/>", "<manifest><application></manifest>",
        "<!DOCTYPE manifest SYSTEM 'file:///rea-unread-external.dtd'><manifest/>")) {
      boolean refused = false;
      try { ReaJadxBridge.manifestSummary(xml); }
      catch (IllegalArgumentException expected) { refused = true; }
      require(refused, "Malformed or externally described XML was accepted");
    }
  }

  private static void verifyRootManifests(SessionHolder holder, SessionConfig config,
      Constructor<?> constructor, Method handle, Path output) throws Exception {
    verifyManifestSummary();
    Object bridge = constructor.newInstance(holder);
    for (boolean assetFirst : List.of(true, false)) {
      String pkg = assetFirst ? "org.example.first" : "org.example.second";
      String root = "<manifest xmlns:a=\"http://schemas.android.com/apk/res/android\" package=\""
          + pkg + "\" a:versionName=\"one &amp; beta\" a:versionCode=\"7\"/>";
      String asset = "<manifest package=\"org.example.asset\"/>";
      Path apk = output.resolve(assetFirst ? "manifest-asset-first.apk" : "manifest-root-first.apk");
      try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(apk))) {
        for (String path : assetFirst
            ? List.of("assets/AndroidManifest.xml", "AndroidManifest.xml")
            : List.of("AndroidManifest.xml", "assets/AndroidManifest.xml")) {
          zip.putNextEntry(new ZipEntry(path));
          zip.write((path.equals("AndroidManifest.xml") ? root : asset).getBytes(StandardCharsets.UTF_8));
          zip.closeEntry();
        }
      }
      BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
          (scope, continuation) -> holder.unload(continuation));
      BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
          (scope, continuation) -> holder.load(apk.toString(), config, continuation));
      JsonObject summary = call(handle, bridge, "get_app_info", new JsonObject());
      require(summary.get("package").getAsString().equals(pkg), "Asset or previous session supplied package facts");
      require(summary.get("version_name").getAsString().equals("one & beta"), "Wrong root version value");
      String raw = holder.current().getResources().stream()
          .filter(resource -> resource.getOriginalName().equals("AndroidManifest.xml"))
          .findFirst().orElseThrow().loadContent().getText().getCodeStr();
      require(callText(handle, bridge, "get_android_manifest", new JsonObject()).equals(raw),
          "Bridge altered the decoded root resource text");
    }
    Path large = output.resolve("manifest-bounded-text.apk");
    String largeXml = "<manifest xmlns:a=\"http://schemas.android.com/apk/res/android\""
        + " package=\"org.example.large\">" + " ".repeat(config.getMaxSourceBytes() + 32)
        + "<uses-sdk a:minSdkVersion=\"23\" a:targetSdkVersion=\"35\"/></manifest>";
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(large))) {
      zip.putNextEntry(new ZipEntry("AndroidManifest.xml"));
      zip.write(largeXml.getBytes(StandardCharsets.UTF_8));
      zip.closeEntry();
    }
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(large.toString(), config, continuation));
    JsonObject largeSummary = call(handle, bridge, "get_app_info", new JsonObject());
    require(largeSummary.get("target_sdk").getAsString().equals("35"),
        "Summary was derived from truncated manifest text");
    String largeRaw = holder.current().getResources().stream()
        .filter(resource -> resource.getOriginalName().equals("AndroidManifest.xml"))
        .findFirst().orElseThrow().loadContent().getText().getCodeStr();
    require(largeRaw.getBytes(StandardCharsets.UTF_8).length > config.getMaxSourceBytes(),
        "Decoded manifest did not exceed the source byte limit");
    int targetAt = largeRaw.indexOf("targetSdkVersion");
    require(targetAt >= 0 && largeRaw.substring(0, targetAt).getBytes(StandardCharsets.UTF_8).length
        > config.getMaxSourceBytes(), "SDK declaration was not beyond the displayed text cap");
    require(callText(handle, bridge, "get_android_manifest", new JsonObject())
        .equals(TextUtilKt.truncateToBytes(largeRaw, config.getMaxSourceBytes())),
        "Manifest text did not retain the existing source byte limit");
    Path missing = output.resolve("manifest-asset-only.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(missing))) {
      zip.putNextEntry(new ZipEntry("assets/AndroidManifest.xml"));
      zip.write("<manifest package=\"org.example.asset\"/>".getBytes(StandardCharsets.UTF_8));
      zip.closeEntry();
    }
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(missing.toString(), config, continuation));
    var input = (kotlinx.serialization.json.JsonObject)
        kotlinx.serialization.json.Json.Default.parseToJsonElement("{}");
    boolean refused = false;
    try { handle.invoke(bridge, "get_app_info", input); }
    catch (InvocationTargetException failure) {
      refused = failure.getCause() instanceof IllegalArgumentException
          && failure.getCause().getMessage().contains("Root AndroidManifest.xml not found");
    }
    require(refused, "Missing root reused an asset or previous-session manifest");
    System.out.println("MANIFEST_REGRESSION_PASS root=true namespaces=true entities=true reload=true missing=true bounded=true");
  }

  private static JsonObject arguments(String className) {
    JsonObject value = new JsonObject();
    value.addProperty("class_name", className);
    return value;
  }

  private static void verifyRawClassSelectors(Method handle, Object bridge, JadxDecompiler decompiler)
      throws Exception {
    List<JavaClass> classes = decompiler.getClassesWithInners();
    JavaClass nested = classes.stream()
        .filter(cls -> cls.getRawName().contains("$") && !cls.getRawName().equals(cls.getFullName()))
        .filter(cls -> classes.stream().filter(other ->
            other.getFullName().equals(cls.getFullName()) || other.getRawName().equals(cls.getFullName()))
            .count() == 1)
        .findFirst().orElseThrow(() -> new AssertionError("Fixture has no unambiguous nested class"));
    JsonObject raw = arguments(nested.getRawName());
    JsonObject display = arguments(nested.getFullName());
    JsonObject summary = call(handle, bridge, "get_class_summary", raw);
    require(summary.get("raw_name").getAsString().equals(nested.getRawName()),
        "Class summary discarded original binary identity");
    require(summary.get("full_name").getAsString().equals(nested.getFullName()),
        "Class summary replaced the displayed name with the selector");
    require(summary.equals(call(handle, bridge, "get_class_summary", display)),
        "Raw and displayed selectors resolved different class metadata");
    JsonObject references = call(handle, bridge, "get_xrefs_to_class", raw);
    require(references.get("target").getAsString().equals(nested.getFullName()),
        "Reference target mixed its lookup selector with its displayed identity");
    require(references.equals(call(handle, bridge, "get_xrefs_to_class", display)),
        "Raw and displayed selectors resolved different incoming class references");
    System.out.println("RAW_CLASS_SELECTOR_REGRESSION_PASS nested=true metadata=true references=true");
  }

  /** Source generation can populate def_pos; it must not change reference identity. */
  private static JsonObject referenceIdentities(JsonObject references) {
    JsonObject identity = references.deepCopy();
    for (JsonElement item : identity.getAsJsonArray("items"))
      item.getAsJsonObject().remove("def_pos");
    return identity;
  }

  private static void verifyDefaultPackageSelectors(Method handle, Object bridge, JadxSession session)
      throws Exception {
    JavaClass selected = session.getClasses().stream().filter(cls -> cls.getRawName().equals("sb"))
        .findFirst().orElseThrow(() -> new AssertionError("Default-package fixture class missing"));
    String displayed = selected.getFullName();
    require(!displayed.equals("sb"), "Default-package fixture must exercise a distinct JADX display name");
    ProcessState state = selected.getClassNode().getState();
    JsonObject rawClass = arguments("sb");
    JsonObject displayedClass = arguments(displayed);
    JsonObject rawMethod = methodArguments("sb", "readNative");
    JsonObject displayedMethod = methodArguments(displayed, "readNative");
    JsonObject summary = call(handle, bridge, "get_class_summary", rawClass);
    require(summary.get("raw_name").getAsString().equals("sb")
        && summary.get("full_name").getAsString().equals(displayed),
        "Default-package summary mixed its raw and displayed identities");
    JsonObject body = call(handle, bridge, "get_method_body", rawMethod);
    require(body.get("class_name").getAsString().equals(displayed)
        && body.get("dex_descriptor").getAsString().equals("(I)I")
        && body.get("body").getAsString().isEmpty()
        && body.getAsJsonArray("markers").equals(JsonParser.parseString("[\"native_method\"]")),
        "Default-package native method lost its identity or parsed absence fact");
    JsonObject classReferences = call(handle, bridge, "get_xrefs_to_class", rawClass);
    require(classReferences.get("target").getAsString().equals(displayed),
        "Default-package class references replaced display identity with the raw selector");
    JsonObject methodReferences = call(handle, bridge, "get_xrefs_to_method", rawMethod);
    require(methodReferences.get("target").getAsString().equals(displayed + ".readNative")
        && methodReferences.get("total").getAsInt() == 1
        && methodReferences.get("count").getAsInt() == 1,
        "Default-package method reference did not retain its single caller");
    JsonArray invokes = methodReferences.getAsJsonArray("items").get(0).getAsJsonObject()
        .getAsJsonArray("direct_invokes");
    require(invokes.size() == 1
        && invokes.get(0).getAsJsonObject().get("source_raw_method_id").getAsString()
            .equals("sb.callNative(I)I"),
        "Default-package reference lost the caller's raw DEX identity");
    require(selected.getClassNode().getState() == state,
        "Default-package metadata or native absence lookup generated source");
    for (boolean generateNeighbour : List.of(true, false)) {
      require(summary.equals(call(handle, bridge, "get_class_summary", rawClass))
          && summary.equals(call(handle, bridge, "get_class_summary", displayedClass)),
          "Raw and displayed default-package selectors changed frozen class facts");
      require(body.equals(call(handle, bridge, "get_method_body", rawMethod))
          && body.equals(call(handle, bridge, "get_method_body", displayedMethod)),
          "Raw and displayed default-package selectors changed native method facts");
      require(classReferences.equals(call(handle, bridge, "get_xrefs_to_class", rawClass))
          && classReferences.equals(call(handle, bridge, "get_xrefs_to_class", displayedClass)),
          "Raw and displayed default-package selectors changed incoming class references");
      require(referenceIdentities(methodReferences).equals(
              referenceIdentities(call(handle, bridge, "get_xrefs_to_method", rawMethod)))
          && referenceIdentities(methodReferences).equals(
              referenceIdentities(call(handle, bridge, "get_xrefs_to_method", displayedMethod))),
          "Raw and displayed default-package selectors changed incoming method identities");
      if (generateNeighbour) {
        JsonObject neighbour = call(handle, bridge, "get_method_body", methodArguments("sb", "callNative"));
        require(neighbour.get("mode").getAsString().equals("java")
            && neighbour.get("body").getAsString().contains("readNative("),
            "Default-package neighbour did not generate its own native-calling Java body");
      }
    }
    System.out.println("DEFAULT_PACKAGE_SELECTOR_REGRESSION_PASS raw=true display=true metadata=true method=true references=true frozen=true");
  }

  private static void verifyClassPages(Method handle, Object bridge, List<String> inventory)
      throws Exception {
    int pages = 0;
    boolean nonzeroOffset = false;
    for (String query : List.of("", ".", "ApiDemos", "REA_ABSENT_83f1e89d")) {
      int limit = query.equals("ApiDemos") ? 1 : 17;
      List<String> expected = inventory.stream().filter(name -> name.contains(query)).toList();
      List<String> actual = new ArrayList<>();
      int offset = 0;
      do {
        JsonObject input = new JsonObject();
        input.addProperty("query", query);
        input.addProperty("offset", offset);
        input.addProperty("limit", limit);
        JsonObject page = call(handle, bridge, "list_classes", input);
        require(page.get("scope").getAsString().equals("top_level"), "Class scope changed");
        require(page.get("total_classes").getAsInt() == inventory.size(), "Inventory count changed");
        require(page.get("offset").getAsInt() == offset && page.get("limit").getAsInt() == limit,
            "Page selection changed");
        int next = page.get("next_offset").getAsInt();
        require(next > offset && next <= inventory.size(), "Inventory cursor did not advance");
        List<String> selected = new ArrayList<>();
        for (JsonElement name : page.getAsJsonArray("items")) selected.add(name.getAsString());
        require(selected.size() <= limit, "Matching page exceeded limit");
        require(selected.equals(inventory.subList(offset, next).stream()
            .filter(name -> name.contains(query)).toList()), "Page omitted or reordered matching rows");
        require(next == inventory.size() || selected.size() == limit, "Page stopped before filling");
        actual.addAll(selected);
        nonzeroOffset |= offset > 0;
        offset = next;
        pages++;
      } while (offset < inventory.size());
      require(actual.equals(expected), "Combined class pages differ from the native inventory");
    }
    require(nonzeroOffset, "Fixture did not exercise later native class pages");
    System.out.println("CLASS_SEARCH_REGRESSION_PASS pages=" + pages + " nonzero=true");
  }

  private static Path initializerFixture(String sources, String output) throws Exception {
    Path directory = Path.of(output);
    SmaliOptions options = new SmaliOptions();
    options.apiLevel = 28;
    options.jobs = 1;
    options.outputDexFile = directory.resolve("initializers.dex").toString();
    require(Smali.assemble(options, List.of(
        Path.of(sources, "InitializationPolicy.smali").toString(),
        Path.of(sources, "MixedInitialization.smali").toString(),
        Path.of(sources, "NativeOverload.smali").toString(),
        Path.of(sources, "AbstractShape.smali").toString(),
        Path.of(sources, "MergedMethod.smali").toString(),
        Path.of(sources, "DefaultPackageSelector.smali").toString(),
        Path.of(sources, "ConstantFields.smali").toString(),
        Path.of(sources, "NativeDeclarations.smali").toString(),
        Path.of(sources, "RenamedMembers.smali").toString(),
        Path.of(sources, "RenamedMembersInner.smali").toString())), "Initializer fixture assembly failed");
    Path apk = directory.resolve("initializers.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(apk))) {
      zip.putNextEntry(new ZipEntry("classes.dex"));
      Files.copy(Path.of(options.outputDexFile), zip);
      zip.closeEntry();
    }
    return apk;
  }

  private static void verifyDirectInvokes(SessionHolder holder, SessionConfig config,
      Constructor<?> constructor, Method handle, Path sources, Path output) throws Exception {
    SmaliOptions options = new SmaliOptions();
    options.apiLevel = 28;
    options.jobs = 1;
    options.outputDexFile = output.resolve("direct-invokes.dex").toString();
    require(Smali.assemble(options, List.of(
        sources.resolve("Caller.smali").toString(), sources.resolve("Target.smali").toString())),
        "Direct-invoke fixture assembly failed");
    Path apk = output.resolve("direct-invokes.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(apk))) {
      zip.putNextEntry(new ZipEntry("classes.dex"));
      Files.copy(Path.of(options.outputDexFile), zip);
      zip.closeEntry();
    }
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(apk.toString(), config, continuation));
    JsonObject refs = call(handle, constructor.newInstance(holder), "get_xrefs_to_method",
        methodArguments("fixture.Target", "mark"));
    checkDirectInvokes(refs, "classes.dex");

    SmaliOptions targetOptions = new SmaliOptions();
    targetOptions.apiLevel = 28;
    targetOptions.jobs = 1;
    targetOptions.outputDexFile = output.resolve("direct-target.dex").toString();
    SmaliOptions callerOptions = new SmaliOptions();
    callerOptions.apiLevel = 28;
    callerOptions.jobs = 1;
    callerOptions.outputDexFile = output.resolve("direct-caller.dex").toString();
    require(Smali.assemble(targetOptions, List.of(sources.resolve("Target.smali").toString())),
        "Target DEX assembly failed");
    require(Smali.assemble(callerOptions, List.of(sources.resolve("Caller.smali").toString())),
        "Caller DEX assembly failed");
    Path splitApk = output.resolve("direct-invokes-multidex.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(splitApk))) {
      zip.putNextEntry(new ZipEntry("classes.dex"));
      Files.copy(Path.of(targetOptions.outputDexFile), zip);
      zip.closeEntry();
      zip.putNextEntry(new ZipEntry("classes2.dex"));
      Files.copy(Path.of(callerOptions.outputDexFile), zip);
      zip.closeEntry();
    }
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(splitApk.toString(), config, continuation));
    JsonObject crossDex = call(handle, constructor.newInstance(holder), "get_xrefs_to_method",
        methodArguments("fixture.Target", "mark"));
    checkDirectInvokes(crossDex, "classes2.dex");
    System.out.println("DIRECT_INVOKE_REGRESSION_PASS nodes=1 offsets=0,3 cross_dex=true");
  }

  private static void checkDirectInvokes(JsonObject refs, String dexEntry) {
    require(refs.get("total").getAsInt() == 1, "JADX using-node count changed");
    JsonArray sites = refs.getAsJsonArray("items").get(0).getAsJsonObject()
        .getAsJsonArray("direct_invokes");
    require(sites.size() == 2, "Raw DEX invoke count differs from the fixture: " + sites);
    for (int i = 0; i < sites.size(); i++) {
      JsonObject site = sites.get(i).getAsJsonObject();
      require(site.get("dex_entry").getAsString().equals(dexEntry), "Wrong DEX entry");
      require(site.get("source_raw_method_id").getAsString().equals("fixture.Caller.twice()V"),
          "Wrong raw source method");
      require(site.get("dex_code_unit_offset").getAsInt() == i * 3, "Wrong DEX offset");
      require(site.get("opcode").getAsString().equals("INVOKE_STATIC"), "Wrong opcode");
    }
    require(sites.get(0).getAsJsonObject().get("dex_method_index").getAsInt()
        == sites.get(1).getAsJsonObject().get("dex_method_index").getAsInt(),
        "Two invokes did not reference the same DEX method ID");
  }

  private static JsonObject methodArguments(String className, String methodName) {
    JsonObject value = arguments(className);
    value.addProperty("method_name", methodName);
    value.addProperty("overload_index", 0);
    return value;
  }

  private static List<String> nativeIdentities(JsonObject result) {
    List<String> identities = new ArrayList<>();
    int source = 0;
    for (JsonElement value : result.getAsJsonArray("methods")) {
      JsonObject method = value.getAsJsonObject();
      require(method.get("source_index").getAsInt() == source++, "Native source ordinal changed");
      require(method.get("class_index").getAsInt() >= 0 && method.get("method_index").getAsInt() >= 0,
          "Native declaration lost DEX indices");
      identities.add(method.get("class_name").getAsString() + "."
          + method.get("method_name").getAsString() + method.get("descriptor").getAsString());
    }
    return identities;
  }

  private static JsonObject nativeArguments(Path apk) {
    JsonObject args = new JsonObject();
    args.addProperty("path", apk.toString());
    return args;
  }

  private static int replaceFixtureBytes(byte[] bytes, byte[] before, byte[] after) {
    require(before.length == after.length, "Fixture replacement changes lengths");
    int replacements = 0;
    for (int at = 0; at <= bytes.length - before.length; at++) {
      if (Arrays.equals(bytes, at, at + before.length, before, 0, before.length)) {
        System.arraycopy(after, 0, bytes, at, after.length);
        replacements++;
        at += before.length - 1;
      }
    }
    return replacements;
  }

  private static void verifyNativeDeclarations(Method handle, Object bridge, JadxSession session, Path apk)
      throws Exception {
    JadxDecompiler decompiler = session.getClasses().get(0).getClassNode().root().getDecompiler();
    IdentityHashMap<ClassNode, ProcessState> states = new IdentityHashMap<>();
    for (ClassNode cls : decompiler.getRoot().getClasses()) states.put(cls, cls.getState());
    JsonObject result = call(handle, bridge, "rea_native_declarations", nativeArguments(apk));
    require(result.get("scope").getAsString().equals("apk-root-dex-declarations"), "Native scope changed");
    require(result.getAsJsonObject("coverage").get("status").getAsString().equals("complete"),
        "Source-built native inventory was incomplete: " + result);
    Set<String> expected = Set.of(
        "fixture.InitializationPolicy.originalNative()V",
        "fixture.NativeOverload.zLastNative()V",
        "fixture.NativeOverload.readBuffer(Ljava/nio/ByteBuffer;I)Ljava/lang/String;",
        "sb.readNative(I)I",
        "fixture.Native_原.read_原([B)J",
        "fixture.Native_原.overloaded(I)I",
        "fixture.Native_原.overloaded(Ljava/lang/String;)I",
        "fixture.Native_原.do()V");
    List<String> actual = nativeIdentities(result);
    require(actual.size() == expected.size() && new HashSet<>(actual).equals(expected),
        "Native facts differ from smali declarations: " + actual);
    for (JsonElement value : result.getAsJsonArray("methods"))
      require(value.getAsJsonObject().get("dex_entry").getAsString().equals("classes.dex"),
          "Native DEX origin changed");
    for (var state : states.entrySet()) require(state.getKey().getState() == state.getValue(),
        "Native batch generated source: " + state.getKey().getRawName());
    require(result.equals(call(handle, bridge, "rea_native_declarations", nativeArguments(apk))),
        "Repeated native batch changed frozen facts");

    byte[] dex;
    try (ZipFile archive = new ZipFile(apk.toFile())) {
      try (var input = archive.getInputStream(archive.getEntry("classes.dex"))) {
        dex = input.readAllBytes();
      }
    }
    Path duplicate = apk.resolveSibling("native-duplicate-classes.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(duplicate))) {
      for (String name : List.of("classes.dex", "classes2.dex")) {
        zip.putNextEntry(new ZipEntry(name)); zip.write(dex); zip.closeEntry();
      }
    }
    Gson json = new Gson();
    JsonObject duplicated = json.toJsonTree(ReaJadxBridge.nativeDeclarations(duplicate)).getAsJsonObject();
    require(duplicated.getAsJsonObject("coverage").get("status").getAsString().equals("complete"),
        "Distinct DEX entries were confused with duplicate ZIP names");
    List<String> doubled = nativeIdentities(duplicated);
    require(doubled.size() == expected.size() * 2, "Duplicate DEX classes were selected away");
    for (String identity : expected) require(Collections.frequency(doubled, identity) == 2,
        "Duplicate declaration was deduplicated: " + identity);
    boolean secondOrigin = false;
    for (JsonElement value : duplicated.getAsJsonArray("methods"))
      secondOrigin |= value.getAsJsonObject().get("dex_entry").getAsString().equals("classes2.dex");
    require(secondOrigin, "Second DEX source identity was omitted");

    Path partial = apk.resolveSibling("native-malformed-second-dex.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(partial))) {
      zip.putNextEntry(new ZipEntry("classes.dex")); zip.write(dex); zip.closeEntry();
      zip.putNextEntry(new ZipEntry("classes2.dex")); zip.write(new byte[] { 1, 2, 3 }); zip.closeEntry();
    }
    JsonObject malformed = json.toJsonTree(ReaJadxBridge.nativeDeclarations(partial)).getAsJsonObject();
    require(malformed.getAsJsonObject("coverage").get("status").getAsString().equals("partial")
        && malformed.getAsJsonObject("coverage").get("examined_dex_entries").getAsInt() == 1
        && nativeIdentities(malformed).equals(actual) && !malformed.getAsJsonArray("unknowns").isEmpty(),
        "Malformed later DEX erased facts or claimed complete coverage");
    Path duplicateName = apk.resolveSibling("native-duplicate-zip-name.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(duplicateName))) {
      for (String name : List.of("classes1.dex", "classes2.dex")) {
        zip.putNextEntry(new ZipEntry(name)); zip.write(dex); zip.closeEntry();
      }
    }
    byte[] duplicateBytes = Files.readAllBytes(duplicateName);
    require(replaceFixtureBytes(duplicateBytes, "classes2.dex".getBytes(StandardCharsets.UTF_8),
        "classes1.dex".getBytes(StandardCharsets.UTF_8)) == 2, "ZIP fixture names were not patched exactly");
    Files.write(duplicateName, duplicateBytes);
    JsonObject duplicateNames = json.toJsonTree(ReaJadxBridge.nativeDeclarations(duplicateName)).getAsJsonObject();
    require(duplicateNames.getAsJsonObject("coverage").get("status").getAsString().equals("partial")
        && duplicateNames.getAsJsonObject("coverage").get("dex_entries").getAsInt() == 2
        && duplicateNames.getAsJsonArray("methods").isEmpty()
        && duplicateNames.getAsJsonArray("unknowns").toString().contains("Duplicate root DEX"),
        "Duplicate ZIP names acquired invented member identities");

    Path wrongCrc = apk.resolveSibling("native-wrong-crc.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(wrongCrc))) {
      zip.putNextEntry(new ZipEntry("classes.dex")); zip.write(dex); zip.closeEntry();
    }
    byte[] wrongCrcBytes = Files.readAllBytes(wrongCrc);
    int changedCrc = 0;
    for (int at = 0; at < wrongCrcBytes.length - 20; at++) {
      if (wrongCrcBytes[at] == 'P' && wrongCrcBytes[at + 1] == 'K'
          && wrongCrcBytes[at + 2] == 1 && wrongCrcBytes[at + 3] == 2) {
        wrongCrcBytes[at + 16] ^= 1; changedCrc++;
      }
    }
    require(changedCrc == 1, "CRC fixture did not alter exactly one central directory record");
    Files.write(wrongCrc, wrongCrcBytes);
    JsonObject wrongCrcResult = json.toJsonTree(ReaJadxBridge.nativeDeclarations(wrongCrc)).getAsJsonObject();
    require(wrongCrcResult.getAsJsonObject("coverage").get("status").getAsString().equals("partial")
        && wrongCrcResult.getAsJsonArray("methods").isEmpty()
        && wrongCrcResult.getAsJsonArray("unknowns").toString().contains("CRC32"),
        "A ZIP CRC mismatch acquired native declaration facts");

    // The bundled decoder would allocate the declared UTF-16 char count first.
    // Keep this bad declaration small enough for a failing guard regression to
    // stay bounded; the producing diagnostic proves admission precedes decoding.
    DexBackedDexFile original = new DexBackedDexFile(Opcodes.getDefault(), dex);
    String firstClass = original.getClassSection().get(0).getType();
    int stringIndex = original.getStringSection().indexOf(firstClass);
    int stringOffset = original.getBuffer().readSmallUint(original.getStringSection().getOffset(stringIndex));
    byte[] oversized = dex.clone();
    System.arraycopy(new byte[] { (byte) 0xc0, (byte) 0x84, 0x3d }, 0, oversized, stringOffset, 3); // 1,000,000
    Path oversizedString = apk.resolveSibling("native-oversized-string.apk");
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(oversizedString))) {
      zip.putNextEntry(new ZipEntry("classes.dex")); zip.write(oversized); zip.closeEntry();
    }
    JsonObject oversizedResult = json.toJsonTree(ReaJadxBridge.nativeDeclarations(oversizedString)).getAsJsonObject();
    require(oversizedResult.getAsJsonObject("coverage").get("status").getAsString().equals("partial")
        && oversizedResult.getAsJsonArray("unknowns").toString().contains("native decoding allowance"),
        "Oversized declared DEX string was not rejected at admission");
    Files.delete(duplicate); Files.delete(partial); Files.delete(duplicateName); Files.delete(oversizedString); Files.delete(wrongCrc);
    System.out.println("NATIVE_DECLARATION_REGRESSION_PASS raw=true native_only=true unicode=true overloads=true duplicate_dex=true partial=true no_source=true");
  }

  private static void verifyInitializers(SessionHolder holder, SessionConfig config,
      Constructor<?> constructor, Method handle, Path apk) throws Exception {
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(apk.toString(), config, continuation));
    Object bridge = constructor.newInstance(holder);
    verifyNativeDeclarations(handle, bridge, holder.current(), apk);
    verifyDefaultPackageSelectors(handle, bridge, holder.current());
    String[] classNames = { "fixture.InitializationPolicy", "fixture.MixedInitialization" };
    String[][] witnesses = {
        { "declared-policy", "->singletonList", "->POLICY:Ljava/util/List;" },
        { "field-value", "->LABEL:Ljava/lang/String;", "->touch()V" }
    };
    for (int index = 0; index < classNames.length; index++) {
      JsonObject summary = call(handle, bridge, "get_class_summary", arguments(classNames[index]));
      JsonObject input = methodArguments(classNames[index], "<clinit>");
      JsonObject body = call(handle, bridge, "get_method_body", input);
      String text = body.get("body").getAsString();
      for (String witness : witnesses[index]) require(text.contains(witness), "Missing initializer instruction: " + witness);
      require(body.get("mode").getAsString().equals("smali"), "Static initializer must preserve DEX instructions");
      require(body.get("fell_back").getAsBoolean(), "Disassembly fallback was not reported");
      require(body.getAsJsonArray("markers").contains(new JsonPrimitive("static_initializer_disassembly")),
          "Static initializer representation reason was not reported");
      require(text.contains(".method static constructor <clinit>()V") && text.contains(".end method"),
          "Initializer method boundaries missing");
      require(body.get("overload_index").getAsInt() == 0 && body.get("overload_count").getAsInt() == 1,
          "Initializer identity changed");
      require(body.equals(call(handle, bridge, "get_method_body", input)), "Repeated initializer body changed");
      require(summary.equals(call(handle, bridge, "get_class_summary", arguments(classNames[index]))),
          "Frozen initializer metadata changed after source generation");
    }
    for (String name : List.of("missing", "originalNative")) {
      JsonObject body = call(handle, bridge, "get_method_body", methodArguments(classNames[0], name));
      String text = body.get("body").getAsString();
      require(body.get("mode").getAsString().equals("java") && !text.contains("{") && !text.contains(".method"),
          "Executable body was fabricated for " + name + ": " + text);
    }
    JsonObject ordinary = call(handle, bridge, "get_method_body", methodArguments(classNames[1], "touch"));
    require(ordinary.get("mode").getAsString().equals("java") && ordinary.get("body").getAsString().contains("COUNT"),
        "Ordinary executable method no longer produces Java");
    verifyNoBodyMethods(handle, bridge, holder.current());
    verifyMergedMethods(handle, bridge);
    verifyConstantFields(handle, bridge, holder.current());
    verifyRawMemberNames(handle, bridge);

    SessionConfig bounded = new SessionConfig(96, 0, 90000L, 1, List.of(), List.of(), 64, ResourceMode.FULL);
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(apk.toString(), bounded, continuation));
    JsonObject partial = call(handle, constructor.newInstance(holder), "get_method_body",
        methodArguments(classNames[0], "<clinit>"));
    require(partial.get("mode").getAsString().equals("smali")
        && partial.get("body").getAsString().contains("[truncated: exceeds 96 bytes, total "),
        "Static initializer ignored the source byte limit or omitted its truncation marker");
    String prefix = partial.get("body").getAsString().split("\n\n\\.\\.\\. \\[truncated:", 2)[0];
    require(prefix.getBytes(StandardCharsets.UTF_8).length <= 96, "Initializer text exceeded its byte limit");
    SessionConfig tiny = new SessionConfig(16, 0, 90000L, 1, List.of(), List.of(), 64, ResourceMode.FULL);
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(apk.toString(), tiny, continuation));
    JsonObject missing = call(handle, constructor.newInstance(holder), "get_method_body",
        methodArguments("fixture.MergedMethod", "highlightText"));
    require(missing.get("mode").getAsString().equals("smali")
        && missing.get("body").getAsString().contains("[truncated: exceeds 16 bytes, total ")
        && missing.getAsJsonArray("markers").contains(new JsonPrimitive("java_body_unavailable")),
        "Missing Java was interpreted after applying source limits: " + missing);
    System.out.println("INITIALIZER_REGRESSION_PASS folded=2 bounded=true");
  }

  private static void verifyConstantFields(Method handle, Object bridge, JadxSession session) throws Exception {
    Map<String, String> encoded = Map.of(
        "ENABLED", "{\"type\":\"boolean\",\"value\":true}",
        "LETTER", "{\"type\":\"char\",\"value\":65}",
        "MAX_SIZE", "{\"type\":\"int\",\"value\":1024}",
        "PACKET_FLAG_CONFIG", "{\"type\":\"long\",\"value\":\"-9223372036854775808\"}",
        "RATIO", "{\"type\":\"double\",\"value\":\"0.5\"}",
        "SCALE", "{\"type\":\"float\",\"value\":\"1.5\"}",
        "SMALL", "{\"type\":\"byte\",\"value\":127}",
        "TAG", "{\"type\":\"string\",\"value\":\"flags\"}",
        "WIDE", "{\"type\":\"short\",\"value\":32767}");
    // Null, unencoded, non-final and instance fields have no reportable DEX static value.
    Set<String> absent = Set.of("NOTHING", "INSTANCE", "COUNTER", "width");
    JsonObject valuesInput = arguments("fixture.ConstantFields");
    valuesInput.addProperty("dex_static_values", true);
    JsonObject summary = call(handle, bridge, "get_class_summary", valuesInput);
    ClassNode node = session.getClasses().stream()
        .filter(cls -> cls.getFullName().equals("fixture.ConstantFields"))
        .findFirst().orElseThrow().getClassNode();
    require(node.getState() == ProcessState.NOT_LOADED, "Constant field metadata generated source");
    JsonArray fields = summary.getAsJsonArray("fields");
    require(fields.size() == encoded.size() + absent.size(), "Constant field inventory changed: " + fields);
    for (JsonElement entry : fields) {
      JsonObject field = entry.getAsJsonObject();
      String name = field.get("name").getAsString();
      require(encoded.containsKey(name) || absent.contains(name), "Unexpected field: " + name);
      JsonElement value = field.get("dex_static_value");
      require(encoded.containsKey(name) ? JsonParser.parseString(encoded.get(name)).equals(value) : value == null,
          "Wrong DEX static value for " + name + ": " + field);
    }
    // Fields assigned only by <clinit> carry a JADX null placeholder, not a DEX value.
    for (String[] assigned : new String[][] {
        { "fixture.InitializationPolicy", "POLICY" }, { "fixture.MixedInitialization", "LABEL" } }) {
      JsonObject assignedInput = arguments(assigned[0]);
      assignedInput.addProperty("dex_static_values", true);
      for (JsonElement entry : call(handle, bridge, "get_class_summary", assignedInput)
          .getAsJsonArray("fields")) {
        JsonObject field = entry.getAsJsonObject();
        if (field.get("name").getAsString().equals(assigned[1]))
          require(!field.has("dex_static_value"), "Initializer-assigned field reported a value: " + field);
      }
    }
    require(summary.equals(call(handle, bridge, "get_class_summary", valuesInput)),
        "Repeated constant field summary changed");
    // Method and reference lookups omit the flag and must get the member-only summary.
    JsonObject members = call(handle, bridge, "get_class_summary", arguments("fixture.ConstantFields"));
    JsonObject stripped = summary.deepCopy();
    for (JsonElement entry : stripped.getAsJsonArray("fields")) entry.getAsJsonObject().remove("dex_static_value");
    require(members.equals(stripped), "Default class summary carried DEX static values: " + members);
    JsonObject explicitOff = arguments("fixture.ConstantFields");
    explicitOff.addProperty("dex_static_values", false);
    require(members.equals(call(handle, bridge, "get_class_summary", explicitOff)),
        "dex_static_values=false returned DEX static values");
    JsonObject malformed = arguments("fixture.ConstantFields");
    malformed.addProperty("dex_static_values", "true");
    boolean refused = false;
    try { call(handle, bridge, "get_class_summary", malformed); }
    catch (AssertionError failure) { refused = failure.getCause() instanceof IllegalArgumentException; }
    require(refused, "Non-boolean dex_static_values was accepted");
    System.out.println("CONSTANT_FIELD_REGRESSION_PASS encoded=" + encoded.size() + " absent=" + absent.size()
        + " opt_in=true");
  }

  /** Mapping lookups need raw DEX names and types even where JADX displays an alias. */
  private static void verifyRawMemberNames(Method handle, Object bridge) throws Exception {
    JsonObject summary = call(handle, bridge, "get_class_summary", arguments("fixture.RenamedMembers"));
    Map<String, List<JsonObject>> methods = new HashMap<>();
    for (JsonElement entry : summary.getAsJsonArray("methods")) {
      JsonObject method = entry.getAsJsonObject();
      methods.computeIfAbsent(method.get("raw_name").getAsString(), ignored -> new ArrayList<>()).add(method);
    }
    List<JsonObject> reserved = methods.getOrDefault("do", List.of());
    require(reserved.size() == 1 && !reserved.get(0).get("name").getAsString().equals("do")
        && reserved.get(0).get("dex_descriptor").getAsString().equals("()V"),
        "Reserved-word method lost its raw DEX name: " + summary);
    Set<String> overloads = new HashSet<>();
    for (JsonObject method : methods.getOrDefault("a", List.of()))
      overloads.add(method.get("dex_descriptor").getAsString());
    require(overloads.equals(Set.of("(I)V", "(Ljava/lang/String;)V")),
        "Same-name overloads lost their raw identity: " + summary);
    JsonArray fields = summary.getAsJsonArray("fields");
    require(fields.size() == 1, "Renamed field inventory changed: " + fields);
    JsonObject field = fields.get(0).getAsJsonObject();
    require(field.get("raw_name").getAsString().equals("if") && !field.get("name").getAsString().equals("if")
        && field.get("dex_type").getAsString().equals("I"), "Reserved-word field lost its raw DEX identity: " + field);
    require(summary.getAsJsonArray("inner_class_raw_names").equals(JsonParser.parseString("[\"fixture.RenamedMembers$a\"]"))
        && summary.getAsJsonArray("inner_classes").size() == 1, "Inner class raw name was not reported: " + summary);
    System.out.println("RAW_MEMBER_NAME_REGRESSION_PASS reserved=true overloads=2 inner=true");
  }

  private static void verifyMergedMethods(Method handle, Object bridge) throws Exception {
    JsonObject input = methodArguments("fixture.MergedMethod", "highlightText");
    JsonObject body = call(handle, bridge, "get_method_body", input);
    String text = body.get("body").getAsString();
    require(body.get("mode").getAsString().equals("smali") && body.get("fell_back").getAsBoolean(),
        "Merged method did not recover original instructions: " + body);
    require(body.get("dex_descriptor").getAsString().equals("()V")
        && body.get("overload_count").getAsInt() == 2, "Merged method identity changed");
    require(body.getAsJsonArray("markers").contains(new JsonPrimitive("java_body_unavailable")),
        "Missing Java reason was not reported");
    require(text.startsWith(".method private highlightText()V") && text.endsWith(".end method")
        && text.contains("0x77") && text.contains("if-nez") && text.contains(".catch")
        && !text.contains("highlightText(I)V") && !text.contains("0x2a") && !text.contains("renamed from:"),
        "Disassembly lost branches/handlers or included another method: " + text);
    JsonObject overloaded = methodArguments("fixture.MergedMethod", "highlightText");
    overloaded.addProperty("overload_index", 1);
    JsonObject other = call(handle, bridge, "get_method_body", overloaded);
    require(other.get("dex_descriptor").getAsString().equals("(I)V")
        && other.get("body").getAsString().contains("42"), "Concrete overload lost its own implementation: " + other);
    require(body.equals(call(handle, bridge, "get_method_body", input)), "Repeated raw-method recovery changed");
    verifySmaliSelection(bridge.getClass());
    System.out.println("MERGED_METHOD_REGRESSION_PASS exact=true overloaded=true handlers=true");
  }

  private static void verifySmaliSelection(Class<?> bridge) throws Exception {
    Method select = bridge.getDeclaredMethod("selectMethodSmali", JadxSession.MethodSmali.class, String.class);
    select.setAccessible(true);
    String selected = ".method private highlightText()V\n    return-void\n.end method";
    String other = ".method private highlightText(I)V\n    # highlightText()V\n    return-void\n.end method";
    String incomplete = ".method private highlightText()V\n    return-void";
    require(select.invoke(null, new JadxSession.MethodSmali("highlightText", List.of(other, selected), true, null),
        "highlightText()V").equals(selected), "Body text or overload order selected a method");
    for (List<String> blocks : List.of(List.<String>of(), List.of(other), List.of(selected, selected),
        List.of(incomplete), List.of(selected, incomplete), List.of(incomplete, selected))) {
      try {
        select.invoke(null, new JadxSession.MethodSmali("highlightText", blocks, true, null), "highlightText()V");
        throw new AssertionError("Unproven disassembly identity or completeness was accepted");
      } catch (InvocationTargetException failure) {
        require(failure.getCause() instanceof IllegalArgumentException,
            "Disassembly uncertainty lost its failure reason");
      }
    }
    String reason = "smali generation failed: controlled timeout";
    try {
      select.invoke(null, new JadxSession.MethodSmali("highlightText", List.of(), false, reason), "highlightText()V");
      throw new AssertionError("Disassembly generation failure was accepted");
    } catch (InvocationTargetException failure) {
      require(failure.getCause() instanceof IllegalArgumentException
          && failure.getCause().getMessage().contains(reason), "Original disassembly failure reason was lost");
    }
  }

  private static void verifyNoBodyMethods(Method handle, Object bridge, JadxSession session) throws Exception {
    String[][] cases = {
        { "fixture.NativeOverload", "readBuffer", "native_method" },
        { "fixture.AbstractShape", "area", "abstract_method" },
        { "fixture.NativeOverload", "zLastNative", "native_method" }
    };
    for (String[] selected : cases) {
      JsonObject input = methodArguments(selected[0], selected[1]);
      ClassNode owner = session.getClasses().stream().filter(cls -> cls.getFullName().equals(selected[0]))
          .findFirst().orElseThrow().getClassNode();
      ProcessState beforeState = owner.getState();
      JsonObject before = call(handle, bridge, "get_method_body", input);
      require(owner.getState() == beforeState, "No-code inspection generated class source");
      require(before.get("body").getAsString().isEmpty(), "No-code method included source: " + before);
      require(before.get("mode").getAsString().equals("java") && !before.get("fell_back").getAsBoolean(),
          "No-code method claimed disassembly or fallback: " + before);
      require(before.getAsJsonArray("markers").equals(JsonParser.parseString("[\"" + selected[2] + "\"]")),
          "No-code method lost its parsed access-flag reason: " + before);
      boolean nativeClass = selected[0].equals("fixture.NativeOverload");
      JsonObject executable = methodArguments(selected[0], nativeClass ? "readBuffer" : "describe");
      if (nativeClass) executable.addProperty("overload_index", 1);
      String text = call(handle, bridge, "get_method_body", executable).get("body").getAsString();
      require(nativeClass ? text.contains("readBuffer(byteBuffer, 0)") : text.contains("neighbour-member"),
          "Executable neighbour lost its own source: " + text);
      require(before.equals(call(handle, bridge, "get_method_body", input)),
          "Code generation changed the frozen body-absence fact");
    }
    System.out.println("NO_BODY_REGRESSION_PASS native=true abstract=true frozen=true");
  }

  private static void verifyLoadFailures() {
    for (String reason : new String[]{"Java heap space", "GC overhead limit exceeded", "Metaspace", "", null}) {
      Object projected = ReaJadxBridge.loadResult(kotlin.ResultKt.createFailure(new OutOfMemoryError(reason)));
      CallToolResult response = (CallToolResult) projected;
      require(Boolean.TRUE.equals(response.isError()), "Memory failure became success");
      JsonObject failure = JsonParser.parseString(((TextContent) response.getContent().get(0)).getText())
          .getAsJsonObject();
      require(failure.get("kind").getAsString().equals("jvm-memory-failure"), "Lost memory tag");
      require(reason == null ? !failure.has("message") : failure.get("message").getAsString().equals(reason),
          "Lost JVM reason or invented one");
      require(failure.get("max_heap_bytes").getAsLong() == Runtime.getRuntime().maxMemory(),
          "Configured heap substituted for observed heap");
      boolean heap = "Java heap space".equals(reason) || "GC overhead limit exceeded".equals(reason);
      require(failure.get("memory_area").getAsString().equals(heap ? "heap" : "unknown"),
          "Unknown memory region became heap");
    }
    Object cancellation = kotlin.ResultKt.createFailure(new java.util.concurrent.CancellationException("cancel"));
    require(ReaJadxBridge.loadResult(cancellation) == cancellation, "Cancellation was stringified");
    Object fatal = kotlin.ResultKt.createFailure(new AssertionError("fatal"));
    require(ReaJadxBridge.loadResult(fatal) == fatal, "Fatal error was stringified");
    String decoy = "cannot read /inputs/Java heap space.apk";
    CallToolResult ordinary = (CallToolResult) ReaJadxBridge.loadResult(
        kotlin.ResultKt.createFailure(new IllegalArgumentException(decoy)));
    require(((TextContent) ordinary.getContent().get(0)).getText().equals("load failed: " + decoy),
        "Ordinary exception text became memory evidence");
    var loaded = new SessionHolder.LoadResult("/selected.apk", 2, 3, 4, 5L, 90000L,
        1, 64, "full", List.of("selected"), List.of("excluded"));
    var completions = new ArrayList<Object>();
    kotlin.coroutines.Continuation<CallToolResult> receiver = new kotlin.coroutines.Continuation<>() {
      public kotlin.coroutines.CoroutineContext getContext() { return EmptyCoroutineContext.INSTANCE; }
      public void resumeWith(Object result) { completions.add(result); }
    };
    Object immediate = ReaJadxBridge.loadCall(next -> loaded, receiver);
    require(immediate instanceof CallToolResult && completions.isEmpty(), "Immediate completion resumed twice");
    JsonObject success = JsonParser.parseString(((TextContent) ((CallToolResult) immediate)
        .getContent().get(0)).getText()).getAsJsonObject();
    require(success.get("apk_path").getAsString().equals("/selected.apk")
        && success.get("raw_class_count").getAsInt() == 3
        && success.getAsJsonArray("include_packages").get(0).getAsString().equals("selected")
        && success.getAsJsonArray("exclude_packages").get(0).getAsString().equals("excluded"),
        "Load response lost source facts or selected filters");
    Object thrown = ReaJadxBridge.loadCall(next -> { throw new OutOfMemoryError("Java heap space"); }, receiver);
    require(thrown instanceof CallToolResult && completions.isEmpty(), "Synchronous failure resumed twice");
    var pending = new ArrayList<kotlin.coroutines.Continuation<SessionHolder.LoadResult>>();
    Object suspended = ReaJadxBridge.loadCall(next -> {
      require(next.getContext() == receiver.getContext(), "Coroutine context changed");
      pending.add(next);
      return kotlin.coroutines.intrinsics.IntrinsicsKt.getCOROUTINE_SUSPENDED();
    }, receiver);
    require(suspended == kotlin.coroutines.intrinsics.IntrinsicsKt.getCOROUTINE_SUSPENDED(),
        "Suspension became completion");
    require(completions.isEmpty(), "Suspension completed early");
    pending.get(0).resumeWith(cancellation);
    require(completions.size() == 1 && completions.get(0) == cancellation, "Late cancellation changed");
    for (Object outcome : List.of(loaded,
        kotlin.ResultKt.createFailure(new OutOfMemoryError("Java heap space")))) {
      pending.clear();
      completions.clear();
      ReaJadxBridge.loadCall(next -> {
        pending.add(next);
        return kotlin.coroutines.intrinsics.IntrinsicsKt.getCOROUTINE_SUSPENDED();
      }, receiver);
      pending.get(0).resumeWith(outcome);
      require(completions.size() == 1 && completions.get(0) instanceof CallToolResult,
          "Late success or memory failure was not delivered once");
    }
    int[] callbacks = {0};
    var downstreamFailure = new IllegalStateException("downstream rejected completion");
    kotlin.coroutines.Continuation<CallToolResult> throwing = new kotlin.coroutines.Continuation<>() {
      public kotlin.coroutines.CoroutineContext getContext() { return EmptyCoroutineContext.INSTANCE; }
      public void resumeWith(Object result) { callbacks[0]++; throw downstreamFailure; }
    };
    try {
      ReaJadxBridge.loadCall(next -> {
        next.resumeWith(loaded);
        return kotlin.coroutines.intrinsics.IntrinsicsKt.getCOROUTINE_SUSPENDED();
      }, throwing);
      throw new AssertionError("Inline consumer exception became a second completion");
    } catch (IllegalStateException failure) {
      require(failure == downstreamFailure && callbacks[0] == 1, "Inline continuation resumed twice");
    }
    System.out.println("LOAD_FAILURE_REGRESSION_PASS typed=true decoy=true suspension=true cancellation=true");
  }

  public static void main(String[] args) throws Exception {
    verifyLoadFailures();
    if (args.length == 1 && args[0].equals("--load-failures")) return;
    SessionConfig config = new SessionConfig(1048576, 0, 90000L, 1, List.of(), List.of(), 64, ResourceMode.FULL);
    SessionHolder holder = new SessionHolder(config);
    try {
      Class<?> bridgeType = Class.forName("ReaJadxBridge");
      Constructor<?> constructor = bridgeType.getDeclaredConstructor(SessionHolder.class);
      constructor.setAccessible(true);
      Object bridge = constructor.newInstance(holder);
      Method handle = bridgeType.getDeclaredMethod("handle", String.class, kotlinx.serialization.json.JsonObject.class);
      handle.setAccessible(true);
      Path initializerApk = initializerFixture(args[1], args[2]);
      require(holder.current() == null, "Cold native inventory unexpectedly has a loaded APK");
      JsonObject coldNative = call(handle, bridge, "rea_native_declarations", nativeArguments(initializerApk));
      require(holder.current() == null, "Native declaration inventory loaded/decompiled the APK");
      require(coldNative.getAsJsonObject("coverage").get("status").getAsString().equals("complete")
          && nativeIdentities(coldNative).size() == 8
          && nativeIdentities(coldNative).contains("fixture.Native_原.do()V"),
          "Cold native inventory lost raw source declarations");
      System.out.println("NATIVE_DECLARATION_COLD_PASS no_apk_load=true raw=true");
      BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
          (scope, continuation) -> holder.load(args[0], config, continuation));
      JadxSession session = holder.current();
      require(session != null && !session.getClasses().isEmpty(), "Fixture did not load classes");
      JadxDecompiler decompiler = session.getClasses().get(0).getClassNode().root().getDecompiler();
      IdentityHashMap<ClassNode, ProcessState> states = new IdentityHashMap<>();
      for (ClassNode node : decompiler.getRoot().getClasses()) {
        require(node.getState() == ProcessState.NOT_LOADED, "Fixture unexpectedly generated source");
        states.put(node, node.getState());
      }
      verifyClassPages(handle, bridge, session.getClassFqns());
      verifyRawClassSelectors(handle, bridge, decompiler);
      JsonObject apiArgs = arguments("io.appium.android.apis.ApiDemos");
      JsonObject apiSummary = call(handle, bridge, "get_class_summary", apiArgs);
      for (var entry : states.entrySet()) require(entry.getKey().getState() == entry.getValue(),
          "Metadata generated source: " + entry.getKey().getRawName());
      require(states.size() == decompiler.getRoot().getClasses().size(), "Metadata changed class inventory");
      require(apiSummary.getAsJsonArray("fields").get(0).getAsJsonObject().get("type").getAsString().contains("Comparator"),
          "Generic field type was truncated");
      JsonObject componentArgs = arguments("androidx.activity.ComponentActivity");
      JsonObject componentSummary = call(handle, bridge, "get_class_summary", componentArgs);
      List<String> signatures = new ArrayList<>();
      List<String> descriptors = new ArrayList<>();
      for (JsonElement entry : componentSummary.getAsJsonArray("methods")) {
        JsonObject method = entry.getAsJsonObject();
        if (method.get("name").getAsString().equals("setContentView")) {
          signatures.add(method.get("signature").getAsString());
          descriptors.add(method.get("dex_descriptor").getAsString());
        }
      }
      require(signatures.size() == 3, "Fixture must contain three setContentView overloads");
      require(descriptors.equals(List.of("(I)V", "(Landroid/view/View;)V",
          "(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V")),
          "Frozen DEX prototypes did not identify the three overloads: " + descriptors);
      String[] declarations = { "setContentView(int ", "setContentView(View ", "setContentView(View view, ViewGroup.LayoutParams " };
      List<Integer> referenceCounts = new ArrayList<>();
      for (int index = 0; index < signatures.size(); index++) {
        JsonObject methodArgs = arguments("androidx.activity.ComponentActivity");
        methodArgs.addProperty("method_name", "setContentView");
        methodArgs.addProperty("overload_index", index);
        JsonObject first = call(handle, bridge, "get_method_body", methodArgs);
        require(first.equals(call(handle, bridge, "get_method_body", methodArgs)), "Repeated body changed");
        require(first.get("overload_index").getAsInt() == index && first.get("overload_count").getAsInt() == 3,
            "Overload envelope mismatch");
        require(first.get("mode").getAsString().equals("java"), "Fixture did not produce Java");
        require(first.get("body").getAsString().contains(declarations[index]), "Wrong overload: " + signatures.get(index));
        JsonObject references = call(handle, bridge, "get_xrefs_to_method", methodArgs);
        require(references.get("overload_index").getAsInt() == index,
            "Reference result did not preserve selected overload index");
        require(references.get("reported_signature").getAsString().equals(signatures.get(index)),
            "Reference result did not preserve selected overload signature");
        if (index == 0) {
          JsonArray invokes = references.getAsJsonArray("items").get(0).getAsJsonObject()
              .getAsJsonArray("direct_invokes");
          require(invokes.size() == 1, "Selected overload must have one raw direct invoke");
          JsonObject invoke = invokes.get(0).getAsJsonObject();
          require(invoke.get("source_raw_method_id").getAsString()
              .equals("androidx.activity.ComponentActivity.onCreate(Landroid/os/Bundle;)V"),
              "Wrong source method for overloaded target");
          require(invoke.get("dex_code_unit_offset").getAsInt() == 37
              && invoke.get("opcode").getAsString().equals("INVOKE_VIRTUAL"),
              "Wrong direct invoke for selected overloaded target");
        }
        referenceCounts.add(references.get("count").getAsInt());
      }
      require(referenceCounts.equals(List.of(1, 0, 0)),
          "Incoming references were not isolated to the selected overload: " + referenceCounts);
      require(componentSummary.equals(call(handle, bridge, "get_class_summary", componentArgs)),
          "Frozen summary changed after code generation");
      require(apiSummary.equals(call(handle, bridge, "get_class_summary", apiArgs)), "Unrelated frozen summary changed");
      System.out.println("METADATA_REGRESSION_PASS classes=" + states.size() + " overloads=" + signatures.size()
          + " reference_counts=" + referenceCounts);
      verifyInitializers(holder, config, constructor, handle, initializerApk);
      verifyDirectInvokes(holder, config, constructor, handle,
          Path.of(args[3]), Path.of(args[2]));
      verifyRootManifests(holder, config, constructor, handle, Path.of(args[2]));
    } finally {
      BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
          (scope, continuation) -> holder.unload(continuation));
    }
  }
}
