---
skill_id: cis-ubuntu1804-v220-5-2-1-1
name: cis-ubuntu1804-v220-5-2-1-1
description: "Verify that auditd and audispd-plugins packages are installed"
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

## Control 5.2.1.1 - Ensure auditd is installed (Automated)

### Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

### Description

auditd is the userspace component to the Linux Auditing System. It's responsible for writing audit records to the disk.

### Rationale

The capturing of system events provides system administrators with information to allow them to determine if unauthorized access to their system is occurring.

### Audit

Run the following command and verify auditd and audispd-plugins are installed:

```bash
dpkg-query -s auditd &>/dev/null && echo "auditd is installed"
```

**Expected Output:**

```
auditd is installed
```

### Remediation

Run the following command to Install auditd:

```bash
apt install auditd
```

### References

- NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12, SI-5

### CIS Controls

- v8 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation.
- v7 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.

### MITRE ATT&CK Mappings

- Techniques: T1562, T1562.001
- Tactics: TA0005 (Defense Evasion)
- Mitigations: M1028 (Operating System Configuration)

### Benchmark

CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0

### Automation Status

Automated
