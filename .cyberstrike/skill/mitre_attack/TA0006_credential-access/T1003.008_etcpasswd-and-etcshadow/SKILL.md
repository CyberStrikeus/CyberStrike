---
name: "T1003.008_etcpasswd-and-etcshadow"
description: "Adversaries may attempt to dump the contents of <code>/etc/passwd</code> and <code>/etc/shadow</code> to enable offline password cracking."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1003.008
  - credential-access
  - linux
  - sub-technique
technique_id: "T1003.008"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
mitre_url: "https://attack.mitre.org/techniques/T1003/008"
tech_stack:
  - linux
cwe_ids:
  - CWE-522
chains_with:
  - T1003
  - T1003.001
  - T1003.002
  - T1003.003
  - T1003.004
  - T1003.005
  - T1003.006
  - T1003.007
prerequisites:
  - T1003
severity_boost:
  T1003: "Chain with T1003 for deeper attack path"
  T1003.001: "Chain with T1003.001 for deeper attack path"
  T1003.002: "Chain with T1003.002 for deeper attack path"
---

# T1003.008 /etc/passwd and /etc/shadow

> **Sub-technique of:** T1003

## High-Level Description

Adversaries may attempt to dump the contents of <code>/etc/passwd</code> and <code>/etc/shadow</code> to enable offline password cracking. Most modern Linux operating systems use a combination of <code>/etc/passwd</code> and <code>/etc/shadow</code> to store user account information, including password hashes in <code>/etc/shadow</code>. By default, <code>/etc/shadow</code> is only readable by the root user.

Linux stores user information such as user ID, group ID, home directory path, and login shell in <code>/etc/passwd</code>. A "user" on the system may belong to a person or a service. All password hashes are stored in <code>/etc/shadow</code> - including entries for users with no passwords and users with locked or disabled accounts.

Adversaries may attempt to read or dump the <code>/etc/passwd</code> and <code>/etc/shadow</code> files on Linux systems via command line utilities such as the <code>cat</code> command. Additionally, the Linux utility <code>unshadow</code> can be used to combine the two files in a format suited for password cracking utilities such as John the Ripper - for example, via the command <code>/usr/bin/unshadow /etc/passwd /etc/shadow > /tmp/crack.password.db</code>. Since the user information stored in <code>/etc/passwd</code> are linked to the password hashes in <code>/etc/shadow</code>, an adversary would need to have access to both.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux

## What to Check

- [ ] Identify if /etc/passwd and /etc/shadow technique is applicable to target environment
- [ ] Check Linux systems for indicators of /etc/passwd and /etc/shadow
- [ ] Verify mitigations are bypassed or absent (2 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Access /etc/shadow (Local)

/etc/shadow file is accessed in Linux environments

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo cat /etc/shadow > #{output_file}
cat #{output_file}
```

### Atomic Test 2: Access /etc/master.passwd (Local)

/etc/master.passwd file is accessed in FreeBSD environments

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
sudo cat /etc/master.passwd > #{output_file}
cat #{output_file}
```

### Atomic Test 3: Access /etc/passwd (Local)

/etc/passwd file is accessed in FreeBSD and Linux environments

**Supported Platforms:** linux

```bash
cat /etc/passwd > #{output_file}
cat #{output_file}
```

### Atomic Test 4: Access /etc/{shadow,passwd,master.passwd} with a standard bin that's not cat

Dump /etc/passwd, /etc/master.passwd and /etc/shadow using ed

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
unamestr=$(uname)
if [ "$unamestr" = 'Linux' ]; then echo -e "e /etc/passwd\n,p\ne /etc/shadow\n,p\n" | ed > #{output_file}; elif [ "$unamestr" = 'FreeBSD' ]; then echo -e "e /etc/passwd\n,p\ne /etc/master.passwd\n,p\ne /etc/shadow\n,p\n" | ed > #{output_file}; fi
```

### Atomic Test 5: Access /etc/{shadow,passwd,master.passwd} with shell builtins

Dump /etc/passwd, /etc/master.passwd and /etc/shadow using sh builtins

**Supported Platforms:** linux
**Elevation Required:** Yes

```bash
testcat(){ (while read line; do echo $line >> #{output_file}; done < $1) }
[ "$(uname)" = 'FreeBSD' ] && testcat /etc/master.passwd
testcat /etc/passwd
testcat /etc/shadow
```

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to /etc/passwd and /etc/shadow by examining the target platforms (Linux).

2. **Assess Existing Defenses**: Review whether mitigations for T1003.008 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1026 Privileged Account Management

Follow best practices in restricting access to privileged accounts to avoid hostile programs from accessing such sensitive information.

### M1027 Password Policies

Ensure that root accounts have complex, unique passwords across all systems on the network.

## Detection

### Credential Access via /etc/passwd and /etc/shadow Parsing

## Risk Assessment

| Finding                                          | Severity | Impact            |
| ------------------------------------------------ | -------- | ----------------- |
| /etc/passwd and /etc/shadow technique applicable | Low      | Credential Access |

## CWE Categories

| CWE ID  | Title                                |
| ------- | ------------------------------------ |
| CWE-522 | Insufficiently Protected Credentials |

## References

- [Arctic Wolf](https://arcticwolf.com/resources/blog/arctic-wolf-observes-threat-campaign-targeting-palo-alto-networks-firewall-devices/)
- [Linux Password and Shadow File Formats](https://www.tldp.org/LDP/lame/LAME/linux-admin-made-easy/shadow-file-formats.html)
- [nixCraft - John the Ripper](https://www.cyberciti.biz/faq/unix-linux-password-cracking-john-the-ripper/)
- [Atomic Red Team - T1003.008](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1003.008)
- [MITRE ATT&CK - T1003.008](https://attack.mitre.org/techniques/T1003/008)
