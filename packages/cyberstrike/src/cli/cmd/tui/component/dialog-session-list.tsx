import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import { createDebouncedSignal } from "../util/signal"
import { useToast } from "../ui/toast"
import { Spinner } from "./spinner"

function dateCategory(timestamp: number): string {
  const now = new Date()
  const date = new Date(timestamp)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  const monthAgo = new Date(today.getTime() - 30 * 86400000)

  if (date >= today) return "Today"
  if (date >= yesterday) return "Yesterday"
  if (date >= weekAgo) return "This Week"
  if (date >= monthAgo) return "This Month"
  return "Older"
}

export function createSessionListQuery(input: { search?: string }) {
  const search = input.search?.trim()
  return {
    roots: true,
    limit: search ? 30 : 100,
    ...(search ? { search } : {}),
  }
}

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const kv = useKV()
  const toast = useToast()

  const [toDelete, setToDelete] = createSignal<string>()
  const [deleted, setDeleted] = createSignal(new Set<string>())
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [browseResults, { refetch: refetchBrowse }] = createResource(
    () => true,
    async () => {
      const query = createSessionListQuery({})
      const result = await sdk.client.session.list(query).catch(() => ({ data: undefined }))
      return result.data ?? []
    },
  )

  const [searchResults, { refetch: refetchSearch }] = createResource(search, async (query) => {
    if (!query) return undefined
    const q = createSessionListQuery({ search: query })
    const result = await sdk.client.session.list(q).catch(() => ({ data: undefined }))
    return result.data ?? []
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => {
    const result = searchResults() ?? browseResults() ?? sync.data.session
    const synced = new Map(sync.data.session.map((s) => [s.id, s]))
    const ids = new Set(result.map((s) => s.id))

    const current = currentSessionID()
    const extra = current && !ids.has(current)
      ? (() => {
          const s = synced.get(current)
          return s ? [s] : []
        })()
      : []

    return [...result.map((s) => synced.get(s.id) ?? s), ...extra]
      .filter((s) => !deleted().has(s.id))
  })

  const options = createMemo(() => {
    return sessions()
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .map((x) => {
        const category = dateCategory(x.time.updated)
        const isDeleting = toDelete() === x.id
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        return {
          title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer: Locale.time(x.time.updated),
          gutter: isWorking ? <Spinner /> : undefined,
        }
      })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              try {
                const result = await sdk.client.session.delete({
                  sessionID: option.value,
                })
                if (result.error) {
                  toast.show({
                    variant: "error",
                    message: `Failed to delete session`,
                  })
                  setToDelete(undefined)
                  return
                }
              } catch {
                toast.show({
                  variant: "error",
                  message: `Failed to delete session`,
                })
                setToDelete(undefined)
                return
              }
              setDeleted((current) => new Set(current).add(option.value))
              await refetchBrowse()
              if (search()) await refetchSearch()
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
