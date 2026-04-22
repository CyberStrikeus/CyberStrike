---
name: "T1614.001_system-language-discovery"
description: "Adversaries may attempt to gather information about the system language of a victim in order to infer the geographical location of that host."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1614.001
  - discovery
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1614.001"
tactic: "discovery"
all_tactics:
  - discovery
platforms:
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1614/001"
tech_stack:
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-200
chains_with:
  - T1614
prerequisites:
  - T1614
severity_boost:
  T1614: "Chain with T1614 for deeper attack path"
---

# T1614.001 System Language Discovery

> **Sub-technique of:** T1614

## High-Level Description

Adversaries may attempt to gather information about the system language of a victim in order to infer the geographical location of that host. This information may be used to shape follow-on behaviors, including whether the adversary infects the target and/or attempts specific actions. This decision may be employed by malware developers and operators to reduce their risk of attracting the attention of specific law enforcement agencies or prosecution/scrutiny from other entities.

There are various sources of data an adversary could use to infer system language, such as system defaults and keyboard layouts. Specific checks will vary based on the target and/or adversary, but may involve behaviors such as Query Registry and calls to Native API functions.

For example, on a Windows system adversaries may attempt to infer the language of a system by querying the registry key <code>HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Nls\Language</code> or parsing the outputs of Windows API functions <code>GetUserDefaultUILanguage</code>, <code>GetSystemDefaultUILanguage</code>, <code>GetKeyboardLayoutList</code> and <code>GetUserDefaultLangID</code>.

On a macOS or Linux system, adversaries may query <code>locale</code> to retrieve the value of the <code>$LANG</code> environment variable.

## Kill Chain Phase

- Discovery (TA0007)

**Platforms:** Linux, macOS, Windows

## What to Check

- [ ] Identify if System Language Discovery technique is applicable to target environment
- [ ] Check Linux systems for indicators of System Language Discovery
- [ ] Check macOS systems for indicators of System Language Discovery
- [ ] Check Windows systems for indicators of System Language Discovery
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Discover System Language by Registry Query

Identify System language by querying the registry on an endpoint.

Upon successful execution, result in number format can be looked up to correlate the language.

**Supported Platforms:** windows

```cmd
reg query HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Nls\Language
```

### Atomic Test 2: Discover System Language with chcp

Identify System language with the chcp command.

Upon successful execution, result in number format can be looked up to correlate the language.

**Supported Platforms:** windows

```cmd
chcp
```

### Atomic Test 3: Discover System Language with locale

Identify System language with the `locale` command.

Upon successful execution, the output will contain the environment variables that indicate
the 5 character locale that can be looked up to correlate the language and territory.

**Supported Platforms:** linux

```bash
locale
```

### Atomic Test 4: Discover System Language with localectl

Identify System language with the `localectl` command.

Upon successful execution, the key `System Locale` from the output will contain the
`LANG` environment variable that has the 5 character locale result that can be looked
up to correlate the language and territory.

**Supported Platforms:** linux

```bash
localectl status
```

### Atomic Test 5: Discover System Language by locale file

Identify System language with the by reading the locale configuration file.

The locale configuration file contains the `LANG` environment variable which
will contain the 5 character locale that can be looked up to correlate the
language and territory.

**Supported Platforms:** linux

```bash
[ -f /etc/locale.conf ] && cat /etc/locale.conf || cat /etc/default/locale
```

**Dependencies:**

- Check the location of the locale configuration file.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to System Language Discovery by examining the target platforms (Linux, macOS, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1614.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for System Language Discovery

## Risk Assessment

| Finding                                        | Severity | Impact    |
| ---------------------------------------------- | -------- | --------- |
| System Language Discovery technique applicable | Medium   | Discovery |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [Darkside Ransomware Cybereason](https://www.cybereason.com/blog/cybereason-vs-darkside-ransomware)
- [Securelist JSWorm](https://securelist.com/evolution-of-jsworm-ransomware/102428/)
- [CrowdStrike Ryuk January 2019](https://www.crowdstrike.com/blog/big-game-hunting-with-ryuk-another-lucrative-targeted-ransomware/)
- [SecureList SynAck Doppelgänging May 2018](https://securelist.com/synack-targeted-ransomware-uses-the-doppelganging-technique/85431/)
- [Malware System Language Check](https://www.welivesecurity.com/2009/01/15/malware-trying-to-avoid-some-countries/)
- [Atomic Red Team - T1614.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1614.001)
- [MITRE ATT&CK - T1614.001](https://attack.mitre.org/techniques/T1614/001)
