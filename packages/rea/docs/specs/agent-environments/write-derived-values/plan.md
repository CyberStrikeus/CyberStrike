# Implementation plan

1. **Clock formats.** A `trimmed` ISO format, `fixedWidth` on a clock reading, fitting a format to another value, and
   calendar digits, in a clock formats module.
2. **Composed strings.** A module that indexes a create's candidate parts once, segments a string, checks the type's
   other entities and an update's before value, and spells the string from written fields.
3. **Explaining.** Create explanation composes unexplained strings after templates, learns trimmed clocks from the
   type and generated integers; update explanation composes unsent changes after the existing rules.
4. **Later calls.** A later create or update widens the plan's clocks to a trimmed spelling it shows; a later create's
   unique value may be a generated integer.
5. **Serving.** Derived fields are rebuilt after other rules; unique integers are seeded by length and kind.
6. **Schema, tests and docs.** The plan schema, view, serving and unit tests, and the write-plan docs.
