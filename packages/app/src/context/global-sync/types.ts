import type {
  Agent,
  Config,
  LspStatus,
  Message,
  Part,
  Path,
  PermissionRequest,
  QuestionRequest,
  ReferenceInfo,
  Session,
  SessionStatus,
  Todo,
  VcsInfo,
  Vulnerability,
} from "@cyberstrike-io/sdk/v2/client"
import type { FileDiffInfo } from "@cyberstrike-io/client/promise"
import { NormalizedProviderListResponse } from "@cyberstrike-io/session-ui/context"
import type { CommandInfo, McpResource, McpServer, SessionMessageInfo } from "@cyberstrike-io/client/promise"
import type { Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"

export type ProjectMeta = {
  name?: string
  icon?: {
    override?: string
    color?: string
  }
  commands?: {
    start?: string
  }
}

export type State = {
  status: "loading" | "partial" | "complete"
  agent: Agent[]
  command: CommandInfo[]
  reference: ReferenceInfo[]
  project: string
  projectMeta: ProjectMeta | undefined
  icon: string | undefined
  provider_ready: boolean
  provider: NormalizedProviderListResponse
  config: Config
  path: Path
  session: Session[]
  sessionTotal: number
  session_status: {
    [sessionID: string]: SessionStatus
  }
  session_working(id: string): boolean
  session_diff: {
    [sessionID: string]: FileDiffInfo[]
  }
  todo: {
    [sessionID: string]: Todo[]
  }
  permission: {
    [sessionID: string]: PermissionRequest[]
  }
  question: {
    [sessionID: string]: QuestionRequest[]
  }
  mcp_ready: boolean
  mcp: {
    [name: string]: McpServer["status"]
  }
  mcp_resource: {
    [key: string]: McpResource
  }
  lsp_ready: boolean
  lsp: LspStatus[]
  vcs: VcsInfo | undefined
  limit: number
  message: {
    [sessionID: string]: Message[]
  }
  session_message: {
    [sessionID: string]: SessionMessageInfo[]
  }
  part: {
    [messageID: string]: Part[]
  }
  part_text_accum_delta: {
    [partID: string]: string
  }
  vulnerability: {
    [sessionID: string]: Vulnerability[]
  }
  bolt: {
    [name: string]: { status: string; error?: string }
  }
  session_queue_status: {
    [sessionID: string]: { paused: boolean; pending: number }
  }
  session_hackbrowser_status: {
    [sessionID: string]: {
      sessionID: string
      phase: "starting" | "crawling" | "completed" | "failed"
      targetUrl: string
      pagesExplored: number
      capturedEndpoints: number
      currentPage?: string
      errors: string[]
      startedAt: number
      finishedAt?: number
      cost?: number
    }
  }
  methodology: {
    [sessionID: string]: {
      currentPhase: string | null
      completedCount: number
      totalCount: number
      totalEntries: number
      coveragePercent: number
      completedChecks: number
      totalChecks: number
      chains: number
      violations: number
    }
  }
  session_usage: {
    [sessionID: string]: {
      totalCost: number
      totalTokens: number
    }
  }
  request_observation: {
    [keyHash: string]: {
      credentials: (string | null)[]
      params: {
        name: string
        loc: string
        byCredential: { credentialID: string | null; values: string[]; redacted: boolean }[]
      }[]
    }
  }
  vortex_captures: {
    [sessionID: string]: {
      requests: Array<{ id: string; method: string; host: string; port?: number; normalized_path: string; page_url?: string; key_hash?: string; status?: number; identity?: string; operation?: string }>
      jsFiles: Array<{ url: string; hit: boolean }>
    }
  }
  vortex_signals: {
    [sessionID: string]: {
      signals: Array<{ ruleId: string; category: string; severity: string; title: string; method?: string; endpoint?: string; keyHash?: string; owner?: string; routed: boolean; status?: "pending" | "examined"; triage?: "new" | "reviewed" | "confirmed" | "dismissed" | "escalated" }>
    }
  }
  web_credential: {
    [sessionID: string]: Array<{ id: string; label: string; type: string }>
  }
  web_role: {
    [sessionID: string]: Array<{ id: string; name: string; level?: number }>
  }
  web_object: {
    [sessionID: string]: Array<{ id: string; name: string }>
  }
  web_function: {
    [sessionID: string]: Array<{ id: string; name: string; action_type: string }>
  }
  web_retest: {
    [sessionID: string]: Array<{
      id: string
      status: string
      priority: string
      key_hash: string
      method?: string
      endpoint?: string
      flags?: { object_value?: string[]; role?: string[]; signal?: string[]; credential?: string[] }
    }>
  }
  inspection_lifecycle: {
    [sessionID: string]: {
      phase: "idle" | "discovering" | "inspecting" | "draining" | "complete"
      sources: Array<{ name: string; active: boolean }>
      counts: { pending: number; examined: number; total: number }
    }
  }
}

export type VcsCache = {
  store: Store<{ value: VcsInfo | undefined }>
  setStore: SetStoreFunction<{ value: VcsInfo | undefined }>
  ready: Accessor<boolean>
}

export type MetaCache = {
  store: Store<{ value: ProjectMeta | undefined }>
  setStore: SetStoreFunction<{ value: ProjectMeta | undefined }>
  ready: Accessor<boolean>
}

export type IconCache = {
  store: Store<{ value: string | undefined }>
  setStore: SetStoreFunction<{ value: string | undefined }>
  ready: Accessor<boolean>
}

export type ChildOptions = {
  bootstrap?: boolean
  mcp?: boolean
}

export type DirState = {
  lastAccessAt: number
}

export type EvictPlan = {
  stores: string[]
  state: Map<string, DirState>
  pins: Set<string>
  max: number
  ttl: number
  now: number
}

export type DisposeCheck = {
  directory: string
  hasStore: boolean
  pinned: boolean
  booting: boolean
  loadingSessions: boolean
}

export const MAX_DIR_STORES = 30
export const DIR_IDLE_TTL_MS = 20 * 60 * 1000
export const SESSION_RECENT_WINDOW = 4 * 60 * 60 * 1000
export const SESSION_RECENT_LIMIT = 50
