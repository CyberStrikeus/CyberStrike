# Universal Mach-O captures whose slices share one CPU type

Captured on macOS 27.0.1 (26A434), arm64, from two system executables whose
FAT slices all use `CPU_TYPE_ARM64`:

```sh
lipo -detailed_info /System/Applications/Calculator.app/Contents/MacOS/Calculator > calculator.txt
lipo -detailed_info /System/Library/CoreServices/ShortcutDroplet.app/Contents/MacOS/ShortcutDroplet > shortcut-droplet.txt
```

Calculator holds `arm64e` (subtype `0x80000002`) and `arm64e.x1` (subtype
`0x8000000c`); ShortcutDroplet holds `arm64` (subtype `0`) and `arm64e.x1`.
Target admission names both files by the single CPU family `arm64`, while lipo
lists two slices.

The executable path on the `Fat header in:` line was replaced with `fixture`,
and trailing whitespace (lipo prints `capabilities ` for a slice without
capabilities) and the final blank line were removed. Tool fields are otherwise
unchanged.
