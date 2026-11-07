import type { EvidenceProvider } from "../../domain/evidence.js";
import type {
  ObjdumpSelection,
  RizinInput,
} from "../../domain/reverseEngineering.js";

/** Provider-neutral command profile consumed by the shared application workflow. */
export interface ReverseEngineeringProviderCommand {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly identity: EvidenceProvider;
  readonly environmentOverrides?: Readonly<NodeJS.ProcessEnv>;
}

/** Provider-specific command construction stays outside the application layer. */
export interface ReverseEngineeringCommandPort {
  objdump(input: ObjdumpSelection): ReverseEngineeringProviderCommand;
  rizin(input: RizinInput): ReverseEngineeringProviderCommand;
}
