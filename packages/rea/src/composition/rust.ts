import { RustBinaryService } from "../application/rust/RustBinaryService.js";
import { RustBinaryProvider } from "../rust/RustBinaryProvider.js";

/** Compose bundled offline inspection without a Rust toolchain or any child process. */
export const createRustBinaryService = (): RustBinaryService =>
  new RustBinaryService(new RustBinaryProvider());
