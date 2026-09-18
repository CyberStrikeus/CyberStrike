// Ambient declaration for `.txt` prompt imports. Bun loads `import x from "./foo.txt"`
// as the file's text at runtime; this tells tsc the module's type (a string default
// export) so the domain's prompt imports typecheck. Kept in the package (not relying on
// a transitive host ambient) so the package typechecks standalone.
declare module "*.txt" {
  const content: string
  export default content
}
