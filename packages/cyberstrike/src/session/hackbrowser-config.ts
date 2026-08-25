import { HackbrowserStatus } from "./hackbrowser-status"
import { WebCredential } from "./web/web-credential"
import { Question } from "../question"

export namespace HackbrowserConfig {
  export interface Result {
    mode: HackbrowserStatus.Mode
    headless: boolean
    loginCredentials?: Array<{ username: string; password: string; label?: string }>
    steps: number
  }

  const DEPTH_OPTIONS: readonly Question.Option[] = [
    { label: "Shallow (20 pages)", description: "Quick scan — login + main features only." },
    { label: "Normal (50 pages)", description: "Standard coverage. Default." },
    { label: "Deep (100 pages)", description: "Thorough — explores secondary features." },
    { label: "Maximum (200 pages)", description: "Full coverage — every reachable page." },
  ]

  const DEPTH_MAP: Record<string, number> = {
    "Shallow (20 pages)": 20,
    "Normal (50 pages)": 50,
    "Deep (100 pages)": 100,
    "Maximum (200 pages)": 200,
  }

  export async function resolve(input: {
    sessionID: string
    mode: HackbrowserStatus.Mode
    explicitLogin?: { username: string; password: string }
    explicitSteps?: number
    tool?: { messageID: string; callID: string }
  }): Promise<Result> {
    const headless = input.mode === "full-auto-headless"
    const vaultCreds = WebCredential.getLoginCredentials(input.sessionID)

    if (input.explicitSteps && !vaultCreds.length && !input.explicitLogin) {
      return {
        mode: input.mode,
        headless,
        loginCredentials: input.explicitLogin ? [input.explicitLogin] : undefined,
        steps: input.explicitSteps,
      }
    }

    const questions: Question.Info[] = []

    if (vaultCreds.length > 0) {
      const authOptions: Question.Option[] = []

      if (vaultCreds.length > 1) {
        const labels = vaultCreds.map((c) => c.label).join(", ")
        authOptions.push({
          label: "All credentials (multi-pass)",
          description: `Anonymous + ${labels} — sequential crawl per role, auto-diff.`,
        })
      }

      for (const cred of vaultCreds) {
        authOptions.push({
          label: `${cred.label} (${cred.username})`,
          description: `Single-pass crawl as ${cred.label}.`,
        })
      }

      authOptions.push({
        label: "Anonymous only",
        description: "No login — crawl as unauthenticated visitor.",
      })

      questions.push({
        question: "Which credentials should the crawler use?",
        header: "Auth",
        options: authOptions,
        custom: false,
      })
    }

    if (!input.explicitSteps) {
      questions.push({
        question: "How deep should the crawl go?",
        header: "Depth",
        options: [...DEPTH_OPTIONS],
        custom: false,
      })
    }

    if (questions.length === 0) {
      return {
        mode: input.mode,
        headless,
        loginCredentials: input.explicitLogin ? [input.explicitLogin] : undefined,
        steps: input.explicitSteps ?? 50,
      }
    }

    const answers = await Question.ask({
      sessionID: input.sessionID,
      questions,
      tool: input.tool,
    })

    let loginCredentials: Array<{ username: string; password: string; label?: string }> | undefined
    let steps = input.explicitSteps ?? 50

    let answerIdx = 0

    if (vaultCreds.length > 0) {
      const authAnswer = answers[answerIdx]?.[0] ?? "Anonymous only"
      answerIdx++

      if (authAnswer === "All credentials (multi-pass)") {
        loginCredentials = vaultCreds.map((c) => ({
          username: c.username!,
          password: c.password!,
          label: c.label,
        }))
      } else if (authAnswer !== "Anonymous only") {
        const selected = vaultCreds.find(
          (c) => authAnswer.startsWith(c.label) || authAnswer.includes(c.username!),
        )
        if (selected) {
          loginCredentials = [{ username: selected.username!, password: selected.password!, label: selected.label }]
        }
      }
    }

    if (!input.explicitSteps) {
      const depthAnswer = answers[answerIdx]?.[0] ?? "Normal (50 pages)"
      steps = DEPTH_MAP[depthAnswer] ?? 50
    }

    if (!loginCredentials && input.explicitLogin) {
      loginCredentials = [input.explicitLogin]
    }

    return { mode: input.mode, headless, loginCredentials, steps }
  }
}
