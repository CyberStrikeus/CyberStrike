export interface BrowserVerifierSite {
  readonly origin: string;
  triggerSessionNavigation(): void;
  close(): Promise<void>;
}

export function startBrowserVerifierSite(): Promise<BrowserVerifierSite>;
