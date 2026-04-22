---
name: cis-ubuntu2004-v300-2-4-2-1
description: "Ensure access to at is configured"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, at, job-schedulers]
cis_id: "2.4.2.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure access to at is configured

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

at is a command-line utility used to schedule a job for later execution

**Note:** if at is not installed on the system, this section can be skipped

## Audit

Verify /etc/at.allow:

### Command Line

- Exists
- Is mode 0640 or more restrictive
- Is owned by the user root
- Is group owned by the group root - OR - the group daemon

```bash
# stat -Lc 'Access: (%a/%A) Owner: (%U) Group: (%G)' /etc/at.allow
```

Verify the returned value is:

```
Access: (640/-rw-r-----) Owner: (root) Group: (root)
- OR -
Access: (640/-rw-r-----) Owner: (root) Group: (daemon)
```

Run the following command to verify either at.deny doesn't exist or is:

- Mode 0640 or more restrictive
- Owned by the user root
- Is group owned by the group root - OR - the group daemon

```bash
# [ -e "/etc/at.deny" ] && stat -Lc 'Access: (%a/%A) Owner: (%U) Group: (%G)' /etc/at.deny
```

Verify either nothing is returned - OR - returned value is one of the following:

```
Access: (640/-rw-r-----) Owner: (root) Group: (root)
- OR -
Access: (640/-rw-r-----) Owner: (root) Group: (daemon)
```

**Note:** On systems where at is configured to use the group daemon, if the group daemon is not set as the owner of at.allow, then at will deny access to all users and you will see an error similar to:

```
You (<USERNAME>) are not allowed to use this program (at)
See at(1) for more information
```

## Remediation

Run the following script to:

### Command Line

- Create /etc/at.allow if it doesn't exist
- Change owner to user root
- Change group owner to group root - OR - group daemon if it exists
- Change mode to 640 or more restrictive

```bash
#!/usr/bin/env bash
{
  [ ! -e "/etc/at.deny" ] && touch /etc/at.allow
  chmod u=rw,g=wx,o=rwx /etc/at.allow
  if grep -Pq -- '^\h*daemon\:' /etc/group; then
    chown root:daemon /etc/at.allow
  else
    chown root:root /etc/at.allow
  fi
}
```

- IF - /etc/at.deny exists, run the following script to:

- Change owner to user root
- Change group owner to group root - OR - group daemon if it exists
- Change mode to 640 or more restrictive

```bash
#!/usr/bin/env bash
{
  if [ -e "/etc/at.deny" ]; then
    chmod u=rw,g=wx,o=rwx /etc/at.deny
    if grep -Pq -- '^\h*daemon\:' /etc/group; then
      chown root:daemon /etc/at.deny
    else
      chown root:root /etc/at.deny
    fi
  fi
}
```

**Note:** On systems where at is configured to use the group daemon, if the group daemon is not set as the owner of at.allow, then at will deny access to all users and you will see an error similar to:

```
You (<USERNAME>) are not allowed to use this program (at)
See at(1) for more information
```

## References

1. NIST SP 800-53 Rev. 5: AC-3. MP-2

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.3 Configure Data Access Control Lists<br/>Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | ● | ● | ● |
| v7 | 14.6 Protect Information through Access Control Lists<br/>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. | ● | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1053, T1053.003 | TA0002 | M1018 |
