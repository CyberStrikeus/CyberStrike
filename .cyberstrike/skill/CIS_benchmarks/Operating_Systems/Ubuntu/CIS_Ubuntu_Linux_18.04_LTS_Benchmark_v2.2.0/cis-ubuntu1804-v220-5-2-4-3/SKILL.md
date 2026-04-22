---
name: cis-ubuntu1804-v220-5-2-4-3
description: 
version: "2.2.0"
category: cis-logging
tags: [cis, ubuntu, linux, ubuntu-18.04, auditing, auditd]
author: CIS Benchmarks
target:
  platform: linux
  version: "18.04"
severity_boost: {}
---

# 5.2.4.3 Ensure only authorized groups are assigned ownership of audit log files

## Description

Audit log files contain information about the system and system activity.

## Rationale

Access to audit records can reveal system and configuration data to attackers, potentially compromising its confidentiality.

## Audit

Run the following command to verify log_group parameter is set to either adm or root in /etc/audit/auditd.conf:

```bash
grep -Pws -- '^\h*log_group\h*=\h*\H+\b' /etc/audit/auditd.conf | grep -Pv -- '(adm|root)'
```

**Expected result:** Nothing should be returned

Using the path of the directory containing the audit logs, verify audit log files are owned by the "root" or "adm" group by running the following script:

```bash
#!/usr/bin/env bash

if [ -e /etc/audit/auditd.conf ]; then
  l_fpath="$(dirname "$(awk -F "=" '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")"
  [ -d "$l_fpath" ] && find -L "$l_fpath" -type f \( ! -group root -a ! -group adm \) -exec ls -l {} + || echo "Pass"
fi
```

**Expected result:** Nothing should be returned

## Remediation

Run the following command to configure the audit log files to be group owned by adm:

```bash
find $(dirname $(awk -F"=" '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)) -type f \( ! -group root -a ! -group adm \) -exec chgrp adm {} +
```

Run the following command to set the log_group parameter in the audit configuration file to log_group = adm:

```bash
sed -ri 's/^\s*#?\s*log_group\s*=\s*\S+(\s*#.*)?$/log_group = adm\1/' /etc/audit/auditd.conf
```

Run the following command to restart the audit daemon to reload the configuration file:

```bash
systemctl restart auditd
```

## References

1. NIST SP 800-53 Rev. 5: AU-3

## Metadata

- **Profile Applicability:** Level 2 - Server, Level 2 - Workstation
- **Category:** cis-logging
- **Tags:** cis, ubuntu, linux, ubuntu-18.04, auditing, auditd
- **Version:** 2.2.0
- **Severity Boost:** {}
- **Automated:** Yes
- **CIS Controls:**
  - v8: 3.3 Configure Data Access Control Lists
  - v7: 14.6 Protect Information through Access Control Lists
- **MITRE ATT&CK:**
  - Tactics: TA0007 (Discovery)
  - Techniques: T1070, T1070.002, T1083, T1083.000
  - Mitigations: M1047 (Audit)
