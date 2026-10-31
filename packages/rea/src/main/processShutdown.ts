type ShutdownSignal = "SIGINT" | "SIGTERM";

/** Exit status a signal-terminated process reports (128 + signal number). */
const SIGNAL_EXIT_STATUS: Readonly<Record<ShutdownSignal, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

interface ShutdownSignalSource {
  on(event: ShutdownSignal, listener: () => void): unknown;
  off(event: ShutdownSignal, listener: () => void): unknown;
}

interface ShutdownInputSource {
  on(event: "end" | "close", listener: () => void): unknown;
  off(event: "end" | "close", listener: () => void): unknown;
}

interface ProcessShutdownEvents {
  readonly signals: ShutdownSignalSource;
  /** Absent when the transport does not own stdin, as the HTTP listener does not. */
  readonly stdin?: ShutdownInputSource;
}

const processShutdownEvents: ProcessShutdownEvents = {
  signals: process,
  stdin: process.stdin,
};

/** Receives the signal that requested shutdown; stdin end and close carry none. */
type ShutdownHandler = (signal?: ShutdownSignal) => void;

/** Register the process events that request shutdown and return their owner. */
export const registerProcessShutdown = (
  handler: ShutdownHandler,
  events: ProcessShutdownEvents = processShutdownEvents,
): (() => void) => {
  const onInterrupt = (): void => handler("SIGINT");
  const onTerminate = (): void => handler("SIGTERM");
  const onInputEnd = (): void => handler();
  events.signals.on("SIGINT", onInterrupt);
  events.signals.on("SIGTERM", onTerminate);
  events.stdin?.on("end", onInputEnd);
  events.stdin?.on("close", onInputEnd);
  return () => {
    events.signals.off("SIGINT", onInterrupt);
    events.signals.off("SIGTERM", onTerminate);
    events.stdin?.off("end", onInputEnd);
    events.stdin?.off("close", onInputEnd);
  };
};

/** Register signals only, for a transport that does not own stdin, and report the signal's exit status. */
export const registerSignalShutdown = (
  handler: (exitStatus: number) => void,
  signals: ShutdownSignalSource = process,
): (() => void) =>
  registerProcessShutdown(
    (signal) => {
      if (signal !== undefined) handler(SIGNAL_EXIT_STATUS[signal]);
    },
    { signals },
  );

/** A signal recorded while startup is still running, before the lifecycle owner can act on it. */
export interface SignalLatch {
  /** Stop recording; returns the exit status of the first signal seen, if any. */
  readonly release: () => number | undefined;
}

/** Record the first SIGINT or SIGTERM during startup and exit at once on a second one, so startup never dies without its cleanup. */
export const latchSignalShutdown = (
  signals: ShutdownSignalSource = process,
  exit: (status: number) => void = (status) => process.exit(status),
): SignalLatch => {
  let pending: number | undefined;
  const record = (signal: ShutdownSignal) => (): void => {
    if (pending === undefined) pending = SIGNAL_EXIT_STATUS[signal];
    else exit(pending);
  };
  const onInterrupt = record("SIGINT");
  const onTerminate = record("SIGTERM");
  signals.on("SIGINT", onInterrupt);
  signals.on("SIGTERM", onTerminate);
  return {
    release: () => {
      signals.off("SIGINT", onInterrupt);
      signals.off("SIGTERM", onTerminate);
      return pending;
    },
  };
};

/** The exit status an entry reports: a signal's status survives the entry's normal `0` return. */
export interface ExitStatus {
  /** The entry's own result; a `0` after a recorded signal keeps the signal's status. */
  readonly set: (code: number) => void;
  /** Record the exit status of a signal-requested shutdown. */
  readonly signal: (status: number) => void;
}

export const createExitStatus = (
  setExitCode: (code: number) => void,
): ExitStatus => {
  let signalStatus: number | undefined;
  return {
    set: (code) => {
      setExitCode(
        code === 0 && signalStatus !== undefined ? signalStatus : code,
      );
    },
    signal: (status) => {
      signalStatus = status;
      setExitCode(status);
    },
  };
};
