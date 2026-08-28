---
name: cis-ubuntu2004-v300-6-3-3-6
description: "Ensure use of privileged commands are collected"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
cis_id: "6.3.3.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.3.3.6 Ensure use of privileged commands are collected (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

Monitor privileged programs, those that have the `setuid` and/or `setgid` bit set on execution, to determine if unprivileged users are running these commands.

## Rationale

Execution of privileged commands by non-privileged users could be an indication of someone trying to gain unauthorized access to the system.

## Impact

Both the audit and remediation section of this recommendation will traverse all mounted file systems that is not mounted with either `noexec` or `nosuid` mount options. If there are large file systems without these mount options, such traversal will be significantly detrimental to the performance of the system.

Before running either the audit or remediation section, inspect the output of the following command to determine exactly which file systems will be traversed:

```bash
# findmnt -n -l -k -it $(awk '/nodev/ { print $2 }' /proc/filesystems | paste -sd,) | grep -Pv "noexec|nosuid"
```

To exclude a particular file system due to adverse performance impacts, update the audit and remediation sections by adding a sufficiently unique string to the `grep` statement. The above command can be used to test the modified exclusions.

## Audit Procedure

### Command Line

On disk configuration - Run the following script to check on disk rules:

```bash
#!/usr/bin/env bash

{
    for PARTITION in $(findmnt -n -l -k -it $(awk '/nodev/ { print $2 }' /proc/filesystems | paste -sd,) | grep -Pv "noexec|nosuid" | awk '{print $1}'); do
        for PRIVILEGED in $(find "${PARTITION}" -xdev -perm /6000 -type f); do
            grep -qr "${PRIVILEGED}" /etc/audit/rules.d && printf "OK: '${PRIVILEGED}' found in auditing rules.\n" || printf "Warning: '${PRIVILEGED}' not found in on disk configuration.\n"
        done
    done
}
```

Verify that all output is OK.

Running configuration - Run the following script to check loaded rules:

```bash
#!/usr/bin/env bash

{
    RUNNING=$(auditctl -l)
    [ -n "${RUNNING}" ] && for PARTITION in $(findmnt -n -l -k -it $(awk '/nodev/ { print $2 }' /proc/filesystems | paste -sd,) | grep -Pv "noexec|nosuid" | awk '{print $1}'); do
        for PRIVILEGED in $(find "${PARTITION}" -xdev -perm /6000 -type f); do
            printf -- "${RUNNING}" | grep -q "${PRIVILEGED}" && printf "OK: '${PRIVILEGED}' found in auditing rules.\n" || printf "Warning: '${PRIVILEGED}' not found in running configuration.\n"
        done
    done \
    || printf "ERROR: Variable 'RUNNING' is unset.\n"
}
```

Verify that all output is OK.

## Expected Result

All privileged commands should be found in auditing rules.

## Remediation

### Command Line

Edit or create a file in the `/etc/audit/rules.d/` directory, ending in `.rules` extension, with the relevant rules to monitor the use of privileged commands.

Example script:

```bash
#!/usr/bin/env bash

{
UID_MIN=$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)
AUDIT_RULE_FILE="/etc/audit/rules.d/50-privileged.rules"
NEW_DATA=()
for PARTITION in $(findmnt -n -l -k -it $(awk '/nodev/ { print $2 }' /proc/filesystems | paste -sd,) | grep -Pv "noexec|nosuid" | awk '{print $1}'); do
    readarray -t DATA < <(find "${PARTITION}" -xdev -perm /6000 -type f | awk -v UID_MIN=${UID_MIN} '{print "-a always,exit -F path=" $1 " -F perm=x -F auid>="UID_MIN" -F auid!=unset -k privileged" }')
    for ENTRY in "${DATA[@]}"; do
        NEW_DATA+=("${ENTRY}")
    done
done
readarray 6> /dev/null -t OLD_DATA < "${AUDIT_RULE_FILE}"
COMBINED_DATA=( "${OLD_DATA[@]}" "${NEW_DATA[@]}" )
printf '%s\n' "${COMBINED_DATA[@]}" | sort -u > "${AUDIT_RULE_FILE}"
}
```

Merge and load the rules into active configuration:

```bash
# augenrules --load
```

Check if reboot is required:

```bash
# if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

Special mount points: If there are any special mount points that are not visible by default from just scanning `/`, change the `PARTITION` variable to the appropriate partition and re-run the remediation.

## References

1. NIST SP 800-53 Rev. 5: AU-3, AU-3(1)

## CIS Controls

| Controls Version | Control                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs |      | X    | X    |
| v7               | 6.2 Activate audit logging      | X    | X    | X    |

MITRE ATT&CK Mappings: T1562, T1562.006 / TA0002 / M1026
