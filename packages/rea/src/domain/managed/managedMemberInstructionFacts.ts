/** Facts available on decoded member-reference-bearing CIL instructions. */
export interface ManagedMemberInstructionFact {
  readonly opcode: string;
  readonly operand_kind: string;
  readonly operand: string | null;
}

/** Whether an instruction contributes a method or field operand fact to member analysis. */
export const isManagedMemberReferenceInstruction = (
  instruction: ManagedMemberInstructionFact,
): instruction is ManagedMemberInstructionFact & {
  readonly operand_kind: "method" | "field";
  readonly operand: string;
} =>
  instruction.opcode !== "ldtoken" &&
  instruction.operand !== null &&
  (instruction.operand_kind === "method" ||
    instruction.operand_kind === "field");
