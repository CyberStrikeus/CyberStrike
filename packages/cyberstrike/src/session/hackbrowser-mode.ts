import { HackbrowserStatus } from "./hackbrowser-status"
import { Question } from "../question"

export namespace HackbrowserMode {
  export const PHASE_2: ReadonlySet<string> = new Set(["co-pilot", "observer"])

  const QUESTION_TIMEOUT_MS = 300_000

  export const QUESTION_OPTIONS: readonly Question.Option[] = [
    { label: "Full Auto (Headless)", description: "AI autonomous crawl, no browser window. Fastest." },
    { label: "Full Auto (Headed)", description: "AI autonomous crawl, visible browser. Watch/debug." },
    { label: "Co-Pilot (Coming Soon)", description: "AI crawls, you can pause and intervene." },
    { label: "Observer (Coming Soon)", description: "You browse manually, only traffic captured." },
  ]

  export const LABEL_TO_MODE: Readonly<Record<string, HackbrowserStatus.Mode>> = {
    "Full Auto (Headless)": "full-auto-headless",
    "Full Auto (Headed)": "full-auto-headed",
    "Co-Pilot (Coming Soon)": "co-pilot",
    "Observer (Coming Soon)": "observer",
  }

  export function toConfig(mode: HackbrowserStatus.Mode, credentials?: string[]): { headless: boolean } {
    if (credentials && credentials.length > 0) return { headless: false }
    switch (mode) {
      case "full-auto-headless":
        return { headless: true }
      case "full-auto-headed":
      case "co-pilot":
      case "observer":
        return { headless: false }
    }
  }

  export async function resolve(
    sessionID: string,
    explicitMode: HackbrowserStatus.Mode | undefined,
    tool?: { messageID: string; callID: string },
  ): Promise<HackbrowserStatus.Mode> {
    if (explicitMode) {
      if (PHASE_2.has(explicitMode)) {
        throw new Error(
          `Mode "${explicitMode}" is not available yet. Pass mode="full-auto-headless" or mode="full-auto-headed".`,
        )
      }
      return explicitMode
    }

    const prev = HackbrowserStatus.get(sessionID)

    for (let attempt = 0; attempt < 3; attempt++) {
      const base =
        attempt === 0
          ? [...QUESTION_OPTIONS]
          : QUESTION_OPTIONS.filter((o) => !PHASE_2.has(LABEL_TO_MODE[o.label]))
      const options = [...base]

      if (prev?.mode && !PHASE_2.has(prev.mode)) {
        const prevLabel = Object.entries(LABEL_TO_MODE).find(([, m]) => m === prev.mode)?.[0]
        if (prevLabel) {
          const idx = options.findIndex((o) => o.label === prevLabel)
          if (idx >= 0) {
            const recommended = { ...options[idx], label: `${options[idx].label} (Recommended)` }
            options.splice(idx, 1)
            options.unshift(recommended)
          }
        }
      }

      const questionText =
        attempt > 0
          ? "Co-Pilot and Observer are coming soon. Select an available mode:"
          : "Which crawl mode should I use?"

      let answers: Question.Answer[]
      let timer: ReturnType<typeof setTimeout>
      try {
        answers = await Promise.race([
          Question.ask({
            sessionID,
            questions: [{ question: questionText, header: "Crawl Mode", options, custom: false }],
            tool,
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Mode selection timed out — no response in 5 minutes")),
              QUESTION_TIMEOUT_MS,
            )
          }),
        ])
        clearTimeout(timer!)
      } catch (err) {
        clearTimeout(timer!)
        if (err instanceof Question.RejectedError) {
          throw new Error("Crawl cancelled — user dismissed mode selection.")
        }
        throw err
      }

      const selected = answers[0]?.[0]
      if (!selected) return "full-auto-headless"

      const clean = selected.replace(" (Recommended)", "")
      const mode = LABEL_TO_MODE[clean] ?? "full-auto-headless"

      if (!PHASE_2.has(mode)) return mode
    }

    return "full-auto-headless"
  }
}
