/**
 * Runtime spelling of a Mach-O symbol-table name.
 *
 * Darwin compilers prefix every language-level symbol with one underscore in
 * the Mach-O symbol table: C `_main`, Itanium C++ `__ZN3rea3addEii`, Swift
 * `_$s…`, Objective-C class data `_OBJC_CLASS_$_…`. dyld `dlsym` and LLDB name
 * those symbols without that one underscore. Names the compiler does not
 * prefix, such as Objective-C method symbols (`-[Class selector]`) and
 * assembler-local labels, are already spelled as the runtime names them.
 *
 * The symbol-table name stays the source fact; this is its derived runtime
 * name. Returns null when no name is known or nothing remains after the prefix.
 */
export const machoRuntimeSymbolName = (
  symbolTableName: string | null,
): string | null => {
  if (symbolTableName === null) return null;
  const runtimeName = symbolTableName.startsWith("_")
    ? symbolTableName.slice(1)
    : symbolTableName;
  return runtimeName.length === 0 ? null : runtimeName;
};
