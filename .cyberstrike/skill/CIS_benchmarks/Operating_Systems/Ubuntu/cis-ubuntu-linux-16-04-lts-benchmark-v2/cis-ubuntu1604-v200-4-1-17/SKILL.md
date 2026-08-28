---
name: cis-ubuntu1604-v200-4-1-17
description: "Ensure the audit configuration is immutable"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, auditd, logging]
cis_id: "4.1.17"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.1.17

## Profile

- **Level:** 2 - Server
- **Level:** 2 - Workstation
- **Assessment Status:** Automated

## Description

Set system audit so that audit rules cannot be modified with `auditctl`. Setting the flag "-e 2" forces audit to be put in immutable mode. Audit changes can only be made on system reboot.

**Note:** Reloading the auditd config to set active settings requires the auditd service to be restarted, and may require a system reboot.

## Rationale

In immutable mode, unauthorized users cannot execute changes to the audit system to potentially hide malicious activity and then put the audit rules back. Users would most likely notice a system reboot and that could alert administrators of an attempt to make unauthorized audit changes.

## Impact

Any changes to the audit configuration will require a system reboot to take effect.

## Audit Procedure

### Command Line

Run the following command and verify output matches:

```bash
grep "^\s*[^#]" /etc/audit/rules.d/*.rules | tail -1
```

## Expected Result

```
-e 2
```

The last line in the rules should be `-e 2`.

## Remediation

### Command Line

Edit or create a file in the `/etc/audit/rules.d/` directory ending in `.rules` and add the following line at the end of the file:

```bash
-e 2
```

**Note:** This must be the last line in the last rules file loaded. Ensure that it is in a file that will be loaded after all other rules files (e.g. `99-finalize.rules`).

## Default Value

By default, the audit configuration is not immutable.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Section 4.1.17

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                                                          |
| v7               | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
