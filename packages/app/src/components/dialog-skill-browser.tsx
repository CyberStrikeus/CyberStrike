import { Component, createMemo, createResource, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { usePrompt } from "@/context/prompt"
import { Dialog } from "@cyberstrike-io/ui/dialog"
import { List } from "@cyberstrike-io/ui/list"
import { useDialog } from "@cyberstrike-io/ui/context/dialog"

type SkillItem = {
  name: string
  description: string
  category?: string
  verified?: string
}

export const DialogSkillBrowser: Component = () => {
  const sdk = useSDK()
  const prompt = usePrompt()
  const dialog = useDialog()

  const [skills] = createResource(async () => {
    const s = sdk()
    if (!s) return []
    try {
      const res = await (s.client as any).skill.list()
      const data = res?.data as SkillItem[] | undefined
      return data ?? []
    } catch {
      return []
    }
  })

  const items = createMemo(() => skills() ?? [])

  return (
    <Dialog title="Skills" description={`${items().length} skills available`}>
      <List
        search={{
          placeholder: "Search skills...",
          autofocus: true,
        }}
        emptyMessage="No skills found"
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "description", "category"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(skill) => {
          if (!skill) return
          const text = `/${skill.name} `
          prompt.set([{ type: "text", content: text, start: 0, end: text.length }])
          dialog.close()
        }}
      >
        {(item) => (
          <div class="w-full flex flex-col gap-0.5">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium">{item.name}</span>
              <Show when={item.category}>
                <span class="text-11-regular text-text-weaker">{item.category}</span>
              </Show>
              <Show when={item.verified === "official"}>
                <span class="text-11-regular text-icon-success-base">official</span>
              </Show>
            </div>
            <Show when={item.description}>
              <span class="text-12-regular text-text-weak truncate">{item.description}</span>
            </Show>
          </div>
        )}
      </List>
    </Dialog>
  )
}
