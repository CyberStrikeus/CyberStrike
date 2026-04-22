---
name: "T1495_firmware-corruption"
description: "Adversaries may overwrite or corrupt the flash memory contents of system BIOS or other firmware in devices attached to a system in order to render them inoperable or unable to boot, thus denying th..."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1495
  - impact
  - linux
  - macos
  - network-devices
  - windows
technique_id: "T1495"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - Linux
  - macOS
  - Network Devices
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1495"
tech_stack:
  - linux
  - macos
  - network devices
  - windows
cwe_ids:
  - CWE-400
chains_with: []
prerequisites: []
severity_boost: {}
---

# T1495 Firmware Corruption

## High-Level Description

Adversaries may overwrite or corrupt the flash memory contents of system BIOS or other firmware in devices attached to a system in order to render them inoperable or unable to boot, thus denying the availability to use the devices and/or the system. Firmware is software that is loaded and executed from non-volatile memory on hardware devices in order to initialize and manage device functionality. These devices may include the motherboard, hard drive, or video cards.

In general, adversaries may manipulate, overwrite, or corrupt firmware in order to deny the use of the system or devices. For example, corruption of firmware responsible for loading the operating system for network devices may render the network devices inoperable. Depending on the device, this attack may also result in Data Destruction.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** Linux, macOS, Network Devices, Windows

## What to Check

- [ ] Identify if Firmware Corruption technique is applicable to target environment
- [ ] Check Linux systems for indicators of Firmware Corruption
- [ ] Check macOS systems for indicators of Firmware Corruption
- [ ] Check Network Devices systems for indicators of Firmware Corruption
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Firmware Corruption by examining the target platforms (Linux, macOS, Network Devices).

2. **Assess Existing Defenses**: Review whether mitigations for T1495 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1051 Update Software

Patch the BIOS and other firmware as necessary to prevent successful use of known vulnerabilities.

### M1026 Privileged Account Management

Prevent adversary access to privileged accounts or access necessary to replace system firmware.

### M1046 Boot Integrity

Check the integrity of the existing BIOS and device firmware to determine if it is vulnerable to modification.

## Detection

### Firmware Modification via Flash Tool or Corrupted Firmware Upload

## Risk Assessment

| Finding                                  | Severity | Impact |
| ---------------------------------------- | -------- | ------ |
| Firmware Corruption technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [cisa_malware_orgs_ukraine](https://www.cisa.gov/uscert/ncas/alerts/aa22-057a)
- [dhs_threat_to_net_devices](https://cyber.dhs.gov/assets/report/ar-16-20173.pdf)
- [MITRE Trustworthy Firmware Measurement](http://www.mitre.org/publications/project-stories/going-deep-into-the-bios-with-mitre-firmware-security-research)
- [Symantec Chernobyl W95.CIH](https://web.archive.org/web/20190508170055/https://www.symantec.com/security-center/writeup/2000-122010-2655-99)
- [Atomic Red Team - T1495](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1495)
- [MITRE ATT&CK - T1495](https://attack.mitre.org/techniques/T1495)
