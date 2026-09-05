export type Location = "query" | "form_field" | "json_body" | "header" | "cookie" | "path"

export interface InjPoint {
  location: Location
  name: string
}

export interface ResolvedRequest {
  method: string
  url: URL
  headers: Record<string, string>
  body: string
  contentType: string
  auth: { source: string }
  provenance: { fromRaw: boolean; reconstructed: boolean; bodyMaybeTruncated: boolean }
}

export interface SendBudget {
  sent: number
  max: number
}

export type SendOk = { status: number; text: string; ms: number; headers: Record<string, string> }
export type SendResult = SendOk | { error: string; timeout?: boolean }
