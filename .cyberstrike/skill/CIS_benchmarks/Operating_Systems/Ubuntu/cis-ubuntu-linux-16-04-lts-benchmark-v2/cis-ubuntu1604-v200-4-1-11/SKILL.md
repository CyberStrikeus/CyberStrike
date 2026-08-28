---
name: cis-ubuntu1604-v200-4-1-11
description: "Ensure use of privileged commands is collected"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.11"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.11

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Monitor privileged programs (those that have the setuid and/or setgid bit set on execution) to determine if unprivileged users are running these commands.

**Note:** Reloading the auditd config to set active settings requires the auditd service to be restarted, and may require a system reboot.

## Rationale

Execution of privileged commands by non-privileged users could be an indication of someone trying to gain unauthorized access to the system.

## Impact

None.

## Audit Procedure

### Command Line

Run the following command replacing `<partition>` with a list of partitions where programs can be executed from on your system:

```bash
find <partition> -xdev \( -perm -4000 -o -perm -2000 \) -type f | awk '{print "-a always,exit -F path=" $1 " -F perm=x -F auid>=1000 -F auid!=4294967295 -k privileged" }'
```

Verify all resulting lines are a `.rules` file in `/etc/audit/rules.d/` and the output of `auditctl -l`.

**Note:** The `.rules` file output will be `auid!=-1` not `auid!=4294967295`.

## Expected Result

All privileged commands should have corresponding audit rules.

## Remediation

### Command Line

To remediate this issue, the system administrator will have to execute a find command to locate all the privileged programs and then add an audit line for each one of them. The audit parameters associated with this are as follows:

- `-F path=" $1 "` - will populate each file name found through the find command and processed by awk.
- `-F perm=x` - will write an audit record if the file is executed.
- `-F auid>=1000` - will write a record if the user executing the command is not a privileged user.
- `-F auid!= 4294967295` - will ignore Daemon events

All audit records should be tagged with the identifier key "privileged".

Run the following command replacing `<partition>` with a list of partitions where programs can be executed from on your system:

```bash
find <partition> -xdev \( -perm -4000 -o -perm -2000 \) -type f | awk '{print "-a always,exit -F path=" $1 " -F perm=x -F auid>='"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' -F auid!=4294967295 -k privileged" }'
```

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules` and add all resulting lines to the file.

Example:

```bash
find / -xdev \( -perm -4000 -o -perm -2000 \) -type f | awk '{print "-a always,exit -F path=" $1 " -F perm=x -F auid>='"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' -F auid!=4294967295 -k privileged" }' >> /etc/audit/rules.d/50-privileged.rules
```

**Additional Information:** Systems may have been customized to change the default UID_MIN. To confirm the UID_MIN for your system, run the following command:

```bash
awk '/^\s*UID_MIN/{print $2}' /etc/login.defs
```

If your systems' UID_MIN is not 1000, replace `auid>=1000` with `auid>=<UID_MIN for your system>` in the Audit and Remediation procedures.

## Default Value

By default, no audit rules are configured for privileged command usage.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.11

## CIS Controls

| Controls Version | Control                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software. |
