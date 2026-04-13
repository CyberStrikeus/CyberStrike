---
name: cis-gcp-cos-5.3.4
description: "Ensure default user umask is 027 or more restrictive"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, shadow, user-accounts, umask]
cis_id: "5.3.4"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.4 Ensure default user umask is 027 or more restrictive (Automated)

## Description

The default `umask` determines the permissions of files created by users. The user creating the file has the discretion of making their files and directories readable by others via the chmod command. Users who wish to allow their files and directories to be readable by others by default may choose a different default umask by inserting the `umask` command into the standard shell configuration files (`.profile`, `.bashrc`, etc.) in their home directories.

## Rationale

Setting a very secure default value for `umask` ensures that users make a conscious choice about their file permissions. A default `umask` setting of `077` causes files and directories created by users to not be readable by any other user on the system. A `umask` of `027` would make files and directories readable by users in the same Unix group, while a `umask` of `022` would make files readable by every user on the system.

## Audit Procedure

Run the following commands and verify all umask lines returned are 027 or more restrictive.

```bash
# grep "umask" /etc/bash/bashrc
umask 027
# grep "umask" /etc/profile /etc/profile.d/*.sh
umask 027
```

## Expected Result

All umask values returned should be `027` or more restrictive (e.g., `077`).

## Remediation

Edit the `/etc/bash/bashrc`, `/etc/profile` and `/etc/profile.d/*.sh` files (and the appropriate files for any other shell supported on your system) and add or edit any umask parameters as follows:

```
umask 027
```

Additional Information:

The audit and remediation in this recommendation apply to bash and shell. If other shells are supported on the system, it is recommended that their configuration files also are checked.

Other methods of setting a default user umask exist however the shell configuration files are the last run and will override other settings if they exist therefor our recommendation is to configure in the shell configuration files. If other methods are in use in your environment they should be audited and the shell configs should be verified to not override.

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                             | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | **3.3 Configure Data Access Control Lists** - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. | x    | x    | x    |
| v7               | **5.1 Establish Secure Configurations** - Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                         | x    | x    | x    |

## Profile

- Level 2 - Server
