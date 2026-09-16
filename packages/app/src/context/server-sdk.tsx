// Single-server ADAPTER (Phase B v2-shell spike).
//
// Upstream's v2 shell scopes the SDK per active server via a `ServerSDKProvider`
// keyed on `ServerConnection.Key`. CyberStrike has exactly one server, so its
// SDK already lives in the always-mounted `context/global-sdk` singleton. This
// module re-presents that singleton under the v2 contract name so ported shell
// pieces can `useServerSDK()` without a multi-server registry underneath.
import { useGlobalSDK } from "./global-sdk"

export const useServerSDK = useGlobalSDK
export { GlobalSDKProvider as ServerSDKProvider } from "./global-sdk"
