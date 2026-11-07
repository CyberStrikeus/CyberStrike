import { PythonPycService } from "../application/python/PythonPycService.js";
import { PythonPycProvider } from "../python/PythonPycProvider.js";

/** Compose read-only pyc inspection without invoking CPython or writing files. */
export const createPythonPycService = (): PythonPycService =>
  new PythonPycService(new PythonPycProvider());
