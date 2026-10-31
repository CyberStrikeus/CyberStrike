// Imported directly by pre-install fixture scripts; keep this module dependency-free.
/** Audited upstream release; source remains unmodified in the Git submodule. */
export const JADX_RELEASE = Object.freeze({
  version: "0.7.1",
  revision: "5844800a486d2248fa949b74c9896285f5b54de2",
  sha256: "6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75",
  url: "https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar",
});

/** Identity of REA's metadata bridge, distinct from the producing engine. */
export const JADX_BRIDGE_IDENTITY = Object.freeze({
  name: "rea-jadx-bridge",
  version: "10",
});

/** Remediation when `REA_JADX_MCP_JAR` is missing or not an absolute path. */
export const JADX_JAR_CONFIGURATION_REMEDIATION = `Set REA_JADX_MCP_JAR to the absolute path of a caller-supplied jadx-headless-mcp ${JADX_RELEASE.version} JAR. REA does not download or install it.`;

/** Remediation when the selected Java runtime cannot satisfy the JADX bridge. */
export const JADX_JAVA_RUNTIME_REMEDIATION =
  "Select a full JDK including jdk.compiler via JAVA_HOME or PATH, then verify it with java --list-modules. REA does not install Java.";

/** Remediation when a JADX JVM resource override is malformed. */
export const JADX_JVM_OPTIONS_REMEDIATION =
  "Set REA_JADX_HEAP_MIB to a positive integer (heap size in MiB) and REA_JADX_ACTIVE_PROCESSOR_COUNT to a positive integer within the JVM's signed 32-bit range.";

/** Remediation when the host cannot run the Android JADX subprocess. */
export const JADX_UNSUPPORTED_HOST_REMEDIATION =
  "Use Linux, macOS, or Windows x64 with its bundled native controls for Android JADX analysis.";

/** Remediation when the Windows native backend cannot take process ownership. */
export const JADX_WINDOWS_NATIVE_REMEDIATION =
  "Use a matching current Windows x64 REA package with its bundled native controls. The native failure above identifies the failed constraint; Java installation or registration changes cannot enable a missing native backend.";

/** Remediation when the Java module-listing probe cannot establish the runtime. */
export const JADX_JAVA_PROBE_REMEDIATION =
  "Verify the selected Java launcher with java --list-modules: it must start promptly and emit a concise module listing including a parseable java.base version. REA does not install Java.";

/** Producing engine identity used by Evidence and the generated product catalog. */
export const JADX_PROVIDER_IDENTITY = Object.freeze({
  id: "jadx",
  name: "JADX headless",
  version: JADX_RELEASE.version,
});

/** Audited engine coverage, kept outside portable Android semantics. */
export const JADX_LIMITATIONS = [
  "Static decompiler observations do not establish runtime behavior; the APK is never executed.",
  "Method signatures use provider display types; DEX prototypes come from frozen JADX metadata. Display names may be aliases, and overload indices are local to this engine and artifact.",
  "Class inventories use parsed metadata before code generation, including synthetic members that may be omitted from decompiled source. Source positions remain unknown.",
  "Incoming reference totals count JADX using nodes. Direct invoke entries within a using method report raw DEX code-unit offsets and method indexes, but coverage is limited to those nodes and directly matched invokes; it does not establish every possible dynamic or reflective call site.",
  "Manifest summaries are parsed once by REA's bridge from the exact root AndroidManifest.xml resource, using namespace-aware XML attributes; decoded XML is retained. These summaries do not verify APK signatures, split APKs or Android runtime capture.",
] as const;
