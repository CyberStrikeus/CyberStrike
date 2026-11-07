# Static JNI fixture built with the Android NDK

This fixture contains genuine Java `native` declarations, javac-generated JNI
headers, `Java_*` exports and actual `JNI_OnLoad`/`RegisterNatives` source. Its
DEX-only APK containers have no Android manifest, resources or signature. They
are never installed, loaded or executed; static matches do not prove runtime
registration, loading or invocation.

`source-expectations.json` is handwritten from these sources. There are twelve
native declarations, including overloaded and supplementary-Unicode names, two
classes with the same `(ambiguous, (I)I)` pair, one export in two libraries per ABI,
and an intentionally unmatched declaration. `data_methods` has three entries in
`.data`; `relro_methods` has one in `.data.rel.ro`. A Modified UTF-8 table name
encodes U+10400 as the two UTF-16 surrogate units, unlike ordinary four-byte UTF-8.

## Pinned existing tools

- NDK **r27d / 27.3.13750724**, official Linux archive:
  <https://dl.google.com/android/repository/android-ndk-r27d-linux.zip>.
  Size **663956036 bytes**; official SHA-1
  `22105e410cf29afcf163760cc95522b9fb981121`, from Google's
  [repository manifest](https://dl.google.com/android/repository/repository2-3.xml).
  Observed archive SHA-256:
  `601246087a682d1944e1e16dd85bc6e49560fe8b6d61255be2829178c8ed15d9`.
  The latter is an acquired-byte identity, not an independently published checksum.
- Observed bundled Android clang **18.0.4**, build **13691557**, LLVM source
  `d8003a456d14a3deb8054cdaa529ffbf02d9b262`; genuine LLD/readelf **18.0.4**.
- Existing Temurin JDK **21.0.12.1+1**, Android **36** platform JAR, and D8
  **8.0.40** from the checksum-pinned R8 JAR described in the neighboring
  [mapping fixture](../r8-mapping/README.md#compiler-source-and-integrity).

Private acquisition streams the archive to disk and checks its byte count/SHA-1
before extraction. The executed selection retained about 305 MiB, admitted below
512 MiB: clang/LLD/readelf and their archive-owned relative links, host shared
dependencies, Clang headers, four target builtins/**libunwind.a**, NDK sysroot
headers, and selected target API 21/23 libraries. It omitted unrelated debuggers,
samples and sanitizer runtimes. Preserve actual archive paths/modes/link targets;
the host JDK's `jni.h` or a host `ld.lld` wrapper cannot substitute for the NDK.
No global toolchain or configuration is changed.

## Generate with explicit inputs

Run serially with two CPUs and a process-family memory supervisor. Java commands
also cap their heap and active processors; LLD uses two threads. Select an output
directory that does not exist. `build.py` does not download or install tools.

```sh
python3 tests/fixtures/android/jni-bindings/build.py \
  --ndk /absolute/private/android-ndk-r27d \
  --jdk /absolute/existing/jdk-21 \
  --r8-jar /absolute/verified/r8-8.0.40.jar \
  --android-jar /absolute/sdk/platforms/android-36/android.jar \
  --output /absolute/fresh-output-directory
```

The generator compiles three Java classes with `javac -h`, checks every expected
export against those generated declarations, runs D8, and independently checks
the resulting DEX `ACC_NATIVE` flags and exact names/prototypes. It then compiles
two libraries for each of arm64-v8a, armeabi-v7a, x86_64 and x86, with three packing
variants. All subprocess arguments and tool versions are recorded in the output.

| APK variant               | Observed table relocation encoding                     | Required interpretation                                                              |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `jni-ordinary-static.apk` | AArch64/x86-64 RELA; ARM/i686 REL implicit addends     | Every source-known candidate and exact slot value survives                           |
| `jni-relr-static.apk`     | Standard DT_RELR with encoded bitmaps on all four ABIs | Same facts, with RELR source evidence                                                |
| `jni-aps2-static.apk`     | Android packed APS2 REL/RELA on all four ABIs          | Explicit unsupported/partial table coverage; preserve independently readable exports |

Ordinary and RELR source expectations have, across four ABIs, 32 matched,
12 ambiguous and four unmatched bindings. These are source-known outcomes.
The report's matched status establishes observed candidate presence; separate
partial coverage does not promise complete uniqueness. A source-known unmatched
method can remain unknown when GLOB_DAT or NOBITS handling leaves incomplete
coverage. APS2's `expected_methods` retains source-known export facts and marks
unrecovered table declarations unknown. The report must retain readable export
candidates and must not claim that an undecoded table is absent.

## Independent evidence and limits

`oracle.py` imports no REA parser. For these small generated artifacts it reads
known ELF symbols and source-specified table slots, applies standard relative
REL/RELA/RELR records, checks the exact Modified UTF-8 bytes, and requires each
function pointer to equal the compiled function symbol inside executable PT_LOAD.
It is a known-slot oracle, not a general JNI table discovery implementation.
It deliberately does not decode APS2. The separate official `llvm-readelf`
transcripts establish actual sections, symbols, relocation tags and GNU_RELRO.

Generated `full-expectations.json` contains every ABI/library digest, export and
expected declaration binding, including the independently recovered slot addresses,
file offsets, raw words, relocated words and function addresses. `oracle/dex.json`,
`headers/`, `javap/`, `readelf/`, `commands.json` and compiler logs retain the
independent proof. Generated APK hashes are per-run identities; ZIP metadata can
vary between runs. Keep all generated binaries, caches and receipts outside Git.

The static library checker reads the Conscrypt oracle only when the generated
expectations declare that optional case. A declared but missing oracle fails
verification; NDK-only expectations require only their 24 generated libraries.

Optional `--conscrypt-aar` and `--conscrypt-original-dex-zip` package the already
acquired Conscrypt Android **2.8.0** original-name D8 together with the exact four
native libraries from the public Apache-2.0 AAR. The source AAR SHA-256 is
`752044c289bc98e2dcabc00a1f88ca158b3aa3f505b38f124552bf4b2a0902b1`.
The independent arm64 oracle pins its library SHA-256 and validates slots
`0x2ada68`, `0x2ada70`, `0x2ada78`, resolving `EVP_PKEY_new_RSA` with descriptor
`([B[B[B[B[B[B[B[B)J` to `0xfa11c`. Its existing D8 warning about the missing
platform adapter `OpenSSLSocketImpl` remains a limitation. This is a static
container, and pairing an R8-minified DEX with unchanged original JNI strings
would be a different negative case.

## Public workflow checker

After building REA and selecting the existing JADX MCP JAR, the maintained
[public MCP checker](../../../support/analysis-efficiency/android-jni.mjs) accepts
the generated `full-expectations.json`. Run it under the same external resource
supervisor; it does not rebuild fixtures or run target code.

```sh
node tests/support/analysis-efficiency/android-jni.mjs \
  --repository /absolute/rea-checkout \
  --target /absolute/fixture-output/jni-ordinary-static.apk \
  --expectations /absolute/fixture-output/full-expectations.json \
  --variant ordinary --detail summary --proof --pages --cli \
  --java-home /absolute/existing/jdk-21 --jar /absolute/existing/jadx-mcp.jar \
  --output /absolute/fresh-receipts-directory
```

Use `relr`, `aps2` or `conscrypt` with its corresponding APK for the other cases.
Two passes distinguish a cold provider from warm reuse. Add `--omit-detail` with
`--detail summary` to verify the MCP default through an actually omitted argument. `--proof` counts and
checks complete Evidence export; `--pages` checks all four collections, selected
fields, empty filters, native source ordinals, coverage and parent row indices;
`--cli` checks one CLI result after MCP cleanup. Optional `--retained-removal`
runs a separate qualification after the investigation receipts: it copies the APK
exclusively into the fresh output directory, analyzes that copy, removes only
that owned copy, then reads retained summary/slot/pages and exports unchanged
parent Evidence. It verifies the original APK digest remains unchanged. These
calls are recorded and costed separately from cold/warm investigation tasks.
The optional
[cost reader](../../../support/analysis-efficiency/android-jni-costs.py) counts
catalogs, all request/reply content and proof/page calls with an existing
`tiktoken` installation. These are estimates, not model billing. Earlier main has
no equivalent static RegisterNatives workflow, so it is not an equal-coverage
performance baseline.
