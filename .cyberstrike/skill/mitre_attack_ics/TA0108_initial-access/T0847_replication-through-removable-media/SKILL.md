---
name: "T0847_replication-through-removable-media"
description: "Adversaries may move onto systems, such as those separated from the enterprise network, by copying malware to removable media which is inserted into the control systems environment."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0847
  - initial-access
technique_id: "T0847"
tactic: "initial-access"
all_tactics:
  - initial-access
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0847"
tech_stack:
  - ics
cwe_ids:
  - CWE-20
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0847 Replication Through Removable Media

## High-Level Description

Adversaries may move onto systems, such as those separated from the enterprise network, by copying malware to removable media which is inserted into the control systems environment. The adversary may rely on unknowing trusted third parties, such as suppliers or contractors with access privileges, to introduce the removable media. This technique enables initial access to target devices that never connect to untrusted networks, but are physically accessible. 

Operators of the German nuclear power plant, Gundremmingen, discovered malware on a facility computer not connected to the internet. The malware included Conficker and W32.Ramnit, which were also found on eighteen removable disk drives in the facility. The plant has since checked for infection and cleaned up more than 1,000 computers. An ESET researcher commented that internet disconnection does not guarantee system safety from infection or payload execution.

## Kill Chain Phase

- Initial Access (TA0108)

**Platforms:** ICS

## What to Check

- [ ] Identify if Replication Through Removable Media technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Replication Through Removable Media
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Replication Through Removable Media by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0847 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0928 Operating System Configuration
Harden the system through operating system controls to prevent the known or unknown use of malicious removable media.

### M0934 Limit Hardware Installation
Enforce system policies or physical restrictions to limit hardware such as USB devices on critical assets.

### M0942 Disable or Remove Feature or Program
Consider the disabling of features such as AutoRun.


## Detection

### Detection of Replication Through Removable Media


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Replication Through Removable Media technique applicable | High | Initial Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-20 | Improper Input Validation |


## References

- [BBC April 2016](https://www.bbc.com/news/technology-36158606)
- [Catalin Cimpanu April 2016](https://news.softpedia.com/news/on-chernobyl-s-30th-anniversary-malware-shuts-down-german-nuclear-power-plant-503429.shtml)
- [Christoph Steitz, Eric Auchard April 2016](https://www.reuters.com/article/us-nuclearpower-cyber-germany/german-nuclear-plant-infected-with-computer-viruses-operator-says-idUSKCN0XN2OS)
- [Dark Reading Staff April 2016](https://www.darkreading.com/endpoint/german-nuclear-power-plant-infected-with-malware/d/d-id/1325298)
- [ESET April 2016](https://www.welivesecurity.com/2016/04/28/malware-found-german-nuclear-power-plant/)
- [Kernkraftwerk Gundremmingen April 2016](https://www.kkw-gundremmingen.de/presse.php?id=571)
- [Lee Mathews April 2016](https://web.archive.org/web/20160430041256/https://www.geek.com/apps/german-nuclear-plant-found-riddled-with-conficker-other-viruses-1653415/)
- [Peter Dockrill April 2016](https://www.sciencealert.com/multiple-computer-viruses-have-been-discovered-in-this-german-nuclear-plant)
- [Sean Gallagher April 2016](https://arstechnica.com/information-technology/2016/04/german-nuclear-plants-fuel-rod-system-swarming-with-old-malware/)
- [Trend Micro April 2016](https://www.trendmicro.com/vinfo/us/security/news/cyber-attacks/malware-discovered-in-german-nuclear-power-plant)
- [MITRE ATT&CK ICS - T0847](https://attack.mitre.org/techniques/T0847)
