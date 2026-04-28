import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import z from "zod"

export namespace SessionQueueStatus {
  export const Info = z
    .object({
      paused: z.boolean(),
      pending: z.number(),
    })
    .meta({
      ref: "SessionQueueStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.queue.status",
      z.object({
        sessionID: z.string(),
        status: Info,
      }),
    ),
  }

  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  export function get(sessionID: string): Info {
    return (
      state()[sessionID] ?? {
        paused: false,
        pending: 0,
      }
    )
  }

  export function list() {
    return state()
  }

  export function set(sessionID: string, status: Info) {
    Bus.publish(Event.Status, {
      sessionID,
      status,
    })
    if (!status.paused && status.pending === 0) {
      delete state()[sessionID]
      return
    }
    state()[sessionID] = status
  }
}
