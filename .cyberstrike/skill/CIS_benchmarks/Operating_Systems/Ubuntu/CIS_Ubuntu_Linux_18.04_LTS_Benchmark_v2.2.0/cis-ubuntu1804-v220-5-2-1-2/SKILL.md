---
skill_id: cis-ubuntu1804-v220-5-2-1-2
name: cis-ubuntu1804-v220-5-2-1-2
description: "Verify that the auditd daemon is enabled and running to record system events"
version: "2.2.0"
category: cis-logging
tags:
  - cis
  - ubuntu
  - linux
  - ubuntu-18.04
  - auditing
  - auditd
profile_applicability:
  - "Level 2 - Server"
  - "Level 2 - Workstation"
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

## Control 5.2.1.2 - Ensure auditd service is enabled and active (Automated)

### Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

### Description
Turn on the auditd daemon to record system events.

### Rationale
The capturing of system events provides system administrators with information to allow them to determine if unauthorized access to their system is occurring.

### Audit

Run the following command to verify auditd is enabled:

```bash
systemctl is-enabled auditd
```

**Expected Output:**
```
enabled
```

Verify result is "enabled".

Run the following command to verify auditd is active:

```bash
systemctl is-active auditd
```

**Expected Output:**
```
active
```

Verify result is "active".

### Remediation

Run the following command to enable and start auditd:

```bash
systemctl --now enable auditd
```

### References
- NIST SP 800-53 Rev. 5: AU-2, AU-12, SI-5

### CIS Controls
- v8 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.
- v7 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.
- v7 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

### MITRE ATT&CK Mappings
- Techniques: T1562, T1562.001
- Tactics: TA0005 (Defense Evasion)
- Mitigations: M1028 (Operating System Configuration)

### Benchmark
CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

### Automation Status
Automated
