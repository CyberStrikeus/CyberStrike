---
name: cis-ubuntu1604-v200-5-5-2
description: "Ensure system accounts are secured"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.5.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure system accounts are secured

**Profile Applicability:**

- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

There are a number of accounts provided with most distributions that are used to manage applications and are not intended to provide an interactive shell.

## Rationale

It is important to make sure that accounts that are not being used by regular users are prevented from being used to provide an interactive shell. By default, most distributions set the password field for these accounts to an invalid string, but it is also recommended that the shell field in the password file be set to the `nologin` shell. This prevents the account from potentially being used to run any commands.

## Audit Procedure

### Command Line

Run the following commands and verify no results are returned:

```bash
awk -F: '$1!~/(root|sync|shutdown|halt|^\+)/ && $3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' && $7!~/(\/usr)?\/sbin\/nologin/ && $7!~/(\/bin)?\/false/ {print}' /etc/passwd
```

```bash
awk -F: '($1!~/(root|^\+)/ && $3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"') {print $1}' /etc/passwd | xargs -I '{}' passwd -S '{}' | awk '($2!~/LK?/) {print $1}'
```

_Note: The `root`, `sync`, `shutdown`, and `halt` users are exempted from requiring a non-login shell._

## Remediation

### Command Line

Set the shell for any accounts returned by the audit to nologin:

```bash
usermod -s $(which nologin) <user>
```

Lock any non root accounts returned by the audit:

```bash
usermod -L <user>
```

The following command will set all system accounts to a non login shell:

```bash
awk -F: '$1!~/(root|sync|shutdown|halt|^\+)/ && $3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' && $7!~/(\/usr)?\/sbin\/nologin/ && $7!~/(\/bin)?\/false/ {print $1}' /etc/passwd | while read -r user; do usermod -s "$(which nologin)" "$user"; done
```

The following command will automatically lock not root system accounts:

```bash
awk -F: '($1!~/(root|^\+)/ && $3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"') {print $1}' /etc/passwd | xargs -I '{}' passwd -S '{}' | awk '($2!~/LK?/) {print $1}' | while read -r user; do usermod -L "$user"; done
```

## References

None

## CIS Controls

| Controls Version | Control                                                            |
| ---------------- | ------------------------------------------------------------------ |
| v7               | 16 Account Monitoring and Control - Account Monitoring and Control |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
