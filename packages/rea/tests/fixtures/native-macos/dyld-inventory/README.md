# Apple native inventory captures

These outputs were captured from the installed Apple tools on macOS arm64.
The executable's filename in tool output is replaced with `fixture`. Import
hexadecimal indexes are binding ordinals, while the export table contains image
offsets. The absolute export is not relative to the image base. `nm` also reports
each exported name, exercising the merge that must preserve richer dyld facts.

Generate the executable locally; do not check its binary into the repository:

```sh
cat > /tmp/rea-inventory.c <<'C'
#include <stdio.h>
__attribute__((weak)) int fixture_weak(void) { return 2; }
int fixture_export(void) { return 1; }
__asm__(".globl _fixture_absolute\n.set _fixture_absolute, 0x42");
int main(void) { puts("fixture"); return fixture_export() + fixture_weak(); }
C
xcrun clang /tmp/rea-inventory.c -o /tmp/rea-inventory
xcrun file -b /tmp/rea-inventory
xcrun lipo -detailed_info /tmp/rea-inventory
xcrun otool -l /tmp/rea-inventory
xcrun nm -gjU /tmp/rea-inventory
xcrun dyld_info -imports /tmp/rea-inventory
xcrun dyld_info -exports /tmp/rea-inventory
xcrun dwarfdump --uuid /tmp/rea-inventory
xcrun vtool -show-build /tmp/rea-inventory
```

Addresses, UUIDs and build versions may vary with the installed toolchain; the
checked-in captures are the golden input. The test checks the virtual addresses
corresponding to those captured offsets and image base.

`../dyld-imports.txt` contains verbatim header and representative ordinary/weak
import rows from `xcrun dyld_info -imports /usr/lib/libobjc.A.dylib`.
`library-reexports.txt` contains the header and one reexport row from
`xcrun dyld_info -exports /usr/lib/libc++.1.dylib`. These are separate library
captures used to check their respective row formats.

`renamed-reexports.txt` is `xcrun dyld_info -exports` for a dylib that
re-exports `_foo` from `libfoo` under the name `_foo_renamed`:

```sh
printf 'int foo(void){return 1;}\n' > /tmp/foo.c
printf 'int own(void){return 2;}\n' > /tmp/re.c
xcrun clang -dynamiclib /tmp/foo.c -o /tmp/libfoo.dylib -install_name @rpath/libfoo.dylib
xcrun clang -dynamiclib /tmp/re.c -o /tmp/libre.dylib -install_name @rpath/libre.dylib \
  /tmp/libfoo.dylib -Wl,-alias,_foo,_foo_renamed
xcrun dyld_info -exports /tmp/libre.dylib
xcrun nm -gjU /tmp/libre.dylib
```

`stripped-swift-exports.txt` and `stripped-swift-nm.txt` are `xcrun dyld_info
-exports` and the default `xcrun nm -gjU` for a Swift dylib whose symbol table
was stripped with `strip -T`. Its export trie keeps all six names, while
`xcrun nm -gjU --no-dyldinfo` prints none:

```sh
printf 'public func hello() -> Int { 1 }\npublic struct S { public init() {} ; public func f() -> Int { 2 } }\n' > /tmp/m.swift
xcrun swiftc -emit-library -module-name M /tmp/m.swift -o /tmp/libMT.dylib
xcrun strip -T /tmp/libMT.dylib
xcrun dyld_info -exports /tmp/libMT.dylib
xcrun nm -gjU /tmp/libMT.dylib
xcrun nm -gjU --no-dyldinfo /tmp/libMT.dylib
```

`codesign-missing.txt` is stderr from `codesign -d --verbose=4` on a nonexistent
path (exit 1). `codesign-unsigned.txt` is stderr from the same command on a copy
of the fixture after `codesign --remove-signature` (exit 1). Only the latter is
an observation that the artifact is unsigned.
