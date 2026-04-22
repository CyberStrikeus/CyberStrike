---
name: "T1555.003_credentials-from-web-browsers"
description: "Adversaries may acquire credentials from web browsers by reading files specific to the target browser."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1555.003
  - credential-access
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1555.003"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1555/003"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1555
  - T1555.001
  - T1555.002
  - T1555.004
  - T1555.005
  - T1555.006
prerequisites:
  - T1555
severity_boost:
  T1555: "Chain with T1555 for deeper attack path"
  T1555.001: "Chain with T1555.001 for deeper attack path"
  T1555.002: "Chain with T1555.002 for deeper attack path"
---

# T1555.003 Credentials from Web Browsers

> **Sub-technique of:** T1555

## High-Level Description

Adversaries may acquire credentials from web browsers by reading files specific to the target browser. Web browsers commonly save credentials such as website usernames and passwords so that they do not need to be entered manually in the future. Web browsers typically store the credentials in an encrypted format within a credential store; however, methods exist to extract plaintext credentials from web browsers.

For example, on Windows systems, encrypted credentials may be obtained from Google Chrome by reading a database file, <code>AppData\Local\Google\Chrome\User Data\Default\Login Data</code> and executing a SQL query: <code>SELECT action_url, username_value, password_value FROM logins;</code>. The plaintext password can then be obtained by passing the encrypted credentials to the Windows API function <code>CryptUnprotectData</code>, which uses the victim’s cached logon credentials as the decryption key.
 
Adversaries have executed similar procedures for common web browsers such as FireFox, Safari, Edge, etc. Windows stores Internet Explorer and Microsoft Edge credentials in Credential Lockers managed by the Windows Credential Manager.

Adversaries may also acquire credentials by searching web browser process memory for patterns that commonly match credentials.

After acquiring credentials from web browsers, adversaries may attempt to recycle the credentials across different systems and/or accounts in order to expand access. This can result in significantly furthering an adversary's objective in cases where credentials gained from web browsers overlap with privileged accounts (e.g. domain administrator).

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if Credentials from Web Browsers technique is applicable to target environment
- [ ] Check Linux systems for indicators of Credentials from Web Browsers
- [ ] Check macOS systems for indicators of Credentials from Web Browsers
- [ ] Check Windows systems for indicators of Credentials from Web Browsers
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Run Chrome-password Collector

A modified sysinternals suite will be downloaded and staged. The Chrome-password collector, renamed accesschk.exe, will then be executed from #{file_path}.

Successful execution will produce stdout message stating "Copying db ... passwordsDB DB Opened. statement prepare DB connection closed properly". Upon completion, final output will be a file modification of PathToAtomicsFolder\..\ExternalPayloads\sysinternals\passwordsdb.

Adapted from [MITRE ATTACK Evals](https://github.com/mitre-attack/attack-arsenal/blob/66650cebd33b9a1e180f7b31261da1789cdceb66/adversary_emulation/APT29/CALDERA_DIY/evals/data/abilities/credential-access/e7cab9bb-3e3a-4d93-99cc-3593c1dc8c6d.yml)

**Supported Platforms:** windows

```powershell
Start-Process "#{file_path}\Sysinternals\accesschk.exe" -ArgumentList "-accepteula ."
```

**Dependencies:**
- Modified Sysinternals must be located at #{file_path}

### Atomic Test 2: Search macOS Safari Cookies

This test uses `grep` to search a macOS Safari binaryCookies file for specified values. This was used by CookieMiner malware.

Upon successful execution, MacOS shell will cd to `~/Libraries/Cookies` and grep for `Cookies.binarycookies`.

**Supported Platforms:** macos

```bash
cd ~/Library/Cookies
grep -q "#{search_string}" "Cookies.binarycookies"
```

### Atomic Test 3: LaZagne - Credentials from Browser

The following Atomic test utilizes [LaZagne](https://github.com/AlessandroZ/LaZagne) to extract passwords from browsers on the Windows operating system.
LaZagne is an open source application used to retrieve passwords stored on a local computer.

**Supported Platforms:** windows
**Elevation Required:** Yes

```cmd
"#{lazagne_path}" browsers
```

**Dependencies:**
- LaZagne.exe must exist on disk at specified location (#{lazagne_path})

### Atomic Test 4: Simulating access to Chrome Login Data

Simulates an adversary accessing encrypted credentials from Google Chrome Login database.

**Supported Platforms:** windows

```powershell
Copy-Item "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Login Data" -Destination "PathToAtomicsFolder\..\ExternalPayloads"
Copy-Item "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Login Data For Account" -Destination "PathToAtomicsFolder\..\ExternalPayloads"
```

**Dependencies:**
- Chrome must be installed

### Atomic Test 5: Simulating access to Opera Login Data

Simulates an adversary accessing encrypted credentials from Opera web browser's login database.

**Supported Platforms:** windows

```powershell
Copy-Item "$env:APPDATA\Opera Software\Opera Stable\Login Data" -Destination "PathToAtomicsFolder\..\ExternalPayloads"
```

**Dependencies:**
- Opera must be installed
- Opera login data file must exist


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Credentials from Web Browsers by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1555.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1051 Update Software
Regularly update web browsers, password managers, and all related software to the latest versions. Keeping software up-to-date reduces the risk of vulnerabilities being exploited by attackers to extract stored credentials or session cookies.

### M1018 User Account Management
Implement strict user account management policies to prevent unnecessary accounts from accessing sensitive systems. Regularly audit user accounts to identify and disable inactive accounts that may be targeted by attackers to extract credentials or gain unauthorized access.

### M1017 User Training
Provide user training on secure practices for managing credentials, including avoiding storing sensitive passwords in browsers and using password managers securely. Users should also be educated on identifying phishing attempts that could steal session cookies or credentials.

### M1021 Restrict Web-Based Content
Restrict or block web-based content that could be used to extract session cookies or credentials stored in browsers. Use browser security settings, such as disabling third-party cookies and restricting browser extensions, to limit the attack surface.

### M1027 Password Policies
Organizations may consider weighing the risk of storing credentials in web browsers. If web browser credential disclosure is a significant concern, technical controls, policy, and user training may be used to prevent storage of credentials in web browsers.


## Detection

### Detect Suspicious Access to Browser Credential Stores


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Credentials from Web Browsers technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [GitHub Mimikittenz July 2016](https://github.com/putterpanda/mimikittenz)
- [Talos Olympic Destroyer 2018](https://blog.talosintelligence.com/2018/02/olympic-destroyer.html)
- [Microsoft CryptUnprotectData April 2018](https://docs.microsoft.com/en-us/windows/desktop/api/dpapi/nf-dpapi-cryptunprotectdata)
- [Proofpoint Vega Credential Stealer May 2018](https://www.proofpoint.com/us/threat-insight/post/new-vega-stealer-shines-brightly-targeted-campaign)
- [FireEye HawkEye Malware July 2017](https://www.fireeye.com/blog/threat-research/2017/07/hawkeye-malware-distributed-in-phishing-campaign.html)
- [Atomic Red Team - T1555.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1555.003)
- [MITRE ATT&CK - T1555.003](https://attack.mitre.org/techniques/T1555/003)
