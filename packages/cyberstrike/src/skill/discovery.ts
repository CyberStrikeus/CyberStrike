import path from "path"
import { mkdir } from "fs/promises"
import { Log } from "../util/log"
import { Global } from "../global"

export namespace Discovery {
  const log = Log.create({ service: "skill-discovery" })

  type IndexSkill = {
    name: string
    description: string
  } & (
    | { files: string[] }
    | { type: "skill-md" | "archive"; url: string; digest?: string }
  )

  type Index = {
    skills: IndexSkill[]
  }

  export function dir() {
    return path.join(Global.Path.cache, "skills")
  }

  async function get(url: string, dest: string): Promise<boolean> {
    if (await Bun.file(dest).exists()) return true
    return fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to download", { url, status: response.status })
          return false
        }
        await Bun.write(dest, await response.text())
        return true
      })
      .catch((err) => {
        log.error("failed to download", { url, err })
        return false
      })
  }

  export async function pull(url: string): Promise<string[]> {
    const result: string[] = []
    const base = url.endsWith("/") ? url : `${url}/`
    const index = new URL("index.json", base).href
    const cache = dir()
    const host = base.slice(0, -1)

    log.info("fetching index", { url: index })
    const data = await fetch(index)
      .then(async (response) => {
        if (!response.ok) {
          log.error("failed to fetch index", { url: index, status: response.status })
          return undefined
        }
        return response
          .json()
          .then((json) => json as Index)
          .catch((err) => {
            log.error("failed to parse index", { url: index, err })
            return undefined
          })
      })
      .catch((err) => {
        log.error("failed to fetch index", { url: index, err })
        return undefined
      })

    if (!data?.skills || !Array.isArray(data.skills)) {
      log.warn("invalid index format", { url: index })
      return result
    }

    const list = data.skills.filter((skill) => {
      if (!skill?.name) {
        log.warn("invalid skill entry", { url: index, skill })
        return false
      }
      const hasFiles = "files" in skill && Array.isArray(skill.files)
      const hasUrl = "url" in skill && typeof skill.url === "string"
      if (!hasFiles && !hasUrl) {
        log.warn("invalid skill entry", { url: index, skill })
        return false
      }
      return true
    })

    await Promise.all(
      list.map(async (skill) => {
        const root = path.join(cache, skill.name)

        if ("files" in skill && Array.isArray(skill.files)) {
          // Legacy format: array of individual files
          await Promise.all(
            skill.files.map(async (file) => {
              const link = new URL(file, `${host}/${skill.name}/`).href
              const dest = path.join(root, file)
              await mkdir(path.dirname(dest), { recursive: true })
              await get(link, dest)
            }),
          )
        } else if ("url" in skill && typeof skill.url === "string") {
          const link = new URL(skill.url, base).href
          if ("type" in skill && skill.type === "archive") {
            // Archive format: download tar.gz and extract
            const archive = path.join(root, `${skill.name}.tar.gz`)
            await mkdir(root, { recursive: true })
            if (await get(link, archive)) {
              await Bun.$`tar xzf ${archive} -C ${root} 2>/dev/null`.quiet().nothrow()
            }
          } else {
            // Single file (skill-md): download as SKILL.md
            const dest = path.join(root, "SKILL.md")
            await mkdir(root, { recursive: true })
            await get(link, dest)
          }
        }

        const md = path.join(root, "SKILL.md")
        if (await Bun.file(md).exists()) result.push(root)
      }),
    )

    return result
  }
}
