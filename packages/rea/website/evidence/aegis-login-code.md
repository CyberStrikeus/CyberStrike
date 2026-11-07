# Aegis Android login-code evidence

Inspection on 9 October 2026, using the published REA 6.1.0 CLI with the
caller-supplied `jadx-headless-mcp` 0.7.1 provider and OpenJDK 21.0.12.1 on
Linux x64. The case follows the default time-based code in
[Aegis Authenticator](https://github.com/beemdevelopment/Aegis).

## Target

- [Official release](https://github.com/beemdevelopment/Aegis/releases/tag/v3.4.3): v3.4.3, published 6 September 2026.
- Artifact: `aegis-v3.4.3.apk`, 6,881,897 bytes.
- SHA-256: `fa091c91912c0d56ec3553394fac4158f9a9d178e93bcbb35419601d788cb528`.
- Package: `com.beemdevelopment.aegis`, version code 82.
- Reported inventory: 3,077 classes and 1,106 resources.
- Matching source commit: `d6f4e5925a97e4e91593f1542085eae03432a759`.
- Android provider JAR SHA-256: `6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`.
- Provider source revision: `5844800a486d2248fa949b74c9896285f5b54de2`.

The artifact's SHA-256 matches the official GitHub release asset digest and every
saved REA record. The APK and provider JAR were downloaded into temporary storage.
They are linked from their official releases; neither file is a website asset.

The CLI used `REA_JADX_MCP_JAR` for its own process. The connected MCP server's
Android provider was initially unavailable; it was not reconfigured. The page
expresses the inspected selections as REA tool requests, using the same operation
parameters as the successful CLI calls. Input paths and result package prefixes
are shortened for display, as noted beside those blocks.

## REA findings

Twenty REA operations completed successfully against this artifact. These are the
records used for the page's main findings:

| Operation                  | Finding                                                  | Evidence ID                                                           |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| `inspect_android_method`   | Display calls the timestamp overload for TotpInfo.       | `ev_c4b51611c987a398359f526dc64866d97a99b146d0ec9177bc1d583a55d64bdc` |
| `trace_android_references` | TotpInfo is one of the three incoming generator callers. | `ev_6b5457705a67bd4952f7e17630bcf948538424fae5bc2951c08e921af7448d58` |
| `inspect_android_method`   | Eight-byte big-endian counter, account key and HMAC.     | `ev_cad4c03faf5b07347cba699d4f8f643c69e5a8f0c85f622fc8cbebe3f834f228` |
| `inspect_android_method`   | Hash-byte selection produces a 31-bit integer.           | `ev_5797488db16e72a4e9ad559a8f07e355adc1f73b9eb50566cfb46d47d1b6a883` |
| `inspect_android_method`   | Algorithm name is prefixed with Hmac.                    | `ev_bffbfa3924c79823168df7daa01e8a3f62c4914d3fb4b54e5d4e60d21e75110f` |
| `trace_android_references` | Display and copy callers of the base method.             | `ev_d90e3ed81b0bb6815826e4edf312eadec91b9d20ff06aaff61d38a191403676b` |
| `inspect_android_method`   | Default SHA1 algorithm and six digits.                   | `ev_64294487704fa2a9877938017c95163e41c399ba958ea43c5b365118403ae0fe` |
| `inspect_android_method`   | Decimal remainder and leading-zero padding.              | `ev_5d0906d19ea9281fed36309794fd5697b54cac3abfbd17e2f78665e758e0eb60` |
| `inspect_android_method`   | Class discriminator 0 selects the OTP formatting branch. | `ev_f0a82295bf6124055b7a12a21533950644267e8e8340038bca9c32db57d8d71f` |
| `inspect_android_package`  | Package identity; 3,077 classes.                         | `ev_de07111c281cd76c4f2304f42448b06ef3199268815515d59caa02ea2480eb67` |
| `inspect_android_class`    | Both getOtp overloads and their selection indices.       | `ev_870577d702741f3023494c1bcb6567381a672a7132a60fd35ea2dd21ab9804c8` |
| `search_android_classes`   | Three matches for the case-sensitive query Totp.         | `ev_deeb75a09990e253881d0dc1932097abe00f94447d29a64c782fb48c42e9f492` |
| `inspect_android_method`   | Current clock in milliseconds is converted to seconds.   | `ev_ff4d8be5b4797e6f118d37ed55a2f65c9ceb8df39e8058d2cf36cd5561dc4bfd` |
| `inspect_android_method`   | Default period: 30 seconds.                              | `ev_67af69cd39faceec616a9b1b48b03a5ea71b9c94ff2d1263a0a0063029cc1104` |
| `inspect_android_method`   | Time is floored into a block before generation.          | `ev_f282f536e5690e3e2253903bd979687687cfa5a9a4480758b4cd261da145caaf` |

All selected methods returned complete Java representations without a fallback.
Signatures are provider display signatures; exact DEX descriptors, source-line
locations and instruction offsets are not available from these results.
Reference lists are static incoming references, with complete coverage of the
engine's reported set; reflection and dynamic loading remain unverified.

## Interpretation

`TotpInfo.getOtp()` obtains Unix time in seconds. Its timestamp overload uses
`floor(seconds / period)` as the generator's counter. The default constructor
sets the period to 30; the base constructor sets SHA1 and six digits.
These are defaults, not settings imposed on every imported account.

`getAlgorithm()` constructs `HmacSHA1` for that default. The generator encodes the
counter as eight big-endian bytes, calculates the keyed hash, uses the low four
bits of the final hash byte as an offset, and selects a positive 31-bit integer.
The `OTP.toString()` branch for discriminator 0 reduces it modulo the requested
power of ten and prepends zeroes. The inspected generator passes discriminator 0
into the constructor, connecting that branch to the generated code.

The release exposes `generateOTP` and `getHash` under `kotlin.ExceptionsKt`.
Original-source naming alone would not identify that class in this APK.
The call returned from `TotpInfo.getOtp(long)` supplies the helper name; REA's
method inspection and reference tracing establish its calculation and callers.

The base `OtpInfo.getOtp` reference list includes `EntryHolder.getOtp` and
`MainActivity.copyEntryCode`. Inspecting `EntryHolder.getOtp(int)` then shows that
the display calls the timestamp overload for a `TotpInfo` account, with an
optional period offset. The page uses the unshifted code calculation.

## Reconstruction checks

A temporary JVM harness assembled six method bodies directly from saved REA
results: the timestamp method, algorithm getter, hash method, generator, output
constructor and output formatter. Imports, enclosing classes, fields, exception
type and test driver were supplied for the harness. The original APK was not run.

An independently authored Python calculation agreed with those Java methods on
133 inputs. The website's separately authored WebCrypto implementation then
agreed with all 133 recorded Java outputs.

The cases include:

- All six [RFC 6238 SHA-1 reference vectors](https://www.rfc-editor.org/rfc/rfc6238.html#appendix-B) at eight digits, plus the corresponding six-digit remainders.
- Every integer second from 0 through 120, checking four complete 30-second blocks and four boundary samples.
- A leading-zero result at Unix time 1,111,111,109: `081804`.

The fixed key is the public ASCII test string `12345678901234567890`.
At 30 and 59 seconds the result is `287082`; at 60 seconds it is `359152`.
The diagram labels these as example clock inputs. A code is recomputed for each
block; the checked examples change at their boundaries. Adjacent codes need not
be universally distinct.

The page's “Run reference checks” button tests the browser calculation against
all six reference inputs at both digit lengths. Slider updates use a revision
number so an earlier asynchronous calculation cannot overwrite a later input.
The reference JSON contains public test data, not a captured account key.

## Source comparison and attribution

After obtaining the calculation through REA, selected files from the matching
release source were read for corroboration:

- [HOTP.java](https://github.com/beemdevelopment/Aegis/blob/d6f4e5925a97e4e91593f1542085eae03432a759/app/src/main/java/com/beemdevelopment/aegis/crypto/otp/HOTP.java): counter encoding, HMAC and byte selection.
- [TOTP.java](https://github.com/beemdevelopment/Aegis/blob/d6f4e5925a97e4e91593f1542085eae03432a759/app/src/main/java/com/beemdevelopment/aegis/crypto/otp/TOTP.java): time-to-counter transformation.
- [OTP.java](https://github.com/beemdevelopment/Aegis/blob/d6f4e5925a97e4e91593f1542085eae03432a759/app/src/main/java/com/beemdevelopment/aegis/crypto/otp/OTP.java): decimal output and zero padding.

These files confirm the interpretation. The public page's selected decompiled
Java comes from the APK evidence. It includes fragments from several methods and
line wrapping for display; the paired readable summary is an explanation.
The expanded generator panel retains its complete returned body, with formatting
changes. Aegis excerpts are credited under the upstream
[GPL-3.0 license](https://github.com/beemdevelopment/Aegis/blob/d6f4e5925a97e4e91593f1542085eae03432a759/LICENSE).
The diagram, explanatory summary, demo and its WebCrypto implementation are new
teaching material; the demo is not recovered original application source.

## Scope and maintenance

The claim is a static APK investigation and a checked reconstruction of its
default code calculation. It covers neither Android UI execution nor APK
signature verification, split APK handling, native libraries or vault storage.
The Android provider requires a Linux or macOS host and a full JDK 17 or later,
including `jdk.compiler`. The shell walkthrough was executed on Linux with
JDK 21.

Raw REA results, provider scratch paths, Java harness classes and the downloaded
binaries remain outside the public website. The public page uses generic filenames
and the public test key. Update the release identity, selected excerpts, demo,
reference data and these notes together when moving to another Aegis version.
