---
name: cis-ubuntu2004-v300-2-4-1-9
description: "Ensure access to crontab is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, cron, job-schedulers]
cis_id: "2.4.1.9"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure access to crontab is configured

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

crontab is the program used to install, deinstall, or list the tables used to drive the cron daemon. Each user can have their own crontab, and though files are created, they are not intended to be edited directly.

If the /etc/cron.allow file exists, then you must be listed (one user per line) therein in order to be allowed to use this command. If the /etc/cron.allow file does not exist but the /etc/cron.deny file does exist, then you must not be listed in the /etc/cron.deny file in order to use this command.

If neither of these files exists, then depending on site-dependent configuration parameters, only the super user will be allowed to use this command, or all users will be able to use this command.

If both files exist then /etc/cron.allow takes precedence. Which means that /etc/cron.deny is not considered and your user must be listed in /etc/cron.allow in order to be able to use the crontab.

Regardless of the existence of any of these files, the root administrative user is always allowed to setup a crontab.

The files /etc/cron.allow and /etc/cron.deny, if they exist, must be either world-readable, or readable by group crontab. If they are not, then cron will deny access to all users until the permissions are fixed.

There is one file for each user's crontab. Users are not allowed to edit the file directly to ensure that only users allowed by the system to run periodic tasks can add them, and only syntactically correct crontabs will be written. This is enforced by having the directory writable only by the crontab group and configuring crontab command with the setgid bid set for that specific group.

**Note:**

- Even though a given user is not listed in cron.allow, cron jobs can still be run as that user
- The files /etc/cron.allow and /etc/cron.deny, if they exist, only controls administrative access to the crontab command for scheduling and modifying cron jobs

## Rationale

On many systems, only the system administrator is authorized to schedule cron jobs. Using the cron.allow file to control who can run cron jobs enforces this policy. It is easier to manage an allow list than a deny list. In a deny list, you could potentially add a user ID to the system and forget to add it to the deny files.

## Audit

- IF - cron is installed on the system:

Run the following command to verify /etc/cron.allow:

### Command Line

- Exists
- Is mode 0640 or more restrictive
- Is owned by the user root
- Is group owned by the group root - OR - the group crontab

```bash
# stat -Lc 'Access: (%a/%A) Owner: (%U) Group: (%G)' /etc/cron.allow
```

Verify the returned value is:

```
Access: (640/-rw-r-----) Owner: (root) Group: (root)
- OR -
Access: (640/-rw-r-----) Owner: (root) Group: (crontab)
```

Run the following command to verify either cron.deny doesn't exist or is:

### Command Line

- Mode 0640 or more restrictive
- Owned by the user root
- Is group owned by the group root - OR - the group crontab

```bash
# [ -e "/etc/cron.deny" ] && stat -Lc 'Access: (%a/%A) Owner: (%U) Group: (%G)' /etc/cron.deny
```

Verify either nothing is returned - OR - returned value is one of the following:

```
Access: (640/-rw-r-----) Owner: (root) Group: (root)
- OR -
Access: (640/-rw-r-----) Owner: (root) Group: (crontab)
```

**Note:** On systems where cron is configured to use the group crontab, if the group crontab is not set as the owner of cron.allow, then cron will deny access to all users and you will see an error similar to:

```
You (<USERNAME>) are not allowed to use this program (crontab)
See crontab(1) for more information
```

## Remediation

- IF - cron is installed on the system:

Run the following script to:

### Command Line

- Create /etc/cron.allow if it doesn't exist
- Change owner to user root
- Change group owner to group root - OR - group crontab if it exists
- Change mode to 640 or more restrictive

```bash
#!/usr/bin/env bash
{
  [ ! -e "/etc/cron.deny" ] && touch /etc/cron.allow
  chmod u=rw,g=rwx,o=rwx /etc/cron.allow
  if grep -Pq -- '^\h*crontab\:' /etc/group; then
    chown root:crontab /etc/cron.allow
  else
    chown root:root /etc/cron.allow
  fi
}
```

- IF - /etc/cron.deny exists, run the following script to:

- Change owner to user root
- Change group owner to group root - OR - group crontab if it exists
- Change mode to 640 or more restrictive

```bash
#!/usr/bin/env bash
{
  if [ -e "/etc/cron.deny" ]; then
    chmod u=rw,g=wx,o=rwx /etc/cron.deny
    if grep -Pq -- '^\h*crontab\:' /etc/group; then
      chown root:crontab /etc/cron.deny
    else
      chown root:root /etc/cron.deny
    fi
  fi
}
```

**Note:** On systems where cron is configured to use the group crontab, if the group crontab is not set as the owner of cron.allow, then cron will deny access to all users and you will see an error similar to:

```
You (<USERNAME>) are not allowed to use this program (crontab)
See crontab(1) for more information
```

## References

1. NIST SP 800-53 Rev. 5: AC-3. MP-2

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                  | IG 1 | IG 2 | IG 3 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.                                                                                                                                                        | ●    | ●    | ●    |
| v7               | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ●    | ●    | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1053, T1053.003            | TA0002  | M1018       |
