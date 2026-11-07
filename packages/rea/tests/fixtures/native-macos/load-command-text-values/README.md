# Native load-command text captures

These are actual `xcrun otool -l` captures of dylibs built from `fixture.c`
with Apple clang. Only the owned output file path in each capture was replaced
with `/owned/fixture.dylib`. No fixture binary is committed or executed.

For each install name `123 library.dylib`, `0x123 library.dylib`, `123`,
`0x123`, and `ordinary.dylib`:

```sh
xcrun clang -dynamiclib fixture.c "-Wl,-install_name,$INSTALL_NAME" -o fixture.dylib
xcrun otool -l fixture.dylib
```

The install name is a text field, including when its first token resembles a
decimal or hexadecimal number. The captures also retain ordinary byte-range,
permission, and command-size numeric fields as controls.
