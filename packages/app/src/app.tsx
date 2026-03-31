import "@/index.css"
import { ErrorBoundary, Show, Suspense, createEffect, createSignal, lazy, type JSX, type ParentProps } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@cyberstrike-io/ui/font"
import { MarkedProvider } from "@cyberstrike-io/ui/context/marked"
import { DiffComponentProvider } from "@cyberstrike-io/ui/context/diff"
import { CodeComponentProvider } from "@cyberstrike-io/ui/context/code"
import { I18nProvider } from "@cyberstrike-io/ui/context"
import { Diff } from "@cyberstrike-io/ui/diff"
import { Code } from "@cyberstrike-io/ui/code"
import { ThemeProvider } from "@cyberstrike-io/ui/theme"
import { GlobalSyncProvider } from "@/context/global-sync"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { normalizeServerUrl, ServerProvider, useServer } from "@/context/server"
import { Button } from "@cyberstrike-io/ui/button"
import { Mark } from "@cyberstrike-io/ui/logo"
import { SettingsProvider } from "@/context/settings"
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
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
const Home = lazy(() => import("@/pages/home"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => <div class="size-full" />

const HomeRoute = () => (
  <Suspense fallback={<Loading />}>
    <Home />
  </Suspense>
)

const SessionRoute = () => (
  <SessionProviders>
    <Suspense fallback={<Loading />}>
      <Session />
    </Suspense>
  </SessionProviders>
)

const SessionIndexRoute = () => <Navigate href="session" />

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

function AppShellProviders(props: ParentProps) {
  return (
    <SettingsProvider>
      <PermissionProvider>
        <LayoutProvider>
          <NotificationProvider>
            <ModelsProvider>
              <CommandProvider>
                <HighlightsProvider>
                  <Layout>{props.children}</Layout>
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
  if (props.storedDefaultServerUrl) return props.storedDefaultServerUrl
  if (props.hostname.includes("cyberstrike.io")) return "http://localhost:4096"
  if (props.isDev) return `http://${props.devHost ?? "localhost"}:${props.devPort ?? "4096"}`
  return props.origin
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
                    <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
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

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.url} keyed>
      {props.children}
    </Show>
  )
}

function AuthGate(props: ParentProps) {
  const server = useServer()
  const language = useLanguage()
  const [username, setUsername] = createSignal("cyberstrike")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal("")
  const [submitted, setSubmitted] = createSignal(false)

  createEffect(() => {
    if (!submitted()) return
    if (server.healthy() === undefined) return
    if (server.needsAuth()) {
      setError(language.t("auth.gate.error"))
      setSubmitted(false)
    } else {
      setSubmitted(false)
    }
  })

  const submit = () => {
    if (!password()) return
    setError("")
    setSubmitted(true)
    server.updateCredentials(username(), password())
  }

  const keyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") submit()
  }

  return (
    <Show when={server.needsAuth()} fallback={props.children}>
      <div class="flex items-center justify-center h-dvh bg-background-base">
        <div class="flex flex-col gap-4 w-full max-w-xs px-4">
          <div class="flex flex-col items-center gap-3 mb-2">
            <Mark class="w-12 opacity-30" />
            <h1 class="text-20-medium text-text-strong">{language.t("auth.gate.title")}</h1>
            <p class="text-14-regular text-text-weak text-center">{language.t("auth.gate.description")}</p>
          </div>
          <div class="flex flex-col gap-3">
            <input
              type="text"
              placeholder={language.t("auth.gate.username")}
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              onKeyDown={keyDown}
              class="w-full px-3 py-2 rounded-md border border-border-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-focus"
            />
            <input
              type="password"
              placeholder={language.t("auth.gate.password")}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              onKeyDown={keyDown}
              autofocus
              class="w-full px-3 py-2 rounded-md border border-border-base bg-surface-base text-14-regular text-text-strong outline-none focus:border-border-focus"
            />
          </div>
          <Show when={error()}>
            <p class="text-12-regular text-text-danger-base text-center">{error()}</p>
          </Show>
          <Button variant="primary" size="large" onClick={submit} disabled={submitted() || !password()}>
            {submitted() ? language.t("auth.gate.checking") : language.t("auth.gate.submit")}
          </Button>
        </div>
      </div>
    </Show>
  )
}

export function AppInterface(props: { defaultUrl?: string; children?: JSX.Element; isSidecar?: boolean }) {
  const platform = usePlatform()
  const storedDefaultServerUrl = getStoredDefaultServerUrl(platform)
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
      <ServerKey>
        <AuthGate>
          <GlobalSDKProvider>
            <GlobalSyncProvider>
            <Router
              root={(routerProps) => <RouterRoot appChildren={props.children}>{routerProps.children}</RouterRoot>}
            >
              <Route path="/" component={HomeRoute} />
              <Route path="/:dir" component={DirectoryLayout}>
                <Route path="/" component={SessionIndexRoute} />
                <Route path="/session/:id?" component={SessionRoute} />
              </Route>
            </Router>
            </GlobalSyncProvider>
          </GlobalSDKProvider>
        </AuthGate>
      </ServerKey>
    </ServerProvider>
  )
}
