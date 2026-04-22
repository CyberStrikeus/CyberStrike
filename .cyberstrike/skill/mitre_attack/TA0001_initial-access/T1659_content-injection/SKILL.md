---
name: "T1659_content-injection"
description: "Adversaries may gain access and continuously communicate with victims by injecting malicious content into systems through online network traffic."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1659
  - initial-access
  - command-and-control
  - linux
  - macos
  - windows
technique_id: "T1659"
tactic: "initial-access"
all_tactics:
  - initial-access
  - command-and-control
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1659"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-20
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1659 Content Injection

## High-Level Description

Adversaries may gain access and continuously communicate with victims by injecting malicious content into systems through online network traffic. Rather than luring victims to malicious payloads hosted on a compromised website (i.e., Drive-by Target followed by Drive-by Compromise), adversaries may initially access victims through compromised data-transfer channels where they can manipulate traffic and/or inject their own content. These compromised online network channels may also be used to deliver additional payloads (i.e., Ingress Tool Transfer) and other data to already compromised systems.

Adversaries may inject content to victim systems in various ways, including:

- From the middle, where the adversary is in-between legitimate online client-server communications (**Note:** this is similar but distinct from Adversary-in-the-Middle, which describes AiTM activity solely within an enterprise environment)
- From the side, where malicious content is injected and races to the client as a fake response to requests of a legitimate online server

Content injection is often the result of compromised upstream communication channels, for example at the level of an internet service provider (ISP) as is the case with "lawful interception."

## Kill Chain Phase

- Initial Access (TA0001)
- Command and Control (TA0011)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Content Injection technique is applicable to target environment
- [ ] Check Linux systems for indicators of Content Injection
- [ ] Check macOS systems for indicators of Content Injection
- [ ] Check Windows systems for indicators of Content Injection
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: MITM Proxy Injection

Start mitmdump and verify injected header and HTML content.

**Supported Platforms:** macos, linux

```bash
curl -skI --proxy http://127.0.0.1:8080 http://example.com > /tmp/curl_out.txt
grep "X-Atomic" /tmp/curl_out.txt || (cat /tmp/curl_out.txt && exit 1)
curl -sk --proxy http://127.0.0.1:8080 http://example.com > /tmp/atomic_t1659_page.html
grep -q "Atomic T1659 Injection" /tmp/atomic_t1659_page.html || (head -20 /tmp/atomic_t1659_page.html; exit 1)
```

**Dependencies:**

- python3 must be installed
- curl must be installed
- pipx must be installed
- mitmproxy must be installed
- mitmdump must be running on port 8080

### Atomic Test 2: MITM Proxy Injection (Windows)

Start mitmdump proxy with injection script in the background.

**Supported Platforms:** windows

```powershell
curl.exe -skI --proxy http://127.0.0.1:8080 http://example.com | Tee-Object -FilePath "$env:TEMP\curl_out.txt"
if (-not (Select-String -Path "$env:TEMP\curl_out.txt" -Pattern "X-Atomic")) { Write-Error "Header not found"; exit 1 }
$OutPath = "$env:TEMP\atomic_t1659_page.html"
curl.exe -sk --proxy http://127.0.0.1:8080 http://example.com | Out-File -FilePath $OutPath -Encoding utf8
$Content = Get-Content -Path $OutPath -Raw
if ($Content -notmatch "Atomic T1659 Injection") { exit 1 }
```

**Dependencies:**

- Python must be installed
- curl must be installed
- mitmproxy must be installed and in PATH
- mitmdump must be running on port 8080

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Content Injection by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1659 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1021 Restrict Web-Based Content

Consider blocking download/transfer and execution of potentially uncommon file types known to be used in adversary campaigns.

### M1041 Encrypt Sensitive Information

Where possible, ensure that online traffic is appropriately encrypted through services such as trusted VPNs.

## Detection

### Detection Strategy for Content Injection

## Risk Assessment

| Finding                                | Severity | Impact         |
| -------------------------------------- | -------- | -------------- |
| Content Injection technique applicable | High     | Initial Access |

## CWE Categories

| CWE ID | Title                     |
| ------ | ------------------------- |
| CWE-20 | Improper Input Validation |

## References

- [EFF China GitHub Attack](https://www.eff.org/deeplinks/2015/04/china-uses-unencrypted-websites-to-hijack-browsers-in-github-attack)
- [ESET MoustachedBouncer](https://www.welivesecurity.com/en/eset-research/moustachedbouncer-espionage-against-foreign-diplomats-in-belarus/)
- [Kaspersky Encyclopedia MiTM](https://encyclopedia.kaspersky.com/glossary/man-in-the-middle-attack/)
- [Kaspersky ManOnTheSide](https://usa.kaspersky.com/blog/man-on-the-side/27854/)
- [Atomic Red Team - T1659](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1659)
- [MITRE ATT&CK - T1659](https://attack.mitre.org/techniques/T1659)
