import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="10" r="5.5" stroke="var(--icon-strong-base)" stroke-width="1.5" fill="none" />
      <circle cx="8" cy="10" r="1.2" fill="var(--icon-strong-base)" />
      <path d="M8 1.5v4M8 14.5v4M0.5 10h4M11.5 10h4" stroke="var(--icon-strong-base)" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="40" cy="50" r="26" stroke="var(--icon-strong-base)" stroke-width="5" fill="none" />
      <circle cx="40" cy="50" r="5" fill="var(--icon-base)" />
      <path d="M40 8v20M40 72v20M2 50h20M58 50h20" stroke="var(--icon-strong-base)" stroke-width="5" stroke-linecap="round" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 280 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <circle cx="16" cy="21" r="8" stroke="var(--icon-strong-base)" stroke-width="2.5" fill="none" />
        <circle cx="16" cy="21" r="2" fill="var(--icon-base)" />
        <path d="M16 6v7M16 29v7M1 21h7M25 21h7" stroke="var(--icon-strong-base)" stroke-width="2.5" stroke-linecap="round" />
        <text x="42" y="30" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-weight="800" font-size="26" letter-spacing="3" fill="var(--icon-strong-base)">CYBERSTRIKE</text>
      </g>
    </svg>
  )
}
