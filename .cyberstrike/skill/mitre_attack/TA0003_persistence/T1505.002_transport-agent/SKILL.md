---
name: "T1505.002_transport-agent"
description: "Adversaries may abuse Microsoft transport agents to establish persistent access to systems."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1505.002
  - persistence
  - linux
  - windows
  - sub-technique
technique_id: "T1505.002"
tactic: "persistence"
all_tactics:
  - persistence
platforms:
  - Linux
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1505/002"
tech_stack:
  - linux
  - windows
cwe_ids:
  - CWE-276
chains_with:
  - T1505
  - T1505.001
  - T1505.003
  - T1505.004
  - T1505.005
  - T1505.006
prerequisites:
  - T1505
severity_boost:
  T1505: "Chain with T1505 for deeper attack path"
  T1505.001: "Chain with T1505.001 for deeper attack path"
  T1505.003: "Chain with T1505.003 for deeper attack path"
---

# T1505.002 Transport Agent

> **Sub-technique of:** T1505

## High-Level Description

Adversaries may abuse Microsoft transport agents to establish persistent access to systems. Microsoft Exchange transport agents can operate on email messages passing through the transport pipeline to perform various tasks such as filtering spam, filtering malicious attachments, journaling, or adding a corporate signature to the end of all outgoing emails. Transport agents can be written by application developers and then compiled to .NET assemblies that are subsequently registered with the Exchange server. Transport agents will be invoked during a specified stage of email processing and carry out developer defined tasks. 

Adversaries may register a malicious transport agent to provide a persistence mechanism in Exchange Server that can be triggered by adversary-specified email events. Though a malicious transport agent may be invoked for all emails passing through the Exchange transport pipeline, the agent can be configured to only carry out specific tasks in response to adversary defined criteria. For example, the transport agent may only carry out an action like copying in-transit attachments and saving them for later exfiltration if the recipient email address matches an entry on a list provided by the adversary.

## Kill Chain Phase

- Persistence (TA0003)

**Platforms:** Linux, Windows

## What to Check

- [ ] Identify if Transport Agent technique is applicable to target environment
- [ ] Check Linux systems for indicators of Transport Agent
- [ ] Check Windows systems for indicators of Transport Agent
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Install MS Exchange Transport Agent Persistence

Install a Microsoft Exchange Transport Agent for persistence. This requires execution from an Exchange Client Access Server and the creation of a DLL with specific exports. Seen in use by Turla.
More details- https://docs.microsoft.com/en-us/exchange/transport-agents-exchange-2013-help

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
Install-TransportAgent -Name #{transport_agent_identity} -TransportAgentFactory #{class_factory} -AssemblyPath #{dll_path}
Enable-TransportAgent #{transport_agent_identity}
Get-TransportAgent | Format-List Name,Enabled
```

**Dependencies:**
- Microsoft Exchange SnapIn must be installed


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Transport Agent by examining the target platforms (Linux, Windows).

2. **Assess Existing Defenses**: Review whether mitigations for T1505.002 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management
Do not allow administrator accounts that have permissions to add component software on these services to be used for day-to-day operations that may expose them to potential adversaries on unprivileged systems.

### M1047 Audit
Regularly check component software on critical services that adversaries may target for persistence to verify the integrity of the systems and identify if unexpected changes have been made.

### M1045 Code Signing
Ensure all application component binaries are signed by the correct application developers.


## Detection

### Detection Strategy for T1505.002 - Transport Agent Abuse (Windows/Linux)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Transport Agent technique applicable | Low | Persistence |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-276 | Incorrect Default Permissions |


## References

- [Microsoft TransportAgent Jun 2016](https://docs.microsoft.com/en-us/exchange/transport-agents-exchange-2013-help)
- [ESET LightNeuron May 2019](https://www.welivesecurity.com/wp-content/uploads/2019/05/ESET-LightNeuron.pdf)
- [Atomic Red Team - T1505.002](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1505.002)
- [MITRE ATT&CK - T1505.002](https://attack.mitre.org/techniques/T1505/002)
