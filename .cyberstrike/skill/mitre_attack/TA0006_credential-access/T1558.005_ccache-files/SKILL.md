---
name: "T1558.005_ccache-files"
description: "Adversaries may attempt to steal Kerberos tickets stored in credential cache files (or ccache)."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1558.005
  - credential-access
  - linux
  - macos
  - sub-technique
technique_id: "T1558.005"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1558/005"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-522
chains_with:
  - T1558
  - T1558.001
  - T1558.002
  - T1558.003
  - T1558.004
prerequisites:
  - T1558
severity_boost:
  T1558: "Chain with T1558 for deeper attack path"
  T1558.001: "Chain with T1558.001 for deeper attack path"
  T1558.002: "Chain with T1558.002 for deeper attack path"
---

# T1558.005 Ccache Files

> **Sub-technique of:** T1558

## High-Level Description

Adversaries may attempt to steal Kerberos tickets stored in credential cache files (or ccache). These files are used for short term storage of a user's active session credentials. The ccache file is created upon user authentication and allows for access to multiple services without the user having to re-enter credentials.

The <code>/etc/krb5.conf</code> configuration file and the <code>KRB5CCNAME</code> environment variable are used to set the storage location for ccache entries. On Linux, credentials are typically stored in the `/tmp` directory with a naming format of `krb5cc_%UID%` or `krb5.ccache`. On macOS, ccache entries are stored by default in memory with an `API:{uuid}` naming scheme. Typically, users interact with ticket storage using <code>kinit</code>, which obtains a Ticket-Granting-Ticket (TGT) for the principal; <code>klist</code>, which lists obtained tickets currently held in the credentials cache; and other built-in binaries.

Adversaries can collect tickets from ccache files stored on disk and authenticate as the current user without their password to perform Pass the Ticket attacks. Adversaries can also use these tickets to impersonate legitimate users with elevated privileges to perform Privilege Escalation. Tools like Kekeo can also be used by adversaries to convert ccache files to Windows format for further Lateral Movement. On macOS, adversaries may use open-source tools or the Kerberos framework to interact with ccache files and extract TGTs or Service Tickets via lower-level APIs.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Ccache Files technique is applicable to target environment
- [ ] Check Linux systems for indicators of Ccache Files
- [ ] Check macOS systems for indicators of Ccache Files
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Ccache Files by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1558.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1047 Audit

Enable and perform audits or scans of systems, permissions, insecure software, insecure configurations, etc. to identify potential weaknesses. For example, use <code>auditd</code> to audit access to hashes, machine tickets, or <code>/tmp</code> files. If using sssd and Vintela, ensure kerberos is disabled if not being used.

### M1043 Credential Access Protection

Protect resources with Security Enhanced Linux (SELinux) by defining entry points, process types, and file labels.

## Detection

### Detect Kerberos Ccache File Theft or Abuse (T1558.005)

## Risk Assessment

| Finding                           | Severity | Impact            |
| --------------------------------- | -------- | ----------------- |
| Ccache Files technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Binary Defense Kerberos Linux](https://www.binarydefense.com/resources/blog/shining-a-light-in-the-dark-how-binary-defense-uncovered-an-apt-lurking-in-shadows-of-it/)
- [Kerberos GNU/Linux](https://adepts.of0x.cc/kerberos-thievery-linux/)
- [Kekeo](https://github.com/gentilkiwi/kekeo)
- [SpectorOps Bifrost Kerberos macOS 2019](https://posts.specterops.io/when-kirbi-walks-the-bifrost-4c727807744f)
- [Brining MimiKatz to Unix](https://labs.portcullis.co.uk/download/eu-18-Wadhwa-Brown-Where-2-worlds-collide-Bringing-Mimikatz-et-al-to-UNIX.pdf)
- [Linux Kerberos Tickets](https://www.fireeye.com/blog/threat-research/2020/04/kerberos-tickets-on-linux-red-teams.html)
- [Atomic Red Team - T1558.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1558.005)
- [MITRE ATT&CK - T1558.005](https://attack.mitre.org/techniques/T1558/005)
