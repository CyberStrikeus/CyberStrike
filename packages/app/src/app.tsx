import "@/index.css"
import {
  createMemo,
  createResource,
  ErrorBoundary,
  Match,
  Show,
  Suspense,
  Switch,
  lazy,
  type JSX,
  type ParentProps,
} from "solid-js"
import { Router, Route, Navigate, useParams, useSearchParams } from "@solidjs/router"
import { base64Encode } from "@cyberstrike-io/util/encode"
import { MetaProvider } from "@solidjs/meta"
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query"
import { Font } from "@cyberstrike-io/ui/font"
import { MarkedProvider } from "@cyberstrike-io/ui/context/marked"
import { DiffComponentProvider } from "@cyberstrike-io/ui/context/diff"
import { CodeComponentProvider } from "@cyberstrike-io/ui/context/code"
import { I18nProvider } from "@cyberstrike-io/ui/context"
import { Diff } from "@cyberstrike-io/ui/diff"
import { Code } from "@cyberstrike-io/ui/code"
import { ThemeProvider } from "@cyberstrike-io/ui/theme"
import { GlobalSyncProvider, useGlobalSync } from "@/context/global-sync"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider, useGlobalSDK } from "@/context/global-sdk"
import { normalizeServerUrl, ServerProvider, useServer } from "@/context/server"
import { HubConnectScreen } from "@/components/hub-connect"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { CommentsProvider } from "@/context/comments"
import { NotificationProvider } from "@/context/notification"
import { ModelsProvider } from "@/context/models"
import { DialogProvider } from "@cyberstrike-io/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { LanguageProvider, useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { HighlightsProvider } from "@/context/highlights"
import { SettingsProvider, useSettings } from "@/context/settings"
import { TabsProvider, useTabs, type DraftTab } from "@/context/tabs"
import { GlobalProvider } from "@/context/global"
import Layout from "@/pages/layout"
import NewLayout from "@/pages/layout-new"
import DirectoryLayout, { DirectoryProviders } from "@/pages/directory-layout"
import { legacySessionHref } from "@/utils/session-route"
import { ErrorPage } from "./pages/error"
const Home = lazy(() => import("@/pages/home"))
const HomeV2 = lazy(() => import("@/pages/home-v2"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => <div class="size-full" />

// Flag OFF renders the legacy home unchanged. Flag ON renders the ported v2 home,
// which reads useGlobal()/useTabs() — both provided only by the flag-on ShellLayout
// branch that mounts GlobalProvider/TabsProvider around this route.
const HomeRoute = () => {
  const settings = useSettings()
  return (
    <Suspense fallback={<Loading />}>
      <Show when={settings.general.newLayoutDesigns()} fallback={<Home />}>
        <HomeV2 />
      </Show>
    </Suspense>
  )
}

const SessionRoute = () => (
  <SessionProviders>
    <Suspense fallback={<Loading />}>
      <Session />
    </Suspense>
  </SessionProviders>
)

const SessionIndexRoute = () => <Navigate href="session" />

// The v2 tab machine sends drafts to /new-session?draftId=… (context/tabs.tsx
// `draftHref`). Without a matching route, "/new-session" fell through to /:dir with
// dir="new-session"; DirectoryLayout's decode64("new-session") is not valid base64 and
// yields U+FFFD replacement bytes, which became useSDK().directory and were written as
// the created session's `directory` — so sessions could not be located/rendered by
// directory (blank sessions, broken tab-return). This route resolves the draft's real
// target directory (single-server) and renders the new-session composer inside the same
// per-directory context DirectoryLayout establishes, keyed on that real path — so
// useSDK().directory is a real project path and submit.ts creates a correct session.
const DraftRoute = () => {
  const settings = useSettings()
  return (
    <Show when={settings.general.newLayoutDesigns()} fallback={<Navigate href="/" />}>
      <DraftComposer />
    </Show>
  )
}

const DraftComposer = () => {
  const [search] = useSearchParams<{ draftId?: string }>()
  const tabs = useTabs()
  const globalSync = useGlobalSync()
  // Resolve the draft's target directory from its DraftTab; fall back to the current
  // single-server project so the composer always mounts on a real path, never on the
  // string "new-session".
  const directory = createMemo(() => {
    const id = search.draftId
    const draft = id
      ? tabs.store.find((tab): tab is DraftTab => tab.type === "draft" && tab.draftID === id)
      : undefined
    if (draft?.directory) return draft.directory
    return globalSync.data.project[0]?.worktree ?? ""
  })
  return (
    <Show when={tabs.ready()} fallback={<Loading />}>
      <Show when={directory()} keyed fallback={<Navigate href="/" />}>
        {(dir) => (
          <DirectoryProviders directory={() => dir} dirBase64={() => base64Encode(dir)}>
            <SessionProviders>
              <Suspense fallback={<Loading />}>
                <Session />
              </Suspense>
            </SessionProviders>
          </DirectoryProviders>
        )}
      </Show>
    </Show>
  )
}

// Session view needs. Uses only the always-mounted global SDK, so it is safe regardless
// of the newLayoutDesigns shell branch.
const ServerSessionRoute = () => {
  const params = useParams<{ key: string; id: string }>()
  const sdk = useGlobalSDK()
  const [directory] = createResource(
    () => params.id,
    (sessionID) =>
      sdk.client.session
        .get({ sessionID })
        .then((response) => response.data?.directory)
        .catch(() => undefined),
  )
  return (
    <Suspense fallback={<Loading />}>
      <Show when={directory()} fallback={<Loading />}>
        {(dir) => <Navigate href={legacySessionHref(dir(), params.id)} />}
      </Show>
    </Suspense>
  )
}

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.locale, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __CYBERSTRIKE__?: { updaterEnabled?: boolean; serverPassword?: string; deepLinks?: string[]; wsl?: boolean }
  }
}

function MarkedProviderWithNativeParser(props: ParentProps) {
  const platform = usePlatform()
  return <MarkedProvider nativeParser={platform.parseMarkdown}>{props.children}</MarkedProvider>
}

// Branches the rendered shell on the `newLayoutDesigns` flag. Default (flag OFF)
// renders the legacy `Layout` unchanged. Flag ON mounts the single-server tabs
// adapter and renders the ported v2 `NewLayout`. Nothing about the legacy path
// changes when the flag is off.
function ShellLayout(props: ParentProps) {
  const settings = useSettings()
  return (
    <Show when={settings.general.newLayoutDesigns()} fallback={<Layout>{props.children}</Layout>}>
      <GlobalProvider>
        <TabsProvider>
          <NewLayout>{props.children}</NewLayout>
        </TabsProvider>
      </GlobalProvider>
    </Show>
  )
}

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <ShellLayout>{props.children}</ShellLayout>
                </HighlightsProvider>
              </CommandProvider>
            </ModelsProvider>
          </NotificationProvider>
        </LayoutProvider>
      </PermissionProvider>
    </SettingsProvider>
  )
}

function SessionProviders(props: ParentProps) {
  return (
    <TerminalProvider>
      <FileProvider>
        <PromptProvider>
          <CommentsProvider>{props.children}</CommentsProvider>
        </PromptProvider>
      </FileProvider>
    </TerminalProvider>
  )
}

function RouterRoot(props: ParentProps<{ appChildren?: JSX.Element }>) {
  return (
    <AppShellProviders>
      {props.appChildren}
      {props.children}
    </AppShellProviders>
  )
}

const getStoredDefaultServerUrl = (platform: ReturnType<typeof usePlatform>) => {
  if (platform.platform !== "web") return
  const result = platform.getDefaultServerUrl?.()
  if (result instanceof Promise) return
  if (!result) return
  return normalizeServerUrl(result)
}

const resolveDefaultServerUrl = (props: {
  defaultUrl?: string
  storedDefaultServerUrl?: string
  hostname: string
  origin: string
  isDev: boolean
  devHost?: string
  devPort?: string
}) => {
  if (props.defaultUrl) return props.defaultUrl
  // Hub mode: always show connect screen (storedDefault may point to stale localhost)
  if (props.hostname === "cyberstrike.io" || props.hostname.endsWith(".cyberstrike.io")) return ""
  if (props.storedDefaultServerUrl) return props.storedDefaultServerUrl
  if (props.isDev) return `http://${props.devHost ?? "localhost"}:${props.devPort ?? "4096"}`
  return props.origin
}

// Single top-level TanStack Query client. Ported v2 components (e.g. the titlebar
// tab-nav rename via createMutation) resolve their client from this provider;
// without it useQueryClient() is undefined and mutations crash at defaultMutationOptions.
function QueryProvider(props: ParentProps) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnReconnect: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  })
  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
}

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>
                <MarkedProviderWithNativeParser>
                  <DiffComponentProvider component={Diff}>
                    <CodeComponentProvider component={Code}>
                      <QueryProvider>{props.children}</QueryProvider>
                    </CodeComponentProvider>
                  </DiffComponentProvider>
                </MarkedProviderWithNativeParser>
              </DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function HubGate(props: ParentProps & { active: boolean }) {
  const server = useServer()
  const gate = createMemo(() => {
    if (!props.active) return "pass"
    if (!server.current) return "connect"
    return server.healthy() === true ? "pass" : "connect"
  })
  return (
    <Switch>
      <Match when={gate() === "pass"}>{props.children}</Match>
      <Match when={gate() === "connect"}>
        <HubConnectScreen />
      </Match>
    </Switch>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  const key = createMemo(() => {
    const c = server.current
    if (!c) return ""
    return `${c.http.url}\n${c.http.username ?? ""}\n${c.http.password ?? ""}`
  })
  return (
    <Show when={key()} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: { defaultUrl?: string; children?: JSX.Element; isSidecar?: boolean }) {
  const platform = usePlatform()
  const storedDefaultServerUrl = getStoredDefaultServerUrl(platform)
  const isHub =
    !props.defaultUrl &&
    !props.isSidecar &&
    (location.hostname === "cyberstrike.io" || location.hostname.endsWith(".cyberstrike.io"))
  if (isHub) console.info("[cyberstrike] hub mode:", location.hostname)
  const defaultServerUrl = resolveDefaultServerUrl({
    defaultUrl: props.defaultUrl,
    storedDefaultServerUrl,
    hostname: location.hostname,
    origin: window.location.origin,
    isDev: import.meta.env.DEV,
    devHost: import.meta.env.VITE_CYBERSTRIKE_SERVER_HOST,
    devPort: import.meta.env.VITE_CYBERSTRIKE_SERVER_PORT,
  })

  return (
    <ServerProvider defaultUrl={defaultServerUrl} isSidecar={props.isSidecar}>
      <HubGate active={isHub}>
        <ServerKey>
          <GlobalSDKProvider>
            <GlobalSyncProvider>
              <Router
                root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
              >
                <Route path="/" component={HomeRoute} />
                <Route path="/new-session" component={DraftRoute} />
                <Route path="/server/:key/session/:id" component={ServerSessionRoute} />
                <Route path="/:dir" component={DirectoryLayout}>
                  <Route path="/" component={SessionIndexRoute} />
                  <Route path="/session/:id?" component={SessionRoute} />
                </Route>
              </Router>
            </GlobalSyncProvider>
          </GlobalSDKProvider>
        </ServerKey>
      </HubGate>
    </ServerProvider>
  )
}
