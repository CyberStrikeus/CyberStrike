// Structural copies of the v1 domain shapes this package projects. packages/cyberstrike passes its real domain
// objects in, so a field that drifts from these types is a compile error at the call site, not a wire bug.

export type SessionInput = {
  id: string
  projectID: string
  directory: string
  parentID?: string
  title: string
  time: { created: number; updated: number; archived?: number }
  revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string }
}

export type ErrorInput = { name: string; data?: { message?: string } }

export type PartInput = { id: string; type: string } & Record<string, unknown>

export type MessageInput = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent: string
  model?: { providerID: string; modelID: string }
  providerID?: string
  modelID?: string
  error?: ErrorInput
  finish?: string
  cost?: number
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
}

export type PermissionInput = {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
}

export type QuestionOption = { label: string; description?: string }

export type QuestionInput = {
  id: string
  sessionID: string
  questions: {
    question: string
    header: string
    options: QuestionOption[]
    multiple?: boolean
    custom?: boolean
  }[]
}
