/** An XML plist scalar whose value cannot be established without guessing. */
export class UnknownPlistScalar {
  constructor(
    readonly element: "integer" | "real" | "date" | "true" | "false",
    readonly rawLiteral: string,
    readonly reason:
      | "invalid-literal"
      | "unsupported-markup"
      | "unrepresentable",
  ) {}
}
