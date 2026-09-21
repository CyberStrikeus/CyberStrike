// Minimal structured logger for the brain service.
export namespace Log {
  export function create(service: string) {
    return {
      info(msg: string, data?: Record<string, unknown>) {
        console.log(JSON.stringify({ level: "info", service, msg, ...data, t: Date.now() }))
      },
      error(msg: string, data?: Record<string, unknown>) {
        console.error(JSON.stringify({ level: "error", service, msg, ...data, t: Date.now() }))
      },
      warn(msg: string, data?: Record<string, unknown>) {
        console.warn(JSON.stringify({ level: "warn", service, msg, ...data, t: Date.now() }))
      },
    }
  }
}
