import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.DataType;
import ghidra.program.model.listing.Program;
import ghidra.util.exception.CancelledException;
import ghidra.util.task.TaskMonitor;
import java.lang.reflect.InvocationTargetException;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/** Session-owned extension loading; analyzer algorithms stay behind each adapter ABI. */
final class ReaGhidraExtensions implements AutoCloseable {
    private record Loaded(URLClassLoader loader, Object instance, String sha256) {}
    private final List<Loaded> loaded = new ArrayList<>();
    private final JsonArray reports = new JsonArray();

    void analyze(JsonArray descriptors, Program program, TaskMonitor monitor) throws Exception {
        for (var item : descriptors) {
            monitor.checkCancelled();
            JsonObject descriptor = item.getAsJsonObject();
            String id = descriptor.get("id").getAsString();
            String entry = descriptor.get("entry_class").getAsString();
            String digest = descriptor.get("sha256").getAsString();
            JsonObject report = new JsonObject();
            report.addProperty("id", id);
            report.addProperty("sha256", digest);
            URLClassLoader loader = null;
            try {
                if (!id.equals("nativeaot") || !entry.equals("rea.extensions.nativeaot.NativeAotExtension") ||
                    descriptor.get("integration_api").getAsInt() != 1)
                    throw new IllegalArgumentException("Unregistered Ghidra extension ABI: " + id);
                Path path = Path.of(descriptor.get("path").getAsString());
                if (!path.isAbsolute() || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > 8 * 1024 * 1024)
                    throw new IllegalArgumentException("Invalid private extension artifact: " + path);
                String measured = java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path)));
                if (!measured.equals(digest)) throw new IllegalArgumentException("Private extension digest mismatch: " + id);
                loader = new URLClassLoader(new java.net.URL[] { path.toUri().toURL() }, getClass().getClassLoader());
                Class<?> type = Class.forName(entry, true, loader);
                Object instance = type.getConstructor().newInstance();
                Object response = type.getMethod("analyze", Program.class, TaskMonitor.class).invoke(instance, program, monitor);
                if (!(response instanceof JsonObject result)) throw new IllegalArgumentException("Invalid Ghidra extension result: " + id);
                report.addProperty("status", result.get("status").getAsString());
                report.add("reason", result.get("reason").deepCopy());
                report.add("result", result);
                loaded.add(new Loaded(loader, instance, digest));
                loader = null;
            } catch (InvocationTargetException ex) {
                if (ex.getCause() instanceof CancelledException cancelled) throw cancelled;
                failure(report, ex.getCause());
            } catch (Exception | LinkageError ex) {
                failure(report, ex);
            } finally {
                if (loader != null) loader.close();
            }
            reports.add(report);
        }
    }

    JsonArray reports() { return reports.deepCopy(); }

    JsonArray inspectImage() throws Exception {
        JsonArray summaries = new JsonArray();
        for (Loaded extension : loaded) {
            Object response = extension.instance.getClass().getMethod("inspectImage").invoke(extension.instance);
            if (!(response instanceof JsonObject summary)) throw new IllegalArgumentException("Invalid extension image summary");
            summary.addProperty("analysis_artifact_sha256", extension.sha256);
            summaries.add(summary);
        }
        return summaries;
    }

    JsonObject inspectDataType(Program program, DataType type, Address address, TaskMonitor monitor) throws Exception {
        for (Loaded extension : loaded) {
            try {
                Object response = extension.instance.getClass().getMethod("inspectDataType", Program.class, DataType.class, Address.class, TaskMonitor.class)
                    .invoke(extension.instance, program, type, address, monitor);
                if (response instanceof JsonObject result) return result;
                if (response != null) throw new IllegalArgumentException("Invalid extension type metadata result");
            } catch (InvocationTargetException ex) {
                if (ex.getCause() instanceof CancelledException cancelled) throw cancelled;
                throw new IllegalStateException("Ghidra extension type inspection failed: " + ex.getCause(), ex.getCause());
            }
        }
        return null;
    }

    private static void failure(JsonObject report, Throwable ex) {
        String reason = "Extension loading/analysis failed: " + ex;
        if (ex.getCause() != null) reason += "; caused by " + ex.getCause();
        report.addProperty("status", "failed");
        report.addProperty("reason", reason);
        JsonObject result = new JsonObject();
        result.addProperty("loader_failure", reason);
        report.add("result", result);
    }

    @Override public void close() throws Exception {
        Exception failure = null;
        for (Loaded extension : loaded) {
            try { extension.loader.close(); }
            catch (Exception ex) { if (failure == null) failure = ex; else failure.addSuppressed(ex); }
        }
        loaded.clear();
        if (failure != null) throw failure;
    }
}
