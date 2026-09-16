import "solid-js"

interface ImportMetaEnv {
  readonly VITE_CYBERSTRIKE_SERVER_HOST: string
  readonly VITE_CYBERSTRIKE_SERVER_PORT: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*.png" {
  const src: string
  export default src
}

declare module "*.mp4" {
  const src: string
  export default src
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true
    }
  }
}
