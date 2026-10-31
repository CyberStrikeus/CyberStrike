import { expect, it } from "vitest";
import { ElfNotesService } from "./ElfNotesService.js";
import { KernelModuleService } from "./KernelModuleService.js";
import { PeCertificatesService } from "./PeCertificatesService.js";
import { PeImportsService } from "./PeImportsService.js";
import {
  ELF_NOTES_PROVIDER,
  KERNEL_MODULE_PROVIDER,
  PE_CERTIFICATES_PROVIDER,
  PE_IMPORTS_PROVIDER,
} from "../../domain/investigationProviders.js";

const inspect = (): never => {
  throw new Error("An already cancelled request must not reach its provider");
};

it.each([
  [
    "PE imports",
    () => new PeImportsService({ identity: PE_IMPORTS_PROVIDER, inspect }),
  ],
  [
    "PE certificates",
    () =>
      new PeCertificatesService({
        identity: PE_CERTIFICATES_PROVIDER,
        inspect,
      }),
  ],
  [
    "ELF notes",
    () => new ElfNotesService({ identity: ELF_NOTES_PROVIDER, inspect }),
  ],
  [
    "kernel module",
    () =>
      new KernelModuleService({ identity: KERNEL_MODULE_PROVIDER, inspect }),
  ],
] as const)(
  "preserves an early cancellation reason for %s before validation",
  async (_label, create) => {
    const service = create();
    try {
      for (const reason of [null, { caller: "selected task" }]) {
        const result = await service.inspect(null, {
          signal: AbortSignal.abort(reason),
        });
        if (result.ok) throw new Error("Expected early cancellation");
        expect(result.error._tag).toBe("AnalysisCancelledError");
        expect(result.error.cause).toBe(reason);
      }
    } finally {
      await service.close();
    }
  },
);
