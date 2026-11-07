import com.atxx.jhmcp.*;
import com.android.tools.smali.smali.Smali;
import com.android.tools.smali.smali.SmaliOptions;
import com.google.gson.*;
import io.modelcontextprotocol.kotlin.sdk.types.CallToolResult;
import io.modelcontextprotocol.kotlin.sdk.types.TextContent;
import jadx.core.dex.nodes.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlinx.coroutines.BuildersKt;

/** Audited engine, real DEX instructions, no APK execution or simulated provider. */
public class ReaJadxExternalReferencesRegression {
  private static final String API = "android.app.NotificationManager";
  private static final String INT_PROTO = "(ILandroid/app/Notification;)V";
  private static final String STRING_PROTO = "(Ljava/lang/String;ILandroid/app/Notification;)V";

  private static void require(boolean value, String reason) {
    if (!value) throw new AssertionError(reason);
  }

  private static JsonObject args(String className, String methodName, Integer index) {
    JsonObject args = new JsonObject();
    args.addProperty("class_name", className);
    if (methodName != null) args.addProperty("method_name", methodName);
    if (index != null) args.addProperty("overload_index", index);
    return args;
  }

  private static JsonObject external(Integer index) {
    JsonObject value = args(API, "notify", index);
    value.addProperty("reference_target", true);
    return value;
  }

  private static JsonObject call(Method handle, Object bridge, String name, JsonObject args)
      throws Exception {
    var input = (kotlinx.serialization.json.JsonObject)
        kotlinx.serialization.json.Json.Default.parseToJsonElement(args.toString());
    CallToolResult result = (CallToolResult) handle.invoke(bridge, name, input);
    require(!Boolean.TRUE.equals(result.isError()), name + " returned error");
    require(result.getContent().size() == 1 && result.getContent().get(0) instanceof TextContent,
        "Unexpected bridge envelope");
    return JsonParser.parseString(((TextContent) result.getContent().get(0)).getText()).getAsJsonObject();
  }

  private static void refused(Method handle, Object bridge, String name, JsonObject args,
      String field) throws Exception {
    try {
      call(handle, bridge, name, args);
      throw new AssertionError("Unexpected accepted selector: " + args);
    } catch (InvocationTargetException expected) {
      Throwable cause = expected.getCause();
      require(cause.getClass().getSimpleName().equals("InputFailure"), "Not an input failure: " + cause);
      Field actual = cause.getClass().getDeclaredField("field");
      actual.setAccessible(true);
      require(field.equals(actual.get(cause)), "Wrong selector failure field");
    }
  }

  private static void assemble(Path output, List<Path> sources) throws Exception {
    SmaliOptions options = new SmaliOptions();
    options.apiLevel = 28;
    options.jobs = 1;
    options.outputDexFile = output.toString();
    require(Smali.assemble(options, sources.stream().map(Path::toString).toList()), "Assembly failed");
  }

  private static Path apk(Path output, String name, List<Path> dexFiles) throws Exception {
    Path apk = output.resolve(name);
    try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(apk))) {
      for (int index = 0; index < dexFiles.size(); index++) {
        ZipEntry entry = new ZipEntry(index == 0 ? "classes.dex" : "classes" + (index + 1) + ".dex");
        entry.setTime(0);
        zip.putNextEntry(entry);
        Files.copy(dexFiles.get(index), zip);
        zip.closeEntry();
      }
    }
    return apk;
  }

  private static List<Path> fixtures(Path sources, Path output) throws Exception {
    Path single = output.resolve("external-single.dex");
    Path primary = output.resolve("external-primary.dex");
    Path secondary = output.resolve("external-secondary.dex");
    assemble(single, List.of(sources.resolve("Target.smali"), sources.resolve("Outer.smali"),
        sources.resolve("Caller.smali"), sources.resolve("Nested.smali")));
    assemble(primary, List.of(sources.resolve("Target.smali"), sources.resolve("Outer.smali")));
    assemble(secondary, List.of(sources.resolve("Caller.smali"), sources.resolve("Nested.smali")));
    return List.of(apk(output, "external-invokes.apk", List.of(single)),
        apk(output, "external-invokes-multidex.apk", List.of(primary, secondary)));
  }

  private static void verify(SessionHolder holder, SessionConfig config, Constructor<?> constructor,
      Method handle, Path apk, String dexEntry) throws Exception {
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(apk.toString(), config, continuation));
    Object bridge = constructor.newInstance(holder);
    var root = holder.current().getClasses().get(0).getClassNode().root();
    IdentityHashMap<ClassNode, ProcessState> states = new IdentityHashMap<>();
    for (ClassNode cls : root.getClasses(true)) states.put(cls, cls.getState());
    JsonObject summary = call(handle, bridge, "get_class_summary", external(null));
    require(summary.get("observed_method_count").getAsInt() == 2, "Lost observed prototypes");
    require(!summary.has("fields") && !summary.has("field_count"), "External class definition was invented");
    JsonArray prototypes = summary.getAsJsonArray("prototypes");
    Method inventory = bridge.getClass().getDeclaredMethod("externalMethods", JsonObject.class);
    inventory.setAccessible(true);
    Object retained = inventory.invoke(bridge, external(null));
    require(retained == inventory.invoke(bridge, external(null)),
        "External summary and references rebuilt the same validated prototype inventory");
    require(prototypes.get(0).getAsJsonObject().get("dex_descriptor").getAsString().equals(INT_PROTO)
        && prototypes.get(1).getAsJsonObject().get("dex_descriptor").getAsString().equals(STRING_PROTO),
        "Observed overload identities or order changed");
    refused(handle, bridge, "get_xrefs_to_method", external(null), "overload_index");
    refused(handle, bridge, "get_xrefs_to_method", external(2), "overload_index");
    refused(handle, bridge, "get_class_summary", args(API, null, null), "class_name");
    JsonObject missing = external(null);
    missing.addProperty("method_name", "notPresent");
    refused(handle, bridge, "get_class_summary", missing, "method_name");
    JsonObject references = call(handle, bridge, "get_xrefs_to_method", external(0));
    require(references.get("count").getAsInt() == 3, "Wrong using-node inventory");
    require(references.get("reference_scope").getAsString().equals("direct_dex_invokes"), "Missing scope");
    Set<Integer> callerOverloads = new HashSet<>();
    List<JsonObject> selectors = new ArrayList<>();
    int sites = 0;
    for (JsonElement item : references.getAsJsonArray("items")) {
      JsonObject caller = item.getAsJsonObject();
      JsonObject selector = caller.getAsJsonObject("source_selector");
      selectors.add(selector);
      if (selector.get("class_name").getAsString().equals("fixture.Caller"))
        callerOverloads.add(selector.get("overload_index").getAsInt());
      require(caller.get("direct_invokes_exhaustive").getAsBoolean(), "Fixture offsets were truncated");
      for (JsonElement direct : caller.getAsJsonArray("direct_invokes")) {
        sites++;
        JsonObject site = direct.getAsJsonObject();
        require(site.get("dex_entry").getAsString().equals(dexEntry), "Lost source DEX carrier");
        require(site.get("source_raw_method_id").getAsString().contains("notify"), "Lost raw caller identity");
      }
    }
    require(sites == 4 && callerOverloads.equals(Set.of(0, 1)), "Repeated or overloaded callers lost");
    for (var state : states.entrySet()) require(state.getKey().getState() == state.getValue(),
        "External reference scan generated source: " + state.getKey().getRawName());
    for (JsonObject selector : selectors) {
      JsonObject body = call(handle, bridge, "get_method_body", selector);
      require(!body.get("body").getAsString().isEmpty(), "Caller selector did not produce a body");
    }
    require(references.equals(call(handle, bridge, "get_xrefs_to_method", external(0))),
        "Caller identities changed after source generation");
    require(call(handle, bridge, "get_xrefs_to_method", external(1)).get("count").getAsInt() == 1,
        "Other prototype references mixed with int overload");
    JsonObject control = call(handle, bridge, "get_xrefs_to_method", args("fixture.Target", "mark", 0));
    require(control.get("count").getAsInt() == 1, "Defined target reference behavior changed");
    Object priorSessionInventory = inventory.invoke(bridge, external(null));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(apk.toString(), config, continuation));
    require(priorSessionInventory != inventory.invoke(bridge, external(null)),
        "Replaced session reused a prior APK prototype inventory");
    require(references.equals(call(handle, bridge, "get_xrefs_to_method", external(0))),
        "Session replacement changed exact caller facts");
  }

  private static Path largeFixture(Path output) throws Exception {
    Path source = output.resolve("LargeExternalCaller.smali");
    StringBuilder text = new StringBuilder(".class public Lfixture/LargeExternalCaller;\n.super Ljava/lang/Object;\n");
    for (int index = 0; index < 220; index++) {
      text.append(".method public static call").append(index).append("_").append("x".repeat(2000))
          .append("(Landroid/app/NotificationManager;Landroid/app/Notification;I)V\n.registers 3\n")
          .append("invoke-virtual {p0, p2, p1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V\n")
          .append("return-void\n.end method\n");
    }
    Files.writeString(source, text, StandardCharsets.UTF_8);
    Path dex = output.resolve("external-large.dex");
    assemble(dex, List.of(source));
    return apk(output, "external-invokes-large.apk", List.of(dex));
  }

  private static Path siteHeavyFixture(Path output) throws Exception {
    String invoke = "invoke-virtual {p0, p2, p1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V\n";
    String parameters = "(Landroid/app/NotificationManager;Landroid/app/Notification;I)V\n.registers 3\n";
    Path heavy = output.resolve("AHeavy.smali");
    Files.writeString(heavy, ".class public Lfixture/AHeavy;\n.super Ljava/lang/Object;\n"
        + ".method public static call" + parameters + invoke.repeat(10000)
        + "return-void\n.end method\n", StandardCharsets.UTF_8);
    Path shortCallers = output.resolve("ZShort.smali");
    StringBuilder text = new StringBuilder(".class public Lfixture/ZShort;\n.super Ljava/lang/Object;\n");
    for (int index = 0; index < 10; index++)
      text.append(".method public static tail").append(index).append(parameters).append(invoke)
          .append("return-void\n.end method\n");
    Files.writeString(shortCallers, text, StandardCharsets.UTF_8);
    Path dex = output.resolve("external-site-heavy.dex");
    assemble(dex, List.of(heavy, shortCallers));
    return apk(output, "external-invokes-site-heavy.apk", List.of(dex));
  }

  private static Path oversizedPrototypeFixture(Path output) throws Exception {
    Path source = output.resolve("OversizedPrototype.smali");
    String parameter = "Lexternal/" + "a".repeat(12000) + ";";
    Files.writeString(source, ".class public Lfixture/OversizedPrototype;\n.super Ljava/lang/Object;\n"
        + ".method public static call()V\n.registers 240\n"
        + "invoke-static/range {v0 .. v239}, Lexternal/Library;->wide(" + parameter.repeat(240) + ")V\n"
        + "return-void\n.end method\n", StandardCharsets.UTF_8);
    Path dex = output.resolve("external-oversized-prototype.dex");
    assemble(dex, List.of(source));
    return apk(output, "external-oversized-prototype.apk", List.of(dex));
  }

  private static void verifyPrototypeLimit(SessionHolder holder, SessionConfig config,
      Constructor<?> constructor, Method handle, Path apk) throws Exception {
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(apk.toString(), config, continuation));
    Object bridge = constructor.newInstance(holder);
    JsonObject selection = args("external.Library", "wide", null);
    selection.addProperty("reference_target", true);
    try {
      call(handle, bridge, "get_class_summary", selection);
      throw new AssertionError("Oversized external prototype was accepted");
    } catch (InvocationTargetException expected) {
      Throwable cause = expected.getCause();
      require(cause.getClass().getSimpleName().equals("ReferenceLimit"), "Not a typed prototype limit: " + cause);
      Field stage = cause.getClass().getDeclaredField("stage");
      stage.setAccessible(true);
      require("method_inventory".equals(stage.get(cause)), "Wrong prototype limit stage");
    }
    System.out.println("EXTERNAL_PROTOTYPE_LIMIT_PASS single_prototype=true typed_method_inventory=true");
  }

  private static void verifySiteBudget(SessionHolder holder, SessionConfig config,
      Constructor<?> constructor, Method handle, Path apk) throws Exception {
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.unload(continuation));
    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
        (scope, continuation) -> holder.load(apk.toString(), config, continuation));
    Object bridge = constructor.newInstance(holder);
    JsonObject references = call(handle, bridge, "get_xrefs_to_method", external(0));
    require(references.get("count").getAsInt() == 11, "Optional sites displaced mandatory caller rows");
    JsonArray callers = references.getAsJsonArray("items");
    JsonObject heavy = callers.get(0).getAsJsonObject();
    require(!heavy.get("direct_invokes_exhaustive").getAsBoolean()
        && heavy.getAsJsonArray("direct_invokes").size() < 10000, "Site-heavy caller was not partial");
    for (int index = 1; index < callers.size(); index++)
      require(callers.get(index).getAsJsonObject().get("containing_class").getAsString()
          .equals("fixture.ZShort"), "Later short caller identity was lost");
    require(references.toString().getBytes(StandardCharsets.UTF_8).length < 1048576,
        "External representation exceeded its reserved frame share");
    require(references.equals(call(handle, bridge, "get_xrefs_to_method", external(0))),
        "Partial-site replay changed the caller inventory");
    System.out.println("EXTERNAL_SITE_BUDGET_PASS callers=11 partial_sites=true bounded=true replay=true");
  }

  public static void main(String[] args) throws Exception {
    Path output = Path.of(args[1]);
    List<Path> fixtures = fixtures(Path.of(args[0]), output);
    largeFixture(output);
    Path siteHeavy = siteHeavyFixture(output);
    Path oversizedPrototype = oversizedPrototypeFixture(output);
    SessionConfig config = new SessionConfig(1048576, 0, 90000L, 1, List.of(), List.of(), 64, ResourceMode.FULL);
    SessionHolder holder = new SessionHolder(config);
    Class<?> type = Class.forName("ReaJadxBridge");
    Constructor<?> constructor = type.getDeclaredConstructor(SessionHolder.class);
    constructor.setAccessible(true);
    Method handle = type.getDeclaredMethod("handle", String.class, kotlinx.serialization.json.JsonObject.class);
    handle.setAccessible(true);
    try {
      verify(holder, config, constructor, handle, fixtures.get(0), "classes.dex");
      verify(holder, config, constructor, handle, fixtures.get(1), "classes2.dex");
      verifySiteBudget(holder, config, constructor, handle, siteHeavy);
      verifyPrototypeLimit(holder, config, constructor, handle, oversizedPrototype);
      System.out.println("EXTERNAL_REFERENCE_REGRESSION_PASS prototypes=2 using_nodes=3 sites=4 overloaded_callers=true nested=true multidex=true no_source=true post_codegen=true");
    } finally {
      BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE,
          (scope, continuation) -> holder.unload(continuation));
    }
  }
}
