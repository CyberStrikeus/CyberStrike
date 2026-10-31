/** Extract one real procedure address from the complete inline inventory. */
export function firstProcedureAddress(input: unknown): string;

/** Reject empty and success-shaped embedded decompilation failures. */
export function requirePseudocode(input: unknown, operation: string): string;

/** Validate a complete Hopper function dossier semantically. */
export function requireFunctionDossier(
  input: unknown,
  expectedAddress: string,
): Record<string, unknown>;

/** Positive semantic facts required from one source-owned Hopper fixture. */
export interface FunctionDossierOracle {
  readonly procedure_address: string;
  readonly callee_address?: string;
  readonly caller_address?: string;
  readonly referenced_string?: string;
  readonly referenced_name?: string;
  readonly comment?: string;
  readonly require_cfg_successor?: boolean;
  readonly require_assembly?: boolean;
}

/** Reject a structurally valid dossier that omits fixture-proven semantics. */
export function requireFunctionDossierOracle(
  input: unknown,
  oracle: FunctionDossierOracle,
): Record<string, unknown>;

/** Require every relationship to be an actual hexadecimal address. */
export function requireAddressArray(
  input: unknown,
  operation: string,
): string[];
