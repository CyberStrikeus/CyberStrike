---
name: cis-ubuntu1604-v200-6-2-3
description: "Ensure all groups in /etc/passwd exist in /etc/group"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, user-management, maintenance]
cis_id: "6.2.3"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 6.2.3

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Over time, system administration errors and changes can lead to groups being defined in `/etc/passwd` but not in `/etc/group`.

## Rationale

Groups defined in the `/etc/passwd` file but not in the `/etc/group` file pose a threat to system security since group permissions are not properly managed.

## Audit Procedure

### Command Line

Run the following script and verify no results are returned:

```bash
#!/bin/bash
for i in $(cut -s -d: -f4 /etc/passwd | sort -u ); do
  grep -q -P "^.*?:[^:]*:$i:" /etc/group
  if [ $? -ne 0 ]; then
    echo "Group $i is referenced by /etc/passwd but does not exist in /etc/group"
  fi
done
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

Analyze the output of the Audit step above and perform the appropriate action to correct any discrepancies found.

## Default Value

N/A

## References

N/A

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v7               | 16.6 Maintain an Inventory of Accounts<br/>Maintain an inventory of all accounts organized by authentication system.                                                                                                                                                                                                            |      |      |      |
| v7               | 16.7 Establish Process for Revoking Access<br/>Establish and follow an automated process for revoking system access by disabling accounts immediately upon termination or change of responsibilities of an employee or contractor. Disabling these accounts, instead of deleting accounts, allows preservation of audit trails. |      |      |      |
| v7               | 16.8 Disable Any Unassociated Accounts<br/>Disable any account that cannot be associated with a business process or business owner.                                                                                                                                                                                             |      |      |      |
