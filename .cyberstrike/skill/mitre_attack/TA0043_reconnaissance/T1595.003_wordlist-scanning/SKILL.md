---
name: "T1595.003_wordlist-scanning"
description: "Adversaries may iteratively probe infrastructure using brute-forcing and crawling techniques."
category: "information-gathering"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1595.003
  - reconnaissance
  - pre
  - sub-technique
technique_id: "T1595.003"
tactic: "reconnaissance"
all_tactics:
  - reconnaissance
platforms:
  - PRE
mitre_url: "https://attack.mitre.org/techniques/T1595/003"
tech_stack:
  - pre
cwe_ids:
  - CWE-200
chains_with:
  - T1595
  - T1595.001
  - T1595.002
prerequisites:
  - T1595
severity_boost:
  T1595: "Chain with T1595 for deeper attack path"
  T1595.001: "Chain with T1595.001 for deeper attack path"
  T1595.002: "Chain with T1595.002 for deeper attack path"
---

# T1595.003 Wordlist Scanning

> **Sub-technique of:** T1595

## High-Level Description

Adversaries may iteratively probe infrastructure using brute-forcing and crawling techniques. While this technique employs similar methods to Brute Force, its goal is the identification of content and infrastructure rather than the discovery of valid credentials. Wordlists used in these scans may contain generic, commonly used names and file extensions or terms specific to a particular software. Adversaries may also create custom, target-specific wordlists using data gathered from other Reconnaissance techniques (ex: Gather Victim Org Information, or Search Victim-Owned Websites).

For example, adversaries may use web content discovery tools such as Dirb, DirBuster, and GoBuster and generic or custom wordlists to enumerate a website’s pages and directories. This can help them to discover old, vulnerable pages or hidden administrative portals that could become the target of further operations (ex: Exploit Public-Facing Application or Brute Force).

As cloud storage solutions typically use globally unique names, adversaries may also use target-specific wordlists and tools such as s3recon and GCPBucketBrute to enumerate public and private buckets on cloud infrastructure. Once storage objects are discovered, adversaries may leverage Data from Cloud Storage to access valuable information that can be exfiltrated or used to escalate privileges and move laterally.

## Kill Chain Phase

- Reconnaissance (TA0043)

**Platforms:** PRE

## What to Check

- [ ] Identify if Wordlist Scanning technique is applicable to target environment
- [ ] Check PRE systems for indicators of Wordlist Scanning
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Wordlist Scanning by examining the target platforms (PRE).

2. **Assess Existing Defenses**: Review whether mitigations for T1595.003 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1042 Disable or Remove Feature or Program

Remove or disable access to any systems, resources, and infrastructure that are not explicitly required to be available externally.

### M1056 Pre-compromise

This technique cannot be easily mitigated with preventive controls since it is based on behaviors performed outside of the scope of enterprise defenses and controls. Efforts should focus on minimizing the amount and sensitivity of data available to external parties.

## Detection

### Detection of Wordlist Scanning

## Risk Assessment

| Finding                                | Severity | Impact         |
| -------------------------------------- | -------- | -------------- |
| Wordlist Scanning technique applicable | High     | Reconnaissance |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-200 | Exposure of Sensitive Information |

## References

- [ClearSky Lebanese Cedar Jan 2021](https://www.clearskysec.com/wp-content/uploads/2021/01/Lebanese-Cedar-APT.pdf)
- [GCPBucketBrute](https://rhinosecuritylabs.com/gcp/google-cloud-platform-gcp-bucket-enumeration/)
- [S3Recon GitHub](https://github.com/clarketm/s3recon)
- [Atomic Red Team - T1595.003](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1595.003)
- [MITRE ATT&CK - T1595.003](https://attack.mitre.org/techniques/T1595/003)
