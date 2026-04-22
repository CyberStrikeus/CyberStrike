---
name: "T1003.006_dcsync"
description: "Adversaries may attempt to access credentials and other sensitive information by abusing a Windows Domain Controller's application programming interface (API) to simulate the replication process fr..."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003.006
  - credential-access
  - windows
  - sub-technique
technique_id: "T1003.006"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1003/006"
tech_stack:
  - windows
cwe_ids:
  - CWE-522
chains_with:
  - T1003
  - T1003.001
  - T1003.002
  - T1003.003
  - T1003.004
  - T1003.005
  - T1003.007
  - T1003.008
prerequisites:
  - T1003
severity_boost:
  T1003: "Chain with T1003 for deeper attack path"
  T1003.001: "Chain with T1003.001 for deeper attack path"
  T1003.002: "Chain with T1003.002 for deeper attack path"
---

# T1003.006 DCSync

> **Sub-technique of:** T1003

## High-Level Description

Adversaries may attempt to access credentials and other sensitive information by abusing a Windows Domain Controller's application programming interface (API) to simulate the replication process from a remote domain controller using a technique called DCSync.

Members of the Administrators, Domain Admins, and Enterprise Admin groups or computer accounts on the domain controller are able to run DCSync to pull password data from Active Directory, which may include current and historical hashes of potentially useful accounts such as KRBTGT and Administrators. The hashes can then in turn be used to create a Golden Ticket for use in Pass the Ticket or change an account's password as noted in Account Manipulation.

DCSync functionality has been included in the "lsadump" module in Mimikatz. Lsadump also includes NetSync, which performs DCSync over a legacy replication protocol.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Windows

## What to Check

- [ ] Identify if DCSync technique is applicable to target environment
- [ ] Check Windows systems for indicators of DCSync
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: DCSync (Active Directory)

Active Directory attack allowing retrieval of account information without accessing memory or retrieving the NTDS database.
Works against a remote Windows Domain Controller using the replication protocol.
Privileges required: domain admin or domain controller account (by default), or any other account with required rights.
[Reference](https://adsecurity.org/?p=1729)

**Supported Platforms:** windows

```cmd
#{mimikatz_path} "lsadump::dcsync /domain:#{domain} /user:#{user}@#{domain}" "exit"
```

**Dependencies:**

- Mimikatz executor must exist on disk and at specified location (#{mimikatz_path})

### Atomic Test 2: Run DSInternals Get-ADReplAccount

The following Atomic will run Get-ADReplAccount from DSInternals.
Upon successful execution, domain and credentials will appear in stdout.
[Reference](https://www.crowdstrike.com/blog/observations-from-the-stellarparticle-campaign/) CrowdStrike StellarParticle.
https://www.dsinternals.com/en/retrieving-active-directory-passwords-remotely/

**Supported Platforms:** windows

```powershell
Get-ADReplAccount -All -Server #{logonserver}
```

**Dependencies:**

- DSInternals must be installed

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to DCSync by examining the target platforms (Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1003.006 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1027 Password Policies

Ensure that local administrator accounts have complex, unique passwords across all systems on the network.

### M1015 Active Directory Configuration

Manage the access control list for "Replicating Directory Changes" and other permissions associated with domain controller replication.

### M1026 Privileged Account Management

Do not put user or admin domain accounts in the local administrator groups across systems unless they are tightly controlled, as this is often equivalent to having a local administrator account with the same password on all systems. Follow best practices for design and administration of an enterprise network to limit privileged account use across administrative tiers.

## Detection

### Detection of Unauthorized DCSync Operations via Replication API Abuse

## Risk Assessment

| Finding                     | Severity | Impact            |
| --------------------------- | -------- | ----------------- |
| DCSync technique applicable | High     | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [GitHub Mimikatz lsadump Module](https://github.com/gentilkiwi/mimikatz/wiki/module-~-lsadump)
- [ADSecurity Mimikatz DCSync](https://adsecurity.org/?p=1729)
- [AdSecurity DCSync Sept 2015](https://adsecurity.org/?p=1729)
- [Microsoft DRSR Dec 2017](https://msdn.microsoft.com/library/cc228086.aspx)
- [Microsoft NRPC Dec 2017](https://msdn.microsoft.com/library/cc237008.aspx)
- [Microsoft GetNCCChanges](https://msdn.microsoft.com/library/dd207691.aspx)
- [Microsoft SAMR](https://msdn.microsoft.com/library/cc245496.aspx)
- [Samba DRSUAPI](https://wiki.samba.org/index.php/DRSUAPI)
- [Harmj0y DCSync Sept 2015](http://www.harmj0y.net/blog/redteaming/mimikatz-and-dcsync-and-extrasids-oh-my/)
- [Harmj0y Mimikatz and DCSync](https://blog.harmj0y.net/redteaming/mimikatz-and-dcsync-and-extrasids-oh-my/)
- [InsiderThreat ChangeNTLM July 2017](https://blog.stealthbits.com/manipulating-user-passwords-with-mimikatz-SetNTLM-ChangeNTLM)
- [Wine API samlib.dll](https://strontic.github.io/xcyclopedia/library/samlib.dll-0BDF6351009F6EBA5BA7E886F23263B1.html)
- [Atomic Red Team - T1003.006](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003.006)
- [MITRE ATT&CK - T1003.006](https://attack.mitre.org/techniques/T1003/006)
