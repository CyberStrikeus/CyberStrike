import { Component, createMemo, createResource } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"
import { Dialog } from "@cyberstrike-io/ui/dialog"
import { List } from "@cyberstrike-io/ui/list"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { getRelativeTime } from "@/utils/time"

type SessionEntry = {
  id: string
  title: string
  updated: number
  current: boolean
}

export const DialogSelectSession: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()
  const dialog = useDialog()
  const params = useParams()
  const navigate = useNavigate()

  const [sessions] = createResource(async () => {
    const result = await sdk.client.session.list()
    return result.data ?? []
  })

  const items = createMemo<SessionEntry[]>(() => {
    const list = sessions() ?? []
    return list
      .map((s) => ({
        id: s.id,
        title: s.title || s.id.slice(0, 8),
        updated: s.time.updated,
        current: s.id === params.id,
      }))
      .sort((a, b) => b.updated - a.updated)
  })

  const total = createMemo(() => items().length)

  return (
    <Dialog
      title={language.t("dialog.session.title")}
      description={language.t("dialog.session.description", { total: total() })}
    >
      <List
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.session.empty")}
        key={(x) => x?.id ?? ""}
        items={items}
        filterKeys={["title"]}
        sortBy={(a, b) => b.updated - a.updated}
        onSelect={(x) => {
          if (!x) return
          dialog.close()
          navigate(`/${params.dir}/session/${x.id}`)
        }}
      >
        {(s) => (
          <div class="w-full flex items-center justify-between gap-x-3">
            <div class="flex items-center gap-2 min-w-0">
              <span class="truncate">{s.title}</span>
              {s.current && (
                <span class="text-11-regular text-text-weaker shrink-0">{language.t("dialog.session.current")}</span>
              )}
            </div>
            <span class="text-11-regular text-text-weaker shrink-0">
              {getRelativeTime(new Date(s.updated).toISOString())}
            </span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
