import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "io.cyberstrike.desktop" : `io.cyberstrike.desktop.${channel}`
const productName = channel === "prod" ? "CyberStrike" : `CyberStrike ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `AI-powered offensive security platform${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>AGPL-3.0-only</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="io.cyberstrike">
    <name>CyberStrike</name>
  </developer>

  <description>
    <p>
      CyberStrike is an AI-powered offensive security and penetration testing platform.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/CyberStrikeus/CyberStrike-Enterprise/issues</url>
  <url type="homepage">https://cyberstrike.io</url>
  <url type="vcs-browser">https://github.com/CyberStrikeus/CyberStrike</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
