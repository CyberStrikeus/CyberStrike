---
name: "T1546.005_trap"
description: "Adversaries may establish persistence by executing malicious content triggered by an interrupt signal."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1546.005
  - privilege-escalation
  - persistence
  - macos
  - linux
  - sub-technique
technique_id: "T1546.005"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - persistence
platforms:
  - macOS
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1546/005"
tech_stack:
  - macos
  - linux
cwe_ids:
  - CWE-269
chains_with:
  - T1546
  - T1546.001
  - T1546.002
  - T1546.003
  - T1546.004
  - T1546.006
  - T1546.007
  - T1546.008
  - T1546.009
  - T1546.010
  - T1546.011
  - T1546.012
  - T1546.013
  - T1546.014
  - T1546.015
  - T1546.016
  - T1546.017
  - T1546.018
prerequisites:
  - T1546
severity_boost:
  T1546: "Chain with T1546 for deeper attack path"
  T1546.001: "Chain with T1546.001 for deeper attack path"
  T1546.002: "Chain with T1546.002 for deeper attack path"
---

# T1546.005 Trap

> **Sub-technique of:** T1546

## High-Level Description

Adversaries may establish persistence by executing malicious content triggered by an interrupt signal. The <code>trap</code> command allows programs and shells to specify commands that will be executed upon receiving interrupt signals. A common situation is a script allowing for graceful termination and handling of common keyboard interrupts like <code>ctrl+c</code> and <code>ctrl+d</code>.

Adversaries can use this to register code to be executed when the shell encounters specific interrupts as a persistence mechanism. Trap commands are of the following format <code>trap 'command list' signals</code> where "command list" will be executed when "signals" are received.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Persistence (TA0003)

**Platforms:** macOS, Linux

## What to Check

- [ ] Identify if Trap technique is applicable to target environment
- [ ] Check macOS systems for indicators of Trap
- [ ] Check Linux systems for indicators of Trap
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Trap EXIT

Launch bash shell with command arg to create TRAP on EXIT.
The trap executes script that writes to /tmp/art-fish.txt

**Supported Platforms:** macos, linux

```bash
bash -c 'trap "nohup sh $PathToAtomicsFolder/T1546.005/src/echo-art-fish.sh" EXIT'
```

### Atomic Test 2: Trap EXIT (freebsd)

Launch bash shell with command arg to create TRAP on EXIT.
The trap executes script that writes to /tmp/art-fish.txt

**Supported Platforms:** linux

```bash
bash -c 'trap "nohup sh $PathToAtomicsFolder/T1546.005/src/echo-art-fish.sh" EXIT'
```

**Dependencies:**

- Check if bash is installed.

### Atomic Test 3: Trap SIGINT

Launch bash shell with command arg to create TRAP on SIGINT (CTRL+C), then send SIGINT signal.
The trap executes script that writes to /tmp/art-fish.txt

**Supported Platforms:** macos, linux

```bash
bash -c 'trap "nohup sh $PathToAtomicsFolder/T1546.005/src/echo-art-fish.sh" SIGINT && kill -SIGINT $$'
```

### Atomic Test 4: Trap SIGINT (freebsd)

Launch bash shell with command arg to create TRAP on SIGINT (CTRL+C), then send SIGINT signal.
The trap executes script that writes to /tmp/art-fish.txt

**Supported Platforms:** linux

```bash
bash -c 'trap "nohup sh $PathToAtomicsFolder/T1546.005/src/echo-art-fish.sh" SIGINT && kill -SIGINT $$'
```

**Dependencies:**

- Check if bash is installed.

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Trap by examining the target platforms (macOS, Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1546.005 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

No specific mitigations documented for this technique.

## Detection

### Detection Strategy for Event Triggered Execution via Trap (T1546.005)

## Risk Assessment

| Finding                   | Severity | Impact               |
| ------------------------- | -------- | -------------------- |
| Trap technique applicable | Low      | Privilege Escalation |

## CWE Categories

| CWE ID  | Title                         |
| ------- | ----------------------------- |
| CWE-269 | Improper Privilege Management |

## References

- [Trap Manual](https://ss64.com/bash/trap.html)
- [Cyberciti Trap Statements](https://bash.cyberciti.biz/guide/Trap_statement)
- [Atomic Red Team - T1546.005](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1546.005)
- [MITRE ATT&CK - T1546.005](https://attack.mitre.org/techniques/T1546/005)
