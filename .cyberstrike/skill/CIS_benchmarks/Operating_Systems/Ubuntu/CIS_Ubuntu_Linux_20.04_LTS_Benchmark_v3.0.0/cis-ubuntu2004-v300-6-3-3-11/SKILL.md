---
name: cis-ubuntu2004-v300-6-3-3-11
description: "Ensure session initiation information is collected"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.3.11"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.3.11 Ensure session initiation information is collected (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor session initiation events. The parameters in this section track changes to the files associated with session events.

- `/var/run/utmp` - tracks all currently logged in users.
- `/var/log/wtmp` - file tracks logins, logouts, shutdown, and reboot events.
- `/var/log/btmp` - keeps track of failed login attempts and can be read by entering the command `/usr/bin/last -f /var/log/btmp`.

All audit records will be tagged with the identifier "session."

## Rationale

Monitoring these files for changes could alert a system administrator to logins occurring at unusual hours, which could indicate intruder activity (i.e. a user logging in at a time when they do not normally log in).

## Audit Procedure

### Command Line

On disk configuration - Run the following command to check the on disk rules:

```bash
# awk '/^ *-w/ \
&&(/\/var\/run\/utmp/ \
  ||/\/var\/log\/wtmp/ \
  ||/\/var\/log\/btmp/) \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)' /etc/audit/rules.d/*.rules
```

Verify the output matches:

```
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k session
-w /var/log/btmp -p wa -k session
```

Running configuration - Run the following command to check loaded rules:

```bash
# auditctl -l | awk '/^ *-w/ \
&&(/\/var\/run\/utmp/ \
  ||/\/var\/log\/wtmp/ \
  ||/\/var\/log\/btmp/) \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)'
```

Verify the output matches:

```
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k session
-w /var/log/btmp -p wa -k session
```

## Expected Result

Both on disk and running configuration should show session initiation audit rules.

## Remediation

### Command Line

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor session initiation information.

Example:

```bash
# printf "
-w /var/run/utmp -p wa -k session
-w /var/log/wtmp -p wa -k session
-w /var/log/btmp -p wa -k session
" >> /etc/audit/rules.d/50-session.rules
```

Merge and load the rules into active configuration:

```bash
# augenrules --load
```

Check if reboot is required:

```bash
# if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

## References

1. NIST SP 800-53 Rev. 5: AU-3
2. STIG ID: UBTU-20-010279 | RULE ID: SV-238317r991581 | CAT II
3. STIG ID: UBTU-20-010278 | RULE ID: SV-238316r991581 | CAT II
4. STIG ID: UBTU-20-010277 | RULE ID: SV-238315r991581 | CAT II
5. STIG ID: UBTU-22-654195 | RULE ID: SV-260641r991581 | CAT II
6. STIG ID: UBTU-22-654200 | RULE ID: SV-260642r991581 | CAT II
7. STIG ID: UBTU-22-654205 | RULE ID: SV-260643r991581 | CAT II

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.5 Collect Detailed Audit Logs | | X | X |
| v7 | 4.9 Log and Alert on Unsuccessful Administrative Account Login | | X | X |
| v7 | 16.13 Alert on Account Login Behavior Deviation | | | X |

MITRE ATT&CK Mappings: T1562, T1562.006 / TA0001 / M1047
