import { Il2cppGhidraSeedWriter } from "../il2cpp/Il2cppGhidraSeedWriter.js";
import { Il2cppMetadataService } from "../application/il2cpp/Il2cppMetadataService.js";
import { Il2cppMetadataProvider } from "../il2cpp/Il2cppMetadataProvider.js";

/** Compose bundled offline inspection without acquiring a toolchain or starting any process. */
export const createIl2cppMetadataService = (): Il2cppMetadataService =>
  new Il2cppMetadataService(
    new Il2cppMetadataProvider(),
    new Il2cppGhidraSeedWriter(),
  );
