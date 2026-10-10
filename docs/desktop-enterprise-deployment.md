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
- **Windows** — **Azure Trusted Signing** via `script/sign-windows.ps1` (signtool +
  the Trusted Signing dlib), applied to the `.exe` and `.msi`. Signing runs in
  Azure's cloud HSM — no local `.pfx`, no USB token — and is SmartScreen-trusted.
  The signature certifies the publisher **Aum Labs LLC**, independent of the code's
  open-source license. ~$10/month. Auth via a service principal (`AZURE_*` secrets);
  account/profile via repo variables (`TRUSTED_SIGNING_*`).
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

## Required CI config (GitHub Actions)

Secrets:

| Secret | Purpose |
|--------|---------|
| `MAC_CERT_P12` / `MAC_CERT_PASSWORD` | macOS app signing |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | notarization |
| `MAC_INSTALLER_CERT_P12` / `MAC_INSTALLER_CERT_PASSWORD` | `.pkg` signing |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | Trusted Signing service principal |

Variables:

| Variable | Example |
|----------|---------|
| `TRUSTED_SIGNING_ENDPOINT` | `https://eus.codesigning.azure.net/` (your region) |
| `TRUSTED_SIGNING_ACCOUNT` | your Trusted Signing account name |
| `TRUSTED_SIGNING_PROFILE` | your certificate profile name |

## Azure Trusted Signing setup (one-time, maintainer)

1. In Azure, create a **Trusted Signing account** and a **Certificate Profile**
   (Public Trust — Aum Labs LLC, 3+ years, qualifies).
2. Create a service principal; grant it the **Trusted Signing Certificate Profile
   Signer** role on the account.
3. Add the `AZURE_*` secrets and `TRUSTED_SIGNING_*` variables above.
4. Run the `desktop` workflow — the first signed Windows build is the validation.

## Remaining

- [ ] Complete the Azure Trusted Signing setup above (account + profile + SP + secrets).
- [ ] Add `MAC_INSTALLER_CERT_P12` (Developer ID **Installer** cert) for signed `.pkg`.
- [ ] (Optional) GPG-signed apt/yum repo for Linux fleets.
- [ ] Download/releases page linking the signed artifacts.
