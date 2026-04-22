---
name: cis-ubuntu1804-v220-5-2-3-2
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure actions as another user are always logged
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.2 Ensure actions as another user are always logged

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

`sudo` provides users with temporary elevated privileges to perform operations, either as the superuser or another user.

## Rationale

Creating an audit log of users with temporary elevated privileges and the operation(s) they performed is essential to reporting. Administrators will want to correlate the events written to the audit trail with the records written to `sudo`'s logfile to verify if unauthorized commands have been executed.

## Audit

### 64 Bit systems

#### On disk configuration

Run the following command to check the on disk rules:

```bash
awk '/^ *-a *always,exit/ \
&&/ -F *arch=b64/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -S/ \
&&/ execve/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/' /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-a always,exit -F arch=b64 -C auid!=uid -F auid!=unset -S execve -k user_emulation
-a always,exit -F arch=b32 -C auid!=uid -F auid!=unset -S execve -k user_emulation
```

#### Running configuration

Run the following command to check loaded rules:

```bash
auditctl -l | awk '/^ *-a *always,exit/ \
&&/ -F *arch=b(32|64)/ \
&&(/ -F *auid!=unset/||/ -F *auid!=-1/||/ -F *auid!=4294967295/) \
&&/ -C/ \
&&/ execve/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/'
```

Verify the output matches:

```
-a always,exit -F arch=b64 -S execve -C uid!=auid -F auid!=-1 -F key=user_emulation
-a always,exit -F arch=b32 -S execve -C uid!=auid -F auid!=-1 -F key=user_emulation
```

### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## Remediation

### Create audit rules

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor elevated privileges.

#### 64 Bit systems

Example:

```bash
printf "
-a always,exit -F arch=b64 -C auid!=uid -F auid!=unset -S execve -k user_emulation
-a always,exit -F arch=b32 -C auid!=uid -F auid!=unset -S execve -k user_emulation
" >> /etc/audit/rules.d/50-user_emulation.rules
```

### Load audit rules

Merge and load the rules into active configuration:

```bash
augenrules --load
```

Check if reboot is required:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

#### 32 Bit systems

Follow the same procedures as for 64 bit systems and ignore any entries with `b64`.

## References

- NIST SP 800-53 Rev. 5: AU-3

## CIS Controls

| Version | Control | IG 1 | IG 2 | IG 3 |
|---------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs | | ● | ● |
| v7 | 4.9 Log and Alert on Unsuccessful Administrative Account Login | | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|----------------------------|---------|-------------|
| T1562, T1562.006 | TA0004 | M1047 |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination.
