// Toast shim for the v2 shell (Phase B spike).
//
// The v2 shell expects a `utils/toast` that bridges a legacy toaster and a v2
// toaster (a `v2/toast-v2` region) behind a `setV2Toast` flag. CyberStrike's ui
// package does not yet ship the v2 toaster, so this shim renders the EXISTING
// `@cyberstrike-io/ui/toast` region for both modes. `setV2Toast` is retained as
// a no-op switch so `NewLayout` keeps its call site; when a real v2 toaster is
// ported it can branch here without touching callers.
import { Toast } from "@cyberstrike-io/ui/toast"

let v2 = false

export function setV2Toast(value: boolean) {
  v2 = value
}

export function isV2Toast() {
  return v2
}

export function ToastRegion(_props: { v2?: boolean }) {
  return <Toast.Region />
}

export { showToast } from "@cyberstrike-io/ui/toast"
