# Real R8 name-mapping fixture

Executed on 2026-10-27 with R8 8.0.40, Temurin JDK 21 and Android 36.
No binary or generated mapping belongs in this directory. Use an explicitly selected temporary output
directory, the existing JDK 21 and Android 36 platform JAR. No Gradle or Java
installation is needed.

The source oracle is `source-expectations.json`, handwritten from the adjacent
Java sources. It contains four classes, eight fields and fifteen methods,
including four constructors. It covers a default-package original, an inner
class, primitive/reference/array field types, four `choose` overloads, two `run`
overloads, Unicode class/member names and mapped classes inside prototypes.
Residual names are intentionally not golden: obtain them from the mapping and
DEX produced together, never from JADX's `defpackage` display aliases.

## Compiler source and integrity

A fully checksum-pinned Maven option is **com.android.tools:r8:8.0.40**:

- Publisher URL: <https://maven.google.com/com/android/tools/r8/8.0.40/r8-8.0.40.jar>.
- Direct Google Maven URL: <https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.0.40/r8-8.0.40.jar>.
- SHA-256: `ab1379835c7d3e5f21f80347c3c81e2f762e0b9b02748ae5232c3afa14adf702`.
- Checksum evidence: the `android_gmaven_r8` entry in the
  [official Bazel dependency lock at commit a76763c4125fbbea17f415a40d9efca846b0b6f0](https://bazel.googlesource.com/bazel/+/a76763c4125fbbea17f415a40d9efca846b0b6f0/distdir_deps.bzl).
  This is Bazel's published pin for the Maven JAR, not an R8 signature or a hash
  for a differently packaged standalone JAR. Verify actual downloaded bytes
  against this pin before execution and record the observed compiler version.

## Bounded generation

Set these paths explicitly; `MAPPING_R8_JAR` is an already acquired and verified
compiler. `MAPPING_RUN` must be a fresh caller-selected output directory.

```bash
MAPPING_JDK=/home/yann/.cache/rea/ghidra-optimization-20261017/installed/jdk-21.0.12.1+1
ANDROID_PLATFORM_JAR=/home/yann/.cache/rea-4537-android-sdk/platforms/android-36/android.jar
MAPPING_FIXTURE=/absolute/worktree/tests/fixtures/android/r8-mapping
MAPPING_R8_JAR=/absolute/cache/r8-8.0.40.jar
MAPPING_RUN=/absolute/fresh-output-directory
mkdir -p "$MAPPING_RUN/classes" "$MAPPING_RUN/oracle"
"$MAPPING_JDK/bin/java" -Xmx512m -XX:ActiveProcessorCount=2 \
  -cp "$MAPPING_R8_JAR" com.android.tools.r8.R8 --version
"$MAPPING_JDK/bin/javac" -J-Xmx256m --release 8 -encoding UTF-8 \
  -d "$MAPPING_RUN/classes" \
  "$MAPPING_FIXTURE/src/DefaultPackage.java" \
  "$MAPPING_FIXTURE/src/fixture/mapping/Original.java" \
  "$MAPPING_FIXTURE/src/fixture/mapping/原名.java"
"$MAPPING_JDK/bin/jar" --create --file "$MAPPING_RUN/input.jar" \
  -C "$MAPPING_RUN/classes" .
"$MAPPING_JDK/bin/java" -Xmx512m -XX:ActiveProcessorCount=2 \
  -cp "$MAPPING_R8_JAR" com.android.tools.r8.R8 --release --min-api 21 \
  --lib "$ANDROID_PLATFORM_JAR" --pg-conf "$MAPPING_FIXTURE/proguard.cfg" \
  --pg-map-output "$MAPPING_RUN/mapping.txt" --output "$MAPPING_RUN/dex.zip" \
  "$MAPPING_RUN/input.jar"
```

The configuration keeps all classes/members and disables optimization while
allowing name obfuscation. It requests residual classes in the default package.
Check that minification really occurred and all expected original symbols are
present; compiler warnings or an empty output are not success. Record compiler,
source/config, input JAR, output DEX/archive and mapping SHA-256 values together.
The DEX ZIP is a static analysis artifact, not an installable or runnable APK.
If the REA APK-path adapter needs an `.apk` suffix, copy this generated ZIP to
an explicitly labelled DEX-only `fixture.apk`; do not imply manifest coverage.

## Independent raw DEX oracle and REA checks

`PrintDexInventory.java` reads one extracted DEX through dexlib2 without the REA
mapping parser, bridge, provider or JADX aliases. The dependency classes are
located in the existing checksum-pinned JADX MCP 0.7.1 JAR; its compilation and
execution passed against the generated fixture. Its 16 MiB bound is for this small fixture only.
It is independent of REA's name-resolution logic, not an independent dependency
distribution or proof that a mapping belongs to a build.

```bash
MAPPING_JADX_JAR=/home/yann/yann/rea/_reference/apk-integration/jadx-headless-mcp-0.7.1-all.jar
unzip -p "$MAPPING_RUN/dex.zip" classes.dex > "$MAPPING_RUN/classes.dex"
"$MAPPING_JDK/bin/javac" -J-Xmx256m -encoding UTF-8 \
  -classpath "$MAPPING_JADX_JAR" -d "$MAPPING_RUN/oracle" \
  "$MAPPING_FIXTURE/PrintDexInventory.java"
"$MAPPING_JDK/bin/java" -Xmx256m -XX:ActiveProcessorCount=2 \
  -classpath "$MAPPING_RUN/oracle:$MAPPING_JADX_JAR" PrintDexInventory \
  "$MAPPING_RUN/classes.dex" > "$MAPPING_RUN/raw-dex-inventory.json"
```

Compare source expectations with pre-minification `javap -s -p` output, then
reconcile the generated mapping with the raw DEX inventory. DEX descriptors must
translate every original class type, including arrays and return types. Do not
assert exact residual letters or selector order.

Through public CLI and MCP, inspect each observed class with `mapping_path`,
select each observed overload index and compare annotations to these independent
facts. Confirm source obfuscated names survive beside mapped claims, APK/DEX
subject and mapping digests agree with measured files, and raw/default-package
selectors resolve without synthesizing aliases. Derive partial/malformed copies
from the real mapping, preserving their own hashes: remove a complete member
record, introduce a malformed member in a valid class block, and remove a class
block. Valid remaining records should still map; removed symbols must become
unmapped with accurate parse/coverage diagnostics. A separate ambiguous mapping
must never select one original by name alone.

## Executed public library check

The companion `../../../support/analysis-efficiency/android-mapping.mjs` harness drives production stdio MCP,
validates the SDK-converted advertised output schemas, and checks all observed
fields and methods against this oracle. `--variants` also checks partial and
malformed records, duplicate class blocks and conflicting residual metadata
using copies of the same generated mapping. The 2026-10-27 fixture run passed
43 calls with summary delivery: two 20-call investigations, including complete
Evidence exports, plus three negative cases. Mappings
and DEX are generated together; association with the selected APK remains a
caller claim rather than a verified build identity.

A separate real-library check used the shipped `classes.jar` from
[Conscrypt Android 2.8.0](https://repo.maven.apache.org/maven2/org/conscrypt/conscrypt-android/2.8.0/conscrypt-android-2.8.0.aar),
AAR SHA-256 `752044c289bc98e2dcabc00a1f88ca158b3aa3f505b38f124552bf4b2a0902b1`,
verified against its publisher SHA-256 sidecar. R8 used the same options plus
`-dontwarn **`; D8 also produced an unminified prototype oracle from those class
files. D8 warned that `com.android.org.conscrypt.OpenSSLSocketImpl` was missing
for a platform adapter. This check verifies static symbol translation for the
selected classes; it does not establish complete dependency resolution or
runnable library linkage. See the [verification report](../../../../docs/verification/android-r8-mapping-2026-10-27.md) for measured
workflow scope and digests.

Stable R8 consumes class files, not an APK's DEX. Official
[R8 command source](https://r8.googlesource.com/r8/+/39af7ba2e061afeeca343db7541bbae64d9b5b81/src/main/java/com/android/tools/r8/R8Command.java)
rejects DEX input; an archive can ignore DEX entries. The existing released
ApiDemos APK was therefore not transformed or presented as an R8 test. All
produced `.apk` files here are explicitly labelled DEX-only static containers,
without claims about manifests, resource tables, signatures, installation,
application execution or devices. Mapping-format 2.2 residual-signature producer behavior
was not exercised; conflict handling uses explicit derived negative mappings.
