---
name: cis-ubuntu2004-v300-6-3-3-21
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

# CIS Ubuntu 20.04 LTS Benchmark v3.0.0 - 6.3.3.21

**Control:** Ensure the running and on disk configuration is the same

**Profile Applicability:** Level 2 - Server, Level 2 - Workstation

**Description:**
Verify that the on disk and running audit configurations are the same to ensure that audit logging is consistent and captures all expected events.

**Rationale:**
Ensuring the on disk and running configurations match prevents situations where audit rules are configured but not active, potentially missing critical security events. Discrepancies can occur when rules are modified but not loaded, or when the system configuration has been altered without proper documentation.

## Audit

Run the following command to compare on disk and running configurations:

```bash
#!/usr/bin/env bash
{
  echo "Checking if running configuration matches on-disk configuration..."

  # Get running config
  auditctl -l > /tmp/running_audit.tmp

  # Generate on-disk config
  augenrules --check > /tmp/ondisk_audit.tmp 2>&1

  # Compare
  if diff /tmp/running_audit.tmp /tmp/ondisk_audit.tmp &>/dev/null; then
    echo "PASS: Running and on-disk configurations match"
  else
    echo "FAIL: Running and on-disk configurations differ"
    echo "Differences:"
    diff /tmp/running_audit.tmp /tmp/ondisk_audit.tmp
  fi

  # Cleanup
  rm -f /tmp/running_audit.tmp /tmp/ondisk_audit.tmp
}
```

Alternatively, check if the configurations match:

```bash
augenrules --check
```

Expected output:

```
/sbin/augenrules: No change
```

## Remediation

If the running and on-disk configurations differ, load the on-disk configuration to make them match:

```bash
augenrules --load
```

If the audit configuration is immutable (auditctl -e 2), a system reboot will be required to load the on-disk configuration:

```bash
if [[ $(auditctl -s | grep "enabled") =~ "2" ]]; then
  printf "Reboot required to load rules\n"
  # Schedule a reboot or notify administrator
fi
```

**Additional Information:**

The `augenrules --check` command compares the running audit configuration with the rules defined in `/etc/audit/rules.d/`. If there are differences, it indicates that:

- Rules have been added/modified in `/etc/audit/rules.d/` but not loaded
- The running configuration has been altered using `auditctl` without updating on-disk rules
- The system was not rebooted after making changes while in immutable mode

**Best Practices:**

1. Always use `/etc/audit/rules.d/*.rules` files for persistent audit rules
2. After modifying rules, run `augenrules --load` to apply changes
3. Verify changes with `augenrules --check`
4. In production environments with immutable audit config (-e 2), plan maintenance windows for rule changes
5. Document all audit rule changes in configuration management

**CIS Controls:**

- v8: 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.
- v8: 8.5 Collect Detailed Audit Logs - Configure detailed audit logging for enterprise assets containing sensitive data.
- v7: 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.
- v7: 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

**MITRE ATT&CK Mappings:**

- Techniques: T1562, T1562.001
- Tactics: TA0005
- Mitigations: M1022

**References:**

- NIST SP 800-53 Rev. 5: AU-2, AU-3, AU-12
- man 8 augenrules
- man 8 auditctl
