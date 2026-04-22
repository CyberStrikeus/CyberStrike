---
name: cis-ubuntu1804-v220-5-2-3-3
version: "2.2.0"
date_published: 2024-01-01
category: cis-logging
description: Ensure events that modify the sudo log file are collected
author: CIS Benchmarks
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.3.3 Ensure events that modify the sudo log file are collected

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor the `sudo` log file. If the system has been properly configured to disable the use of the `su` command and force all administrators to have to log in first and then use `sudo` to execute privileged commands, then all administrator commands will be logged to `/var/log/sudo.log`. Any time a command is executed, an audit event will be triggered as the `/var/log/sudo.log` file will be opened for write and the executed administration command will be written to the log.

## Rationale

Changes in `/var/log/sudo.log` indicate that an administrator has executed a command or the log file itself has been tampered with. Administrators will want to correlate the events written to the audit trail with the records written to `/var/log/sudo.log` to verify if unauthorized commands have been executed.

## Audit

### On disk configuration

Run the following command to check the on disk rules:

```bash
SUDO_LOG_FILE_ESCAPED=$(grep -r logfile /etc/sudoers* | sed -e 's/.*logfile=//;s/,? .*//' -e 's/"//g' -e 's|/|\\/|g')
[ -n "${SUDO_LOG_FILE_ESCAPED}" ] && awk "/^ *-w/ \
&&/"${SUDO_LOG_FILE_ESCAPED}"/ \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" /etc/audit/rules.d/*.rules \
|| printf "ERROR: Variable 'SUDO_LOG_FILE_ESCAPED' is unset.\n"
```

Verify output of matches:

```
-w /var/log/sudo.log -p wa -k sudo_log_file
```

### Running configuration

Run the following command to check loaded rules:

```bash
SUDO_LOG_FILE_ESCAPED=$(grep -r logfile /etc/sudoers* | sed -e 's/.*logfile=//;s/,? .*//' -e 's/"//g' -e 's|/|\\/|g')
[ -n "${SUDO_LOG_FILE_ESCAPED}" ] && auditctl -l | awk "/^ *-w/ \
&&/"${SUDO_LOG_FILE_ESCAPED}"/ \
&&/ +-p *wa/ \
&&(/ key= *[!-~]* *$/||/ -k *[!-~]* *$/)/" \
|| printf "ERROR: Variable 'SUDO_LOG_FILE_ESCAPED' is unset.\n"
```

Verify output matches:

```
-w /var/log/sudo.log -p wa -k sudo_log_file
```

## Remediation

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor events that modify the sudo log file.

Example:

```bash
SUDO_LOG_FILE=$(grep -r logfile /etc/sudoers* | sed -e 's/.*logfile=//;s/,? .*//' -e 's/"//g')
[ -n "${SUDO_LOG_FILE}" ] && printf "
-w ${SUDO_LOG_FILE} -p wa -k sudo_log_file
" >> /etc/audit/rules.d/50-sudo.rules || printf "ERROR: Variable 'SUDO_LOG_FILE_ESCAPED' is unset.\n"
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
| v7 | 4.9 Log and Alert on Unsuccessful Administrative Account Login | | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|----------------------------|---------|-------------|
| T1562, T1562.006 | TA0004 | M1047 |

## Additional Information

**Potential reboot required**: If the auditing configuration is locked (`-e 2`), then `augenrules` will not warn in any way that rules could not be loaded into the running configuration. A system reboot will be required to load the rules into the running configuration.

**System call structure**: For performance (`man 7 audit.rules`) reasons it is preferable to have all the system calls on one line. However, your configuration may have them on one line each or some other combination.
