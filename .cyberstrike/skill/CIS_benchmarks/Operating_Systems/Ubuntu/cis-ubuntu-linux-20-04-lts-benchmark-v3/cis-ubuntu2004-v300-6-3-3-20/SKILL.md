---
name: cis-ubuntu2004-v300-6-3-3-20
version: "3.0.0"
tags:
  - cis
  - ubuntu
  - linux
  - ubuntu-20.04
  - auditing
  - auditd
category: cis-logging
severity_boost: {}
---

# CIS Ubuntu 20.04 LTS Benchmark v3.0.0 - 6.3.3.20

**Control:** Ensure the audit configuration is immutable

**Profile Applicability:** Level 2 - Server, Level 2 - Workstation

**Description:**
Set system audit so that audit rules cannot be modified with auditctl. Setting the flag "-e 2" forces audit to be put in immutable mode. Audit changes can only be made on system reboot.

Note: This setting will require the system to be rebooted to update the active auditd configuration settings.

**Rationale:**
In immutable mode, unauthorized users cannot execute changes to the audit system to potentially hide malicious activity and then put the audit rules back. Users would most likely notice a system reboot and that could alert administrators of an attempt to make unauthorized audit changes.

## Audit

Run the following command and verify output matches:

```bash
grep -Ph -- '^\h*-e\h+2\b' /etc/audit/rules.d/*.rules | tail -1
```

Expected output:

```
-e 2
```

## Remediation

Edit or create the file `/etc/audit/rules.d/99-finalize.rules` and add the line `-e 2` at the end of the file.

Example:

```bash
printf '\n-e 2' >> /etc/audit/rules.d/99-finalize.rules
```

Load audit rules:

```bash
augenrules --load
```

Check if reboot is required:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then printf "Reboot required to load rules\n"; fi
```

**CIS Controls:**

- v8: 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications.
- v8: 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation.
- v7: 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.
- v7: 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

**MITRE ATT&CK Mappings:**

- Techniques: T1562, T1562.001
- Tactics: TA0005
- Mitigations: M1022

**References:**

- NIST SP 800-53 Rev. 5: AC-3, AU-3, AU-12, MP-2
