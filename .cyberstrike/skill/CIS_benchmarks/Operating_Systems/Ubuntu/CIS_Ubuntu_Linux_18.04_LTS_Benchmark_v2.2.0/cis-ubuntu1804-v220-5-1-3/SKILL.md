---
name: cis-ubuntu1804-v220-5-1-3
description: "Ensure all logfiles have appropriate access configured"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, logging, permissions]
cis_id: "5.1.3"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.3 Ensure all logfiles have appropriate access configured (Automated)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

Log files stored in `/var/log/` contain logged information from many services on the system, or on log hosts others as well.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected. Access to the log files should be restricted to authorized personnel only.

## Audit Procedure

### Command Line

Run the following script to verify that log files have appropriate permissions and ownership. Note: The script checks that log files are not world-readable, world-writable, or world-executable, and are owned by root or a system account.

```bash
find /var/log -type f -perm /g+wx,o+rwx -exec ls -l {} +
```

## Expected Result

No files should be returned, indicating all log files have appropriate permissions.

## Remediation

### Command Line

Run the following command to remove inappropriate permissions from log files:

```bash
find /var/log -type f -exec chmod g-wx,o-rwx {} +
```

## Default Value

Permissions vary by log file and distribution defaults.

## References

1. NIST SP 800-53 Rev. 5: AC-3, AU-2, AU-12, MP-2, SI-5

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. |
| v8 | 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
