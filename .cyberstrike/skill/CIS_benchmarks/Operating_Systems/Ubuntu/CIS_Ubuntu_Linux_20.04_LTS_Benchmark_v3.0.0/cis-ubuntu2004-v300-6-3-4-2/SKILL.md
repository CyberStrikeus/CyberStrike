---
name: cis-ubuntu2004-v300-6-3-4-2
skill: cis-ubuntu2004-v300-6-3-4-2
category: cis-logging
version: "3.0.0"
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
severity_boost: {}
---

# 6.3.4.2 Ensure audit log files owner is configured (Automated)

## Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

## Description
Audit log files contain information about the system and system activity.

## Rationale
Access to audit records can reveal system and configuration data to attackers, potentially compromising its confidentiality.

## Audit
Run the following script to verify audit log files are owned by the `root` user:

```bash
#!/usr/bin/env bash
{
  l_output="" l_output2=""
  if [ -e "/etc/audit/auditd.conf" ]; then
    l_audit_log_directory="$(dirname "$(awk -F= '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")"
    if [ -d "$l_audit_log_directory" ]; then
      while IFS= read -r -d $'\0' l_file; do
        l_output2="$l_output2\n - File: \"$l_file\" is owned by user: \"$(stat -Lc '%U' "$l_file")\" (should be owned by user: \"root\")\n"
      done < <(find "$l_audit_log_directory" -maxdepth 1 -type f ! -user root -print0)
      l_output2="$l_output2\n - Log file directory not set in \"/etc/audit/auditd.conf\" please set log file directory"
    fi
  else
    l_output2="$l_output2\n - File: \"/etc/audit/auditd.conf\" not found.\n - ** Verify auditd is installed ***"
  fi
  if [ -z "$l_output2" ]; then
    if [ -z "$l_output" ]; then
      l_output="\n- All files in \"$l_audit_log_directory\" are owned by user: \"root\"\n"
      echo -e "\n- Audit Result:\n ** PASS **\n - * Correctly configured * :$l_output"
    else
      echo -e "\n- Audit Result:\n ** FAIL **\n - * Reasons for audit failure * :$l_output2\n"
    fi
  fi
}
```

## Remediation
Run the following command to configure the audit log files to be owned by the `root` user:

```bash
[ ! -f /etc/audit/auditd.conf ] && find "$(dirname "$(awk -F= '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")" -type f ! -user root -exec chown root {} +
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
