---
name: "T1548.001_setuid-and-setgid"
description: "An adversary may abuse configurations where an application has the setuid or setgid bits set in order to get code running in a different (and possibly more privileged) user’s context."
category: "authorization"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1548.001
  - privilege-escalation
  - defense-evasion
  - linux
  - macos
  - sub-technique
technique_id: "T1548.001"
tactic: "privilege-escalation"
all_tactics:
  - privilege-escalation
  - defense-evasion
platforms:
  - Linux
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1548/001"
tech_stack:
  - linux
  - macos
cwe_ids:
  - CWE-269
chains_with:
  - T1548
  - T1548.002
  - T1548.003
  - T1548.004
  - T1548.005
  - T1548.006
prerequisites:
  - T1548
severity_boost:
  T1548: "Chain with T1548 for deeper attack path"
  T1548.002: "Chain with T1548.002 for deeper attack path"
  T1548.003: "Chain with T1548.003 for deeper attack path"
---

# T1548.001 Setuid and Setgid

> **Sub-technique of:** T1548

## High-Level Description

An adversary may abuse configurations where an application has the setuid or setgid bits set in order to get code running in a different (and possibly more privileged) user’s context. On Linux or macOS, when the setuid or setgid bits are set for an application binary, the application will run with the privileges of the owning user or group respectively. Normally an application is run in the current user’s context, regardless of which user or group owns the application. However, there are instances where programs need to be executed in an elevated context to function properly, but the user running them may not have the specific required privileges.

Instead of creating an entry in the sudoers file, which must be done by root, any user can specify the setuid or setgid flag to be set for their own applications (i.e. Linux and Mac File and Directory Permissions Modification). The <code>chmod</code> command can set these bits with bitmasking, <code>chmod 4777 [file]</code> or via shorthand naming, <code>chmod u+s [file]</code>. This will enable the setuid bit. To enable the setgid bit, <code>chmod 2775</code> and <code>chmod g+s</code> can be used.

Adversaries can use this mechanism on their own malware to make sure they're able to execute in elevated contexts in the future. This abuse is often part of a "shell escape" or other actions to bypass an execution environment with restricted permissions.

Alternatively, adversaries may choose to find and target vulnerable binaries with the setuid or setgid bits already enabled (i.e. File and Directory Discovery). The setuid and setguid bits are indicated with an "s" instead of an "x" when viewing a file's attributes via <code>ls -l</code>. The <code>find</code> command can also be used to search for such files. For example, <code>find / -perm +4000 2>/dev/null</code> can be used to find files with setuid set and <code>find / -perm +2000 2>/dev/null</code> may be used for setgid. Binaries that have these bits set may then be abused by adversaries.

## Kill Chain Phase

- Privilege Escalation (TA0004)
- Defense Evasion (TA0005)

**Platforms:** Linux, macOS

## What to Check

- [ ] Identify if Setuid and Setgid technique is applicable to target environment
- [ ] Check Linux systems for indicators of Setuid and Setgid
- [ ] Check macOS systems for indicators of Setuid and Setgid
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Make and modify binary from C source

Make, change owner, and change file attributes on a C source code file

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
cp #{payload} /tmp/hello.c
sudo chown root /tmp/hello.c
sudo make /tmp/hello
sudo chown root /tmp/hello
sudo chmod u+s /tmp/hello
/tmp/hello
```

### Atomic Test 2: Make and modify binary from C source (freebsd)

Make, change owner, and change file attributes on a C source code file

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
cp #{payload} /tmp/hello.c
chown root /tmp/hello.c
make /tmp/hello
chown root /tmp/hello
chmod u+s /tmp/hello
/tmp/hello
```

### Atomic Test 3: Set a SetUID flag on file

This test sets the SetUID flag on a file in FreeBSD.

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
sudo touch #{file_to_setuid}
sudo chown root #{file_to_setuid}
sudo chmod u+xs #{file_to_setuid}
```

### Atomic Test 4: Set a SetUID flag on file (freebsd)

This test sets the SetUID flag on a file in FreeBSD.

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
touch #{file_to_setuid}
chown root #{file_to_setuid}
chmod u+xs #{file_to_setuid}
```

### Atomic Test 5: Set a SetGID flag on file

This test sets the SetGID flag on a file in Linux and macOS.

**Supported Platforms:** macos, linux
**Elevation Required:** Yes

```bash
sudo touch #{file_to_setuid}
sudo chown root #{file_to_setuid}
sudo chmod g+xs #{file_to_setuid}
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Setuid and Setgid by examining the target platforms (Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1548.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1028 Operating System Configuration
Applications with known vulnerabilities or known shell escapes should not have the setuid or setgid bits set to reduce potential damage if an application is compromised. Additionally, the number of programs with setuid or setgid bits set should be minimized across a system.


## Detection

### Setuid/Setgid Privilege Abuse Detection (Linux/macOS)


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Setuid and Setgid technique applicable | High | Privilege Escalation |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-269 | Improper Privilege Management |


## References

- [GTFOBins Suid](https://gtfobins.github.io/#+suid)
- [OSX Keydnap malware](https://www.welivesecurity.com/2016/07/06/new-osxkeydnap-malware-hungry-credentials/)
- [setuid man page](http://man7.org/linux/man-pages/man2/setuid.2.html)
- [Atomic Red Team - T1548.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1548.001)
- [MITRE ATT&CK - T1548.001](https://attack.mitre.org/techniques/T1548/001)
