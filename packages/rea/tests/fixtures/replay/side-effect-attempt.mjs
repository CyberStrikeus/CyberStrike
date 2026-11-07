export default function attempt() {
  return {
    process: typeof process,
    require: typeof require,
    fetch: typeof fetch,
    buffer: typeof Buffer,
    timer: typeof setTimeout,
  };
}
