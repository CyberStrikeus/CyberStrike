import { ApkSignatureService } from "../application/apkSignature/ApkSignatureService.js";
import { ApkSignatureProvider } from "../apkSignature/ApkSignatureProvider.js";
import { INSPECT_APK_SIGNATURE_CONTRACT } from "../contracts/apkSignature/apkSignatureToolContracts.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";

/** Compose the in-process APK signature reader without acquisition or import-time I/O. */
export const createApkSignatureService = (): ApkSignatureService =>
  new ApkSignatureService(new ApkSignatureProvider());

/** Static descriptor binding the one APK-signature operation for CLI/MCP. */
export const apkSignatureModule = {
  contract: INSPECT_APK_SIGNATURE_CONTRACT,
  cliCommand: CLI_COMMANDS.inspectApkSignature,
  create(
    _environment: Readonly<NodeJS.ProcessEnv>,
    injected?: ApkSignatureService,
  ): Pick<ApkSignatureService, "inspect" | "close"> {
    const service = injected ?? createApkSignatureService();
    return {
      inspect: service.inspect.bind(service),
      close: service.close.bind(service),
    };
  },
} as const;
