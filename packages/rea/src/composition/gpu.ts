import { GpuCodeObjectsService } from "../application/gpu/GpuCodeObjectsService.js";
import { GpuCodeObjectsProvider } from "../gpu/GpuCodeObjectsProvider.js";
export const createGpuCodeObjectsService = (): GpuCodeObjectsService =>
  new GpuCodeObjectsService(new GpuCodeObjectsProvider());
