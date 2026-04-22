---
name: "T1055.014_vdso-hijacking"
description: "Adversaries may inject malicious code into processes via VDSO hijacking in order to evade process-based defenses as well as possibly elevate privileges."
category: "configuration"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1055.014
  - defense-evasion
  - privilege-escalation
  - linux
  - sub-technique
technique_id: "T1055.014"
tactic: "defense-evasion"
all_tactics:
  - defense-evasion
  - privilege-escalation
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1055/014"
tech_stack:
  - linux
cwe_ids:
  - CWE-693
chains_with:
  - T1055
  - T1055.001
  - T1055.002
  - T1055.003
  - T1055.004
  - T1055.005
  - T1055.008
  - T1055.009
  - T1055.011
  - T1055.012
  - T1055.013
  - T1055.015
prerequisites:
  - T1055
severity_boost:
  T1055: "Chain with T1055 for deeper attack path"
  T1055.001: "Chain with T1055.001 for deeper attack path"
  T1055.002: "Chain with T1055.002 for deeper attack path"
---

# T1055.014 VDSO Hijacking

> **Sub-technique of:** T1055

## High-Level Description

Adversaries may inject malicious code into processes via VDSO hijacking in order to evade process-based defenses as well as possibly elevate privileges. Virtual dynamic shared object (vdso) hijacking is a method of executing arbitrary code in the address space of a separate live process.

VDSO hijacking involves redirecting calls to dynamically linked shared libraries. Memory protections may prevent writing executable code to a process via Ptrace System Calls. However, an adversary may hijack the syscall interface code stubs mapped into a process from the vdso shared object to execute syscalls to open and map a malicious shared object. This code can then be invoked by redirecting the execution flow of the process via patched memory address references stored in a process' global offset table (which store absolute addresses of mapped library functions).

Running code in the context of another process may allow access to the process's memory, system/network resources, and possibly elevated privileges. Execution via VDSO hijacking may also evade detection from security products since the execution is masked under a legitimate process.

## Kill Chain Phase

- Defense Evasion (TA0005)
- Privilege Escalation (TA0004)

**Platforms:** Linux

## What to Check

- [ ] Identify if VDSO Hijacking technique is applicable to target environment
- [ ] Check Linux systems for indicators of VDSO Hijacking
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Manual Testing

1. **Identify Attack Surface**: Determine if the target environment is susceptible to VDSO Hijacking by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1055.014 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

> **Note**: No Atomic Red Team tests available for this technique. See [Atomic Red Team GitHub](https://github.com/redcanaryco/atomic-red-team) for updates.

## Remediation Guide

### M1040 Behavior Prevention on Endpoint

Some endpoint security solutions can be configured to block some types of process injection based on common sequences of behavior that occur during the injection process.

## Detection

### Detection Strategy for VDSO Hijacking on Linux

## Risk Assessment

| Finding                             | Severity | Impact          |
| ----------------------------------- | -------- | --------------- |
| VDSO Hijacking technique applicable | High     | Defense Evasion |

## CWE Categories

| CWE ID  | Title                        |
| ------- | ---------------------------- |
| CWE-693 | Protection Mechanism Failure |

## References

- [Backtrace VDSO](https://web.archive.org/web/20210205211142/https://backtrace.io/blog/backtrace/elf-shared-library-injection-forensics/)
- [Syscall 2014](https://lwn.net/Articles/604515/)
- [GNU Acct](https://www.gnu.org/software/acct/)
- [RHEL auditd](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/6/html/security_guide/chap-system_auditing)
- [ELF Injection May 2009](https://web.archive.org/web/20150711051625/http://vxer.org/lib/vrn00.html)
- [VDSO Aug 2005](https://web.archive.org/web/20051013084246/http://www.trilithium.com/johan/2005/08/linux-gate/)
- [Chokepoint preload rootkits](http://www.chokepoint.net/2014/02/detecting-userland-preload-rootkits.html)
- [Atomic Red Team - T1055.014](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1055.014)
- [MITRE ATT&CK - T1055.014](https://attack.mitre.org/techniques/T1055/014)
