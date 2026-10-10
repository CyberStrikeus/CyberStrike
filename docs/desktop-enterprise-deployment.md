# Desktop — enterprise deployment

How to distribute and install the CyberStrike desktop app in locked-down
enterprise environments (managed fleets, GPO/MDM, AV + application allow-listing).
Tracking issue: #103.

The desktop app is Electron. The release pipeline (`.github/workflows/desktop.yml`)
builds four targets — `mac-arm64`, `mac-x64`, `windows-x64`, `linux-x64` — and
publishes signed installers to GitHub Releases on the `beta` / `prod` channels.

## Installer formats

| OS | Direct download | Managed (silent) deploy |
|----|-----------------|-------------------------|
| Windows | `.exe` (NSIS, one-click) | **`.msi`** (Intune / SCCM / GPO) |
| macOS | `.dmg`, `.zip` | **`.pkg`** (Jamf / MDM) |
| Linux | `.AppImage` | `.deb`, `.rpm` (apt / yum / dnf) |

## Code signing (why it installs cleanly)

Enterprises block unsigned binaries at the AV, SmartScreen, Gatekeeper and
allow-list layers. Every managed installer is signed:

- **macOS** — Developer ID Application cert `Aum Labs LLC (NN7KV47TN6)`, hardened
  runtime + notarization (`.app`/`.dmg`), Developer ID **Installer** cert for the
  `.pkg`. Wired in CI via `MAC_CERT_P12` / `APPLE_*` / `MAC_INSTALLER_CERT_P12`. (#48)
- **Windows** — Authenticode signature via `script/sign-windows.ps1`, applied to
  the `.exe` and `.msi`. Wired in CI via `WINDOWS_SIGN_CERT` (base64 `.pfx`) +
  `WINDOWS_SIGN_PASSWORD`. **Requires purchasing an Authenticode cert:**
  - *OV* — cheaper; SmartScreen reputation builds up over downloads.
  - *EV* — clears SmartScreen immediately; ships on an HSM/USB token.
- **Linux** — `.deb`/`.rpm` run unsigned; GPG-sign + host an apt/yum repo for a
  trusted managed source (optional, not yet set up).

Signing degrades gracefully: when a cert secret is unset the build still produces
an **unsigned** artifact instead of failing, so dev/CI never breaks.

## Silent / unattended install

**Windows (MSI, machine-wide):**
```powershell
msiexec /i cyberstrike-desktop-win-x64.msi /qn /norestart
# uninstall
msiexec /x cyberstrike-desktop-win-x64.msi /qn
```
Intune: upload the `.msi` as a Line-of-business app. SCCM/GPO: deploy per-machine
(the MSI is built `perMachine: true`).

**macOS (pkg, MDM):**
```bash
sudo installer -pkg CyberStrike-<version>.pkg -target /
```
Jamf/Intune/Munki: push the signed `.pkg`; it installs to `/Applications`,
non-relocatable, no Gatekeeper prompt once notarized.

**Linux:**
```bash
sudo apt install ./cyberstrike-desktop-linux-x64.deb      # Debian/Ubuntu
sudo dnf install ./cyberstrike-desktop-linux-x64.rpm      # Fedora/RHEL
chmod +x cyberstrike-desktop-*.AppImage && ./cyberstrike-...AppImage   # portable
```

## Auto-update behind a corporate proxy

`electron-updater` pulls from GitHub Releases (`publish` block in
`electron-builder.config.ts`). It uses the system/`HTTPS_PROXY` settings, so it
works through a corporate proxy. For fully air-gapped fleets, disable auto-update
and push new versions through the MDM/MSI channel instead.

## Required secrets (GitHub Actions)

| Secret | Purpose |
|--------|---------|
| `MAC_CERT_P12` / `MAC_CERT_PASSWORD` | macOS app signing |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | notarization |
| `MAC_INSTALLER_CERT_P12` / `MAC_INSTALLER_CERT_PASSWORD` | `.pkg` signing |
| `WINDOWS_SIGN_CERT` (base64 `.pfx`) / `WINDOWS_SIGN_PASSWORD` | Authenticode |

## Remaining (needs a maintainer / a purchase)

- [ ] Buy a Windows Authenticode cert (OV or EV) and add the two `WINDOWS_SIGN_*` secrets.
- [ ] Add `MAC_INSTALLER_CERT_P12` (Developer ID **Installer** cert) for signed `.pkg`.
- [ ] (Optional) GPG-signed apt/yum repo for Linux fleets.
- [ ] Download/releases page linking the signed artifacts.
