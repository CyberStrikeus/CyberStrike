---
name: cis-ubuntu2004-v300-6-3-4-3
skill: cis-ubuntu2004-v300-6-3-4-3
category: cis-logging
version: "3.0.0"
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
severity_boost: {}
---

# 6.3.4.3 Ensure audit log files group owner is configured (Automated)

## Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

## Description
Audit log files contain information about the system and system activity.

## Rationale
Access to audit records can reveal system and configuration data to attackers, potentially compromising its confidentiality.

## Audit
Run the following command to verify `log_group` parameter is set to either `adm` or `root` in `/etc/audit/auditd.conf`:

```bash
grep -Piws -- '^\h*log_group\h*=\h*\h*(adm|root)\h*$' /etc/audit/auditd.conf | grep -Pvl -- '(adm)'
```

Nothing should be returned.

Using the path of the directory containing the audit logs, verify audit log files are owned by the "root" or "adm" group by running the following script:

```bash
#!/usr/bin/env bash
{
  if [ -e /etc/audit/auditd.conf ]; then
    l_fpath="$(dirname "$(awk -F= '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")"
    [ find -L "$l_fpath" -not -path "$l_fpath"/lost+found -type f \( ! -group root -a ! -group adm \) -exec ls
  fi
}
```

Nothing should be returned.

## Remediation
Run the following command to configure the audit log files to be group owned by `adm`:

```bash
[ find -L "$(dirname "$(awk -F= '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")" -type f \( ! -group adm -a ! -group root \) -exec chgrp adm {} +
```

Run the following command to set the `log_group` parameter in the audit configuration file to `log_group = adm`:

```bash
[ sed -ri 's/^\s*#?\s*log_group\s*=\s*\S+(\s*.*)?$/log_group = adm\1/' /etc/audit/auditd.conf
```

Run the following command to restart the audit daemon to reload the configuration file:

```bash
systemctl restart auditd
```

## References
1. NIST SP 800-53 Rev. 5: AU-3

## CIS Controls
- v8: 3.3 Configure Data Access Control Lists
- v7: 14.6 Protect Information through Access Control Lists

## MITRE ATT&CK Mappings
- **Techniques**: T1070, T1070.002, T1083, T1083.000
- **Tactics**: TA0007
- **Mitigations**: M1022
