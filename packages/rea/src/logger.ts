import pino, { type Logger } from "pino";
import type { LogLevel } from "./config/processStart.js";

/** Create a JSON logger on stderr so protocol and CLI result stdout stay valid. */
export const createLogger = (mode: "mcp" | "cli", level: LogLevel): Logger =>
  pino(
    {
      level,
      base: { application: "rea", mode },
    },
    pino.destination({ dest: 2, sync: false }),
  );

/** Logger used by embedders that have not opted into process output. */
export const silentLogger = pino({ level: "silent" });
