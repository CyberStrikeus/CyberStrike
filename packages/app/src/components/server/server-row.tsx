import { Tooltip } from "@cyberstrike-io/ui/tooltip"
import {
  type JSXElement,
  type ParentProps,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js"
import { type ServerConnection, serverName } from "@/context/server"
import type { ServerHealth } from "@/utils/server-health"

interface ServerRowProps extends ParentProps {
  conn: ServerConnection.Any
  status?: ServerHealth
  class?: string
  nameClass?: string
  versionClass?: string
  dimmed?: boolean
  badge?: JSXElement
}

export function ServerRow(props: ServerRowProps) {
  const [truncated, setTruncated] = createSignal(false)
  let nameRef: HTMLSpanElement | undefined
  let versionRef: HTMLSpanElement | undefined
  const name = createMemo(() => serverName(props.conn))

  const check = () => {
    const nameTruncated = nameRef ? nameRef.scrollWidth > nameRef.clientWidth : false
    const versionTruncated = versionRef ? versionRef.scrollWidth > versionRef.clientWidth : false
    setTruncated(nameTruncated || versionTruncated)
  }

  createEffect(() => {
    name()
    props.conn.http.url
    props.status?.version
    queueMicrotask(check)
  })

  onMount(() => {
    check()
    if (typeof ResizeObserver !== "function") return
    const observer = new ResizeObserver(check)
    if (nameRef) observer.observe(nameRef)
    if (versionRef) observer.observe(versionRef)
    onCleanup(() => observer.disconnect())
  })

  const tooltipValue = () => (
    <span class="flex items-center gap-2">
      <span>{serverName(props.conn, true)}</span>
      <Show when={props.status?.version}>
        <span class="text-text-invert-weak">v{props.status?.version}</span>
      </Show>
    </span>
  )

  return (
    <Tooltip
      class="flex-1 min-w-0"
      value={tooltipValue()}
      contentStyle={{ "max-width": "none", "white-space": "nowrap" }}
      placement="top-start"
      inactive={!truncated() && !props.conn.displayName}
    >
      <div class={props.class} classList={{ "opacity-50": props.dimmed }}>
        <div
          classList={{
            "size-1.5 rounded-full shrink-0": true,
            "bg-icon-success-base": props.status?.healthy === true,
            "bg-icon-critical-base": props.status?.healthy === false,
            "bg-border-weak-base": props.status === undefined,
          }}
        />
        <span ref={nameRef} class={props.nameClass ?? "truncate"}>
          {name()}
        </span>
        <Show when={props.status?.version}>
          <span ref={versionRef} class={props.versionClass ?? "text-text-weak text-14-regular truncate"}>
            v{props.status?.version}
          </span>
        </Show>
        {props.badge}
        {props.children}
      </div>
    </Tooltip>
  )
}
