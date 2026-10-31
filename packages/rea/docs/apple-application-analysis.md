# Apple Application Inventory Projection

REA can project one or more authenticated `inventory_artifact` Evidence records
for the same IPA, macOS `.app` directory, ZIP, or DMG into an Apple application
inventory. The projection is execution-free: it reports exact paths, content
hashes, detected formats, bundle anatomy, runtime-family hints, and path-based
bridge hypotheses. It does not parse plist or CMS semantics or claim observed
runtime calls.

Framework hints match complete path segments such as `React.framework`,
`ReactNative.framework`, `hermes.framework`, `Flutter.framework`, and
`UnityFramework.framework`. Substrings in `Preact.framework`,
`Community.framework`, or `MyApp.framework` do not identify those families.
A generic `App.framework` also does not identify Flutter by itself. Runtime
families remain inventory-derived hints, not observed loading. Generic framework
and dylib paths do not establish Swift or Objective-C; this projection does not
decode language metadata. A bridge basis is inferred from the native path and
repeated for each paired script, rather than proving a particular binding.

```sh
rea project-apple-application-graph '{"inventory_evidence":[<inventory_artifact Evidence>]}'
```

```json
{
  "name": "project_apple_application_graph",
  "arguments": {
    "inventory_evidence": ["<inventory_artifact Evidence>"]
  }
}
```

The result includes every component in each inventory category. Bridge
hypotheses are the path-based JavaScript/native pairs within each application
root. To keep their Cartesian expansion bounded, the projection limits the
serialized candidate array to 2 MiB. It computes the pair count and
exact UTF-8 JSON size before creating candidate objects, then retains a
deterministic prefix when the byte budget is exceeded. The result's
`bridge_candidate_coverage` reports total, emitted, and omitted pair counts;
overall coverage becomes `partial` and a limitation explains the omission.
Duplicate inventory pages are merged by artifact identity and occurrence path;
their Evidence IDs remain attached as source Evidence.

Content nodes identify bytes by SHA-256 and report only content-derived formats.
Each occurrence reports its own `artifact_kind`, `artifact_format`, and executable
permission. Identical bytes can therefore appear as a script, resource, or native
addon at different paths without overwriting another occurrence's role. Package
formats such as APK and IPA belong to the occurrence; their ZIP bytes share a
content format. Graph and directory identities use locale-independent Unicode
ordering.

For IPA inventories, archive components outside every application root remain
in the component lists. Their JavaScript and native candidates are grouped with
other unrooted components, preserving the inventory projection's path pairing
semantics without attributing them to an application bundle.

Coverage is `complete-within-inventory` when the supplied pages reconstruct the
complete authenticated inventory, and `partial` otherwise. A partial result
states that absence is unknown. Component arrays remain complete when candidate
hypotheses are omitted; component arrays still include every component from
the supplied inventory pages, and overall coverage is `partial` in that case.

Inventoried files whose bytes were not read, such as encrypted archive members,
are listed in `unavailable_components` with their original path, format,
encryption flag, limitations, and null content identity. The same application-root
and AppleDouble attribution rules apply. These files make overall coverage
`partial`; component absence is unknown even when `inventory_complete` is true.
Directories have no file bytes and symlinks remain in `symlinks`, so neither is
an unavailable file component. The additive field participates in `projection_id`,
including when empty, so Apple projection identifiers change.

## Application roots

| Inventory root                         | Application root                                    |
| -------------------------------------- | --------------------------------------------------- |
| IPA                                    | Each `Payload/<Name>.app`                           |
| `.app` directory                       | `.`, the inventoried bundle itself                  |
| Directory, ZIP, or DMG containing apps | Each outermost `<Name>.app` followed by `Contents/` |

File and slice occurrences supply component endpoints. Directory tree identities
remain in source inventory and bundle anatomy, and links remain in `symlinks`.

Root and layout discovery use known directories and ancestors implied by deeper
inventory paths. A leaf file or symlink named `*.app`, `Contents`, or `Versions`
does not establish that directory. Directory and authenticated-file identity are
selected before applying anatomy case preferences, so a file cannot shadow a
folded directory name or a directory shadow a metadata/signature file.

ZIP archives made with `ditto -c -k --keepParent` report `<Name>.app`. A DMG
reports `<image>.dmg/<Volume>/<Name>.app`; DMG child inventory needs the native
macOS mounting adapter. When a DMG has only its root identity, the projection is
`partial` and says that bundle absence is unknown. Other inventory formats, such
as APK or ASAR, are rejected as input errors.

An inventoried directory whose name ends in `.app` is its own root even when its
inventory is partial or lacks `Contents/`. For directory, ZIP, and DMG
inventories, components outside every application root are not attributed to
the application. This covers installers, disk-image extras, and AppleDouble
sidecars, which therefore stay out of runtime families and bridge candidates. A
limitation reports how many inventoried entries were left out. IPA projection
still lists every archive component, including `SwiftSupport/`.

`platforms` lists `macos` for application roots with `Contents/`. It lists `ios`
for shallow application roots that have an `Info.plist` at their root. An
application root with neither, such as an empty inventory, has no platform.

## macOS bundle anatomy

`bundles` lists each application root and every nested bundle under it. Each
bundle reports its `parent_path`, `layout`, `info_plist_path`,
`executable_candidates`, and `signing_paths`.

| Layout                | Meaning         | Content directory                             |
| --------------------- | --------------- | --------------------------------------------- |
| `macos-deep`          | Has `Contents/` | `Contents/`, executables in `Contents/MacOS/` |
| `versioned-framework` | Has `Versions/` | Each real `Versions/<version>/`               |
| `shallow`             | Neither         | The bundle directory itself                   |

Roles are path conventions (`role_basis: "path-convention"`):

| Role                 | Path                                                            |
| -------------------- | --------------------------------------------------------------- |
| `app-extension`      | `*.appex`                                                       |
| `xpc-service`        | `*.xpc`, including XPC services inside frameworks               |
| `framework`          | `*.framework`                                                   |
| `system-extension`   | `*.systemextension`                                             |
| `driver-extension`   | `*.dext`                                                        |
| `plug-in`            | `PlugIns/*.bundle`, `*.plugin`, `*.qlgenerator`, `*.mdimporter` |
| `resource-bundle`    | `Resources/*.bundle`, such as SwiftPM resource bundles          |
| `bundle`             | Any other `*.bundle`                                            |
| `login-item`         | `Contents/Library/LoginItems/*.app`                             |
| `helper-application` | `Contents/Helpers/*.app`                                        |
| `nested-application` | Any other nested `*.app`                                        |

The components also list:

- `privileged_helpers`: files directly in `Contents/Library/LaunchServices/`,
  where SMJobBless helpers live;
- `launchd_plists`: `.plist` files directly in `Contents/Library/LaunchAgents/`
  (`domain: "agent"`) or `Contents/Library/LaunchDaemons/` (`domain: "daemon"`),
  as used by SMAppService;
- `helpers`: files directly in `Contents/Helpers/`.

Symlinks are reported by path in `symlinks`. Their targets are not inventoried,
so a versioned framework is described through its real `Versions/<version>/`
directories rather than `Versions/Current`. A framework's `info_plist_path` is
`null`, with a limitation explaining why, when it has more than one real
`Versions/<version>/` directory (even if only one of them holds a plist,
because `Versions/Current` decides which one applies) or when its single
version directory has no `Resources/Info.plist`.

A `shallow` bundle's `info_plist_path` is its root `Info.plist`. Without one,
it is `Resources/Info.plist`: a flattened macOS framework keeps its binary,
`_CodeSignature/`, and `Resources/` directly in the `.framework`, like a single
`Versions/<version>/` directory without the `Versions/` wrapper.

AppleDouble sidecar files (`._*` and `__MACOSX/`) are inventory facts, but they
describe neighbouring files. They are excluded from roots, bundle roles, and the
anatomy components.

The projection does not read plists. Use `inspect_plist` on a bundle's
`info_plist_path` or a launchd plist to read `CFBundleExecutable`, identifiers,
`SMPrivilegedExecutables`, `BundleProgram`, URL schemes, and usage descriptions.
MCP calls require an existing `open_binary` or `open_bundle_resources` session,
including when `inspect_plist.path` is explicit. For a bundle without a resolved
executable, open its resource session first. The CLI `rea inspect-plist <path>`
opens the selected artifact for its one invocation.
Use `inspect_signature` on an executable candidate for code-signing claims.

## Dylib load resolution

`trace_dylib_resolution` answers which file each Mach-O dylib load reaches. It
runs on the active Mach-O, or on every executable in the active `.app`. Each
executable in a bundle (the main app, XPC services, app extensions, login items,
privileged helpers, and helper tools) is a separate process root with its own
`@executable_path`.

```sh
rea trace-dylib-resolution MyApp.app --json
rea trace-dylib-resolution MyApp.app --root Contents/MacOS/MyApp --architecture arm64 --json
```

```json
{
  "name": "trace_dylib_resolution",
  "arguments": { "roots": ["Contents/MacOS/MyApp"], "architecture": "arm64" }
}
```

Load commands are parsed in TypeScript from Mach-O and FAT headers, including
the `dylib_use_command` encoding newer linkers emit for flags such as delayed
initialization, and `LC_LAZY_LOAD_DYLIB_INFO` (`0x3a`). That command stores its
install name in a linkedit payload rather than in the load command itself.
Its flag and chain-start image offsets must lie in the slice VM range, which
is dyld's one-page floor extended by every segment except `__LINKEDIT`,
measured from the `__TEXT` vmaddr. Payload strings must start after the 24-byte
header. The load-path NUL must occur before the payload's final byte, matching
dyld's scan. Distinct payload bytes and payload-range lookups stay within the 16 MiB
limit, and a file range already read is reused. String scanning and UTF-8
checks count every reference, including repeats and overlaps, and stop at that
same aggregate. A slice retains at most 1024 of these commands; further copies are
unsupported instead of becoming one traced edge each. Symbol references,
including repeats, stop at 65536 per slice. A larger table is unsupported
instead of caching one string per offset.
Nothing is executed and no Apple tool is required, so the tool also works off
macOS.

Resolution follows dyld:

- `@executable_path` is the directory of the process root's executable. It is
  undetermined when the root is a library.
- `@loader_path` is the directory of the image that holds the load command, or
  of the image that owns the `LC_RPATH` entry being expanded.
- `@rpath` tries each `LC_RPATH` of the loading image first, then those of the
  image that loaded it, up to the process root.
- Dependencies load dependents-first in load-command order, and each image
  loads once per process. A later @rpath request whose install name matches an
  already loaded image reuses it.
- Symlinks such as `Versions/Current` are followed inside the analyzed root.
  An escape through `..` or an absolute link is `escapes-target`.
- Dyld path components are POSIX names. On Windows hosts, link text uses `\`
  as its separator, and a dyld component that contains `\` or `:` cannot name
  a file in the analyzed root, so its candidate is `absent`.

Each edge lists every candidate path tried, with its outcome: `resolved`,
`absent`, `not-mach-o`, `malformed`, `unsupported` (recognized Mach-O outside
parser coverage, such as big-endian images), `architecture-missing`,
`not-loadable`, `platform-mismatch`, `outside-target`, `escapes-target`, or
`undetermined`. `not-loadable` means a
matching-architecture Mach-O image was found but it is not a dylib and cannot
satisfy a dylib dependency. `platform-mismatch` means a matching-architecture
dylib was found but its observed platform is incompatible with the process.
These outcomes reject that candidate; dyld search may continue and resolve a
later candidate. Candidate outcomes describe individual search paths, while
`resolution.status` describes the final edge. For each selected process-root
slice, candidate slices are matched by CPU type and dyld's subtype preference
order, independently of FAT table order. An ARMv7s root slice prefers ARMv7s,
then ARMv7; other known ARM32 subtypes use their compatibility rows from
[Apple's dyld source](https://github.com/apple-oss-distributions/dyld/blob/dyld-852.2/src/dyld2.cpp#L2811-L3105).
An `x86_64h` process also loads generic `x86_64`. Unknown ARM32 subtype policy
remains undetermined when ARM32 candidate slices exist. This is a static model
keyed to the selected root slice; it does not observe the target device's host
CPU or prove which slice the device will execute. The edge's `resolution` is
one of:

| Status         | Meaning                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolved`     | An image inside the analyzed root loads, and no earlier candidate was undeterminable.                                                                          |
| `conditional`  | An in-root image may load, but an earlier outside candidate, unmodeled environment input, or unknown platform compatibility can change which image dyld loads. |
| `unresolved`   | Every candidate is definitively absent or unusable inside the root.                                                                                            |
| `undetermined` | No candidate resolves inside the root, and some candidate lies outside it or depends on the environment.                                                       |

A `conditional` image is still traced, because it is an in-root candidate
that may load. Every edge below it has `loader_conditional: true`, and a
request that reuses it by install name is `conditional` too. An in-root dylib
with no platform load command remains unknown unless the root is an executable
with observed macOS platform and the candidate's CPU type is x86_64, i386, or arm64. In that macOS context,
[Apple's dyld](https://github.com/apple-oss-distributions/dyld/blob/fd8d0c4d52320ebf64db34f3cb280310d905c5ae/mach_o/UnsafeHeader.cpp#L1137-L1145) supplies an implicit macOS platform to legacy dylibs on those CPU
types. The candidate records `platform_basis: "macos-dyld-implicit"`; the
reported slice fields `platform: null` and `platforms: []` remain the parsed
facts. For other process contexts the platform remains unknown, coverage is
partial, and the candidate is not treated as incompatible. If a later known
candidate resolves, it remains the traced image with conditional resolution;
the trace does not claim the unknown candidate's dependency graph. Findings on
conditional edges say that they apply only if the conditional image loads.

Absolute install names that name a path beneath the analyzed root are checked
within that root, with symlinks and `..` resolved by the same bounded tree
resolver. Absolute paths outside the root, such as
`/usr/lib/libSystem.B.dylib`, are `outside-target`; on macOS 11 and later most
system libraries live in the dyld shared cache rather than on disk, so REA does
not check them against the host. Mach-O path strings are not converted from
`file:` URLs or looked up through unrelated host paths.

`findings` are derived, not observed:

- `required-load-unresolved`, `weak-load-unresolved`, and `lazy-load-unresolved`.
  `LC_LAZY_LOAD_DYLIB` and `LC_LAZY_LOAD_DYLIB_INFO` dependencies are resolved
  but not traversed, because dyld loads them on first use; an unresolved one is
  not a launch failure. `LC_LAZY_LOAD_DYLIB_INFO` has no compatibility version,
  so those fields are null. Its may-be-missing flag is reported as `weak`, and
  an unresolved dependency with that flag is not a first-use failure: dyld
  continues if the image is absent.
- `earlier-rpath-candidate-absent`: a compatible Mach-O placed at an earlier
  modeled search path could take precedence, subject to unmodeled search inputs
  and code-signing library validation. These findings do not establish which
  image dyld will load; use `inspect_signature` for signing metadata.
- `dyld-environment-present`: preserves observed `LC_DYLD_ENVIRONMENT` entries.
  Only an executable root supplies process settings; entries on library and
  other non-executable roots do not alter resolution or coverage. Applicable
  executable image-selection overrides are not modeled.

Empty dyld settings have different consumers. Modern dyld appends a slash and
image name to ordinary and fallback directory entries, so an empty entry can
search `/child.dylib` or `/Foo.framework/Foo`. REA retains uncertainty for those
unchecked paths; an empty fallback does not preempt an ordinary-search hit.
Empty versioned-directory lists do not scan a directory, and empty suffixes
only repeat the original candidate, so they do not add search uncertainty.
Reported command values are retained in all cases.

`verify:macos-bundle` checks the parser against `otool -l` for every traced
image. It also compares the predicted load order of two process roots with the
images dyld actually loads (`DYLD_PRINT_LIBRARIES`).
