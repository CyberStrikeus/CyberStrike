---
name: "T0853_scripting"
description: "Adversaries may use scripting languages to execute arbitrary code in the form of a pre-written script or in the form of user-supplied code to an interpreter."
category: "input-validation"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0853
  - execution
technique_id: "T0853"
tactic: "execution"
all_tactics:
  - execution
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0853"
tech_stack:
  - ics
cwe_ids:
  - CWE-94
chains_with: []
prerequisites: []
severity_boost: {}
---

# T0853 Scripting

## High-Level Description

Adversaries may use scripting languages to execute arbitrary code in the form of a pre-written script or in the form of user-supplied code to an interpreter. Scripting languages are programming languages that differ from compiled languages, in that scripting languages use an interpreter, instead of a compiler. These interpreters read and compile part of the source code just before it is executed, as opposed to compilers, which compile each and every line of code to an executable file. Scripting allows software developers to run their code on any system where the interpreter exists. This way, they can distribute one package, instead of precompiling executables for many different systems. Scripting languages, such as Python, have their interpreters shipped as a default with many Linux distributions.

In addition to being a useful tool for developers and administrators, scripting language interpreters may be abused by the adversary to execute code in the target environment. Due to the nature of scripting languages, this allows for weaponized code to be deployed to a target easily, and leaves open the possibility of on-the-fly scripting to perform a task.

## Kill Chain Phase

- Execution (TA0104)

**Platforms:** ICS

## What to Check

- [ ] Identify if Scripting technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Scripting
- [ ] Verify mitigations are bypassed or absent (3 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Scripting by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0853 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0938 Execution Prevention

Execution prevention may prevent malicious scripts from accessing protected resources.

### M0948 Application Isolation and Sandboxing

Consider the use of application isolation and sandboxing to restrict specific operating system interactions such as access through user accounts, services, system calls, registry, and network access. This may be even more useful in cases where the source of the executed script is unknown.

### M0942 Disable or Remove Feature or Program

Consider removal or disabling of programs and features which may be used to run malicious scripts (e.g., scripting language IDEs, PowerShell, visual studio).

## Detection

### Detection of Scripting

## Risk Assessment

| Finding                        | Severity | Impact    |
| ------------------------------ | -------- | --------- |
| Scripting technique applicable | Low      | Execution |

## CWE Categories

| CWE ID | Title                                  |
| ------ | -------------------------------------- |
| CWE-94 | Improper Control of Generation of Code |

## References

- [MITRE ATT&CK ICS - T0853](https://attack.mitre.org/techniques/T0853)
