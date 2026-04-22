---
name: cis-ubuntu1804-v220-5-2-3-8
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure events that modify user/group information are collected
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.8 Ensure events that modify user/group information are collected

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Record events affecting the modification of user or group information, including that of passwords and old passwords if in use.

- `/etc/group` - system groups
- `/etc/passwd` - system users
- `/etc/gshadow` - encrypted password for each group
- `/etc/shadow` - system user passwords
- `/etc/security/opasswd` - storage of old passwords if the relevant PAM module is in use

The parameters in this section will watch the files to see if they have been opened for write or have had attribute changes (e.g. permissions) and tag them with the identifier "identity" in the audit log file.

## Rationale

Unexpected changes to these files could be an indication that the system has been compromised and that an unauthorized user is attempting to hide their activities or compromise additional accounts.

## Audit

### On disk configuration

Run the following command to check the on disk rules:

```bash
awk '/^ *-w/ \
&&(/\/etc\/group/ \
 ||/\/etc\/passwd/ \
 ||/\/etc\/gshadow/ \
 ||/\/etc\/shadow/ \
 ||/\/etc\/security\/opasswd/ ) \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/' /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-w /etc/group -p wa -k identity
-w /etc/passwd -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/security/opasswd -p wa -k identity
```

### Running configuration

Run the following command to check loaded rules:

```bash
auditctl -l | awk '/^ *-w/ \
&&(/\/etc\/group/ \
 ||/\/etc\/passwd/ \
 ||/\/etc\/gshadow/ \
 ||/\/etc\/shadow/ \
 ||/\/etc\/security\/opasswd/ ) \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/'
```

Verify the output matches:

```
-w /etc/group -p wa -k identity
-w /etc/passwd -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/security/opasswd -p wa -k identity
```

## Remediation

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor events that modify user/group information.

Example:

```bash
printf "
-w /etc/group -p wa -k identity
-w /etc/passwd -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/security/opasswd -p wa -k identity
" >> /etc/audit/rules.d/50-identity.rules
```

Merge and load the rules into active configuration:

```bash
augenrules --load
```

Check if reboot is required:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

## References

- NIST SP 800-53 Rev. 5: AU-3

## CIS Controls

| Version | Control | IG 1 | IG 2 | IG 3 |
|---------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs | | ● | ● |
| v7 | 4.8 Log and Alert on Changes to Administrative Group Membership | | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|----------------------------|---------|-------------|
| T1562, T1562.006 | TA0004 | M1047 |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination.
