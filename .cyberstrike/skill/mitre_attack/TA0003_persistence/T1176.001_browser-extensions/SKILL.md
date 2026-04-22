---
name: "T1176.001_browser-extensions"
description: "Adversaries may abuse internet browser extensions to establish persistent access to victim systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1176.001
  - persistence
  - linux
  - windows
  - macos
  - sub-technique
technique_id: "T1176.001"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1176/001"
tech_stack:
  - linux
  - windows
  - macos
cwe_ids:
  - CWE-276
chains_with:
  - T1176
  - T1176.002
prerequisites:
  - T1176
severity_boost:
  T1176: "Chain with T1176 for deeper attack path"
  T1176.002: "Chain with T1176.002 for deeper attack path"
---

# T1176.001 Browser Extensions

> **Sub-technique of:** T1176

## High-Level Description

Adversaries may abuse internet browser extensions to establish persistent access to victim systems. Browser extensions or plugins are small programs that can add functionality to and customize aspects of internet browsers. They can be installed directly via a local file or custom URL or through a browser's app store - an official online platform where users can browse, install, and manage extensions for a specific web browser. Extensions generally inherit the web browser's permissions previously granted. 
 
Malicious extensions can be installed into a browser through malicious app store downloads masquerading as legitimate extensions, through social engineering, or by an adversary that has already compromised a system. Security can be limited on browser app stores, so it may not be difficult for malicious extensions to defeat automated scanners. Depending on the browser, adversaries may also manipulate an extension's update url to install updates from an adversary-controlled server or manipulate the mobile configuration file to silently install additional extensions. 

Adversaries may abuse how chromium-based browsers load extensions by modifying or replacing the Preferences and/or Secure Preferences files to silently install malicious extensions. When the browser is not running, adversaries can alter these files, ensuring the extension is loaded, granted desired permissions, and will persist in browser sessions. This method does not require user consent and extensions are silently loaded in the background from disk or from the browser's trusted store.
 
Previous to macOS 11, adversaries could silently install browser extensions via the command line using the <code>profiles</code> tool to install malicious <code>.mobileconfig</code> files. In macOS 11+, the use of the <code>profiles</code> tool can no longer install configuration profiles; however, <code>.mobileconfig</code> files can be planted and installed with user interaction. 
 
Once the extension is installed, it can browse to websites in the background, steal all information that a user enters into a browser (including credentials), and be used as an installer for a RAT for persistence. 

There have also been instances of botnets using a persistent backdoor through malicious Chrome extensions for Command and Control. Adversaries may also use browser extensions to modify browser permissions and components, privacy settings, and other security controls for Defense Evasion.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, Windows, macOS

## What to Check

- [ ] Identify if Browser Extensions technique is applicable to target environment
- [ ] Check Linux systems for indicators of Browser Extensions
- [ ] Check Windows systems for indicators of Browser Extensions
- [ ] Check macOS systems for indicators of Browser Extensions
- [ ] Verify mitigations are bypassed or absent (5 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Browser Extensions by examining the target platforms (Linux, Windows, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1176.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1033 Limit Software Installation
Only install browser extensions from trusted sources that can be verified. Browser extensions for some browsers can be controlled through Group Policy. Change settings to prevent the browser from installing extensions without sufficient permissions.

### M1047 Audit
Ensure extensions that are installed are the intended ones, as many malicious extensions will masquerade as legitimate ones.

### M1051 Update Software
Ensure operating systems and browsers are using the most current version.

### M1017 User Training
Close out all browser sessions when finished using them to prevent any potentially malicious extensions from continuing to run.

### M1038 Execution Prevention
Set a browser extension allow or deny list as appropriate for your security policy.


## Detection

### Detecting Malicious Browser Extensions Across Platforms


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Browser Extensions technique applicable | High | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Pulsedive](https://blog.pulsedive.com/rilide-an-information-stealing-browser-extension/)
- [Chrome Extension Crypto Miner](https://www.ghacks.net/2017/09/19/first-chrome-extension-with-javascript-crypto-miner-detected/)
- [xorrior chrome extensions macOS](https://www.xorrior.com/No-Place-Like-Chrome/)
- [Chrome Extensions Definition](https://developer.chrome.com/extensions)
- [ICEBRG Chrome Extensions](https://www.icebrg.io/blog/malicious-chrome-extensions-enable-criminals-to-impact-over-half-a-million-users-and-global-businesses)
- [Malicious Chrome Extension Numbers](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43824.pdf)
- [Chrome Extension C2 Malware](https://web.archive.org/web/20240608001937/https://kjaer.io/extension-malware/)
- [Catch All Chrome Extension](https://isc.sans.edu/forums/diary/CatchAll+Google+Chrome+Malicious+Extension+Steals+All+Posted+Data/22976/https:/threatpost.com/malicious-chrome-extension-steals-data-posted-to-any-website/128680/))
- [Banker Google Chrome Extension Steals Creds](https://isc.sans.edu/forums/diary/BankerGoogleChromeExtensiontargetingBrazil/22722/)
- [Browser Adrozek](https://www.microsoft.com/en-us/security/blog/2020/12/10/widespread-malware-campaign-seeks-to-silently-inject-ads-into-search-results-affects-multiple-browsers/)
- [Browers FriarFox](https://www.proofpoint.com/uk/blog/threat-insight/ta413-leverages-new-friarfox-browser-extension-target-gmail-accounts-global)
- [Stantinko Botnet](https://www.welivesecurity.com/2017/07/20/stantinko-massive-adware-campaign-operating-covertly-since-2012/)
- [Wikipedia Browser Extension](https://en.wikipedia.org/wiki/Browser_extension)
- [Atomic Red Team - T1176.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1176.001)
- [MITRE ATT&CK - T1176.001](https://attack.mitre.org/techniques/T1176/001)
