---
name: cis-docker-v170-4.8
description: "Ensure setuid and setgid permissions are removed"
category: cis-docker
version: "1.7.0"
author: cyberstrike-official
tags: [cis, docker, images, configuration, permissions]
cis_id: "4.8"
cis_benchmark: "CIS Docker Benchmark v1.7.0"
tech_stack: [docker]
cwe_ids: [CWE-250]
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Docker Benchmark v1.7.0 - Control 4.8

## Profile Applicability

- Level 2 - Docker - Linux

## Description

Removing setuid and setgid permissions in the images can prevent privilege escalation attacks within containers.

## Rationale

setuid and setgid permissions can be used for privilege escalation. Whilst these permissions can on occasion be legitimately needed, you should consider removing them from packages which do not need them. This should be reviewed for each image.

## Impact

The above command would break all executables that depend on setuid or setgid permissions including legitimate ones. You should therefore be careful to modify the command to suit your requirements so that it does not reduce the permissions of legitimate programs excessively. Because of this, you should exercise a degree of caution and examine all processes carefully before making this type of modification in order to avoid outages.

## Audit Procedure

You should run the command below against each image to list the executables which have either setuid or setgid permissions:

```bash
docker export <IMAGE_ID> | tar -tv 2>/dev/null | grep -E '^[^ rwx]*[rwx]*[s|S]*[s|S]*[rwx]*'
```

You should then review the list and ensure that all executables configured with these permissions actually require them.

## Remediation

You should allow setuid and setgid permissions only on executables which require them. You could remove these permissions at build time by adding the following command in your Dockerfile, preferably towards the end of the Dockerfile:

```dockerfile
RUN find / -perm /6000 -type f -exec chmod a-s {} \; || true
```

## Default Value

Not Applicable

## References

1. https://docs.docker.com/engine/reference/run/#runtime-privilege-and-linux-capabilities
2. http://man7.org/linux/man-pages/man2/setuid.2.html
3. http://man7.org/linux/man-pages/man2/setgid.2.html

## CIS Controls

**v8:**

- 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts - Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account.

**v7:**

- 4 Controlled Use of Administrative Privileges - Controlled Use of Administrative Privileges

## Assessment Status

Manual
