---
name: cis-ubuntu2004-v300-6-3-4-4
skill: cis-ubuntu2004-v300-6-3-4-4
category: cis-logging
version: "3.0.0"
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
severity_boost: {}
---

# 6.3.4.4 Ensure the audit log file directory mode is configured (Automated)

## Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

## Description
The audit log directory contains audit log files.

## Rationale
Audit information includes all information including: audit records, audit settings and audit reports. This information is needed to successfully audit system activity. This information must be protected from unauthorized modification or deletion. If this information were to be compromised, forensic analysis and discovery of the true source of potentially malicious system activity is impossible to achieve.

## Audit
Run the following script to verify the audit log directory is mode `0750` or more restrictive:

```bash
#!/usr/bin/env bash
{
  l_perm_mask="0027"
  if [ -e "/etc/audit/auditd.conf" ]; then
    l_audit_log_directory="$(dirname "$(awk -F= '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")"
    if [ -d "$l_audit_log_directory" ]; then
      l_maxperm="$(printf '%o' $(( 0777 & ~$l_perm_mask )) )"
      l_directory_mode="$(stat -Lc '%#a' "$l_audit_log_directory")"
      if [ $(( $l_directory_mode & $l_perm_mask )) -gt 0 ]; then
        echo -e "\n- Audit Result:\n ** FAIL **\n - Directory: \"$l_audit_log_directory\" is mode: \"$l_directory_mode\"\n (should be mode: \"$l_maxperm\" or more restrictive)\n"
      else
        echo -e "\n- Audit Result:\n ** PASS **\n - Directory: \"$l_audit_log_directory\" is mode: \"$l_directory_mode\"\n (should be mode: \"$l_maxperm\" or more restrictive)\n"
      fi
    else
      echo -e "\n- Audit Result:\n ** FAIL **\n - Log file directory not set in \"/etc/audit/auditd.conf\" please set log file directory"
    fi
  else
    echo -e "\n- Audit Result:\n ** FAIL **\n - File: \"/etc/audit/auditd.conf\" not found\n - ** Verify auditd is installed **"
  fi
}
```

## Remediation
Run the following command to configure the audit log directory to have a mode of "0750" or less permissive:

```bash
chmod g-w,o-rwx "$(dirname "$(awk -F= '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")"
```

## Default Value
750

## References
1. NIST SP 800-53 Rev. 5: AU-3

## CIS Controls
- v8: 3.3 Configure Data Access Control Lists
- v7: 14.6 Protect Information through Access Control Lists

## MITRE ATT&CK Mappings
- **Techniques**: T1070, T1070.002, T1083, T1083.000
- **Tactics**: TA0007
- **Mitigations**: M1022
