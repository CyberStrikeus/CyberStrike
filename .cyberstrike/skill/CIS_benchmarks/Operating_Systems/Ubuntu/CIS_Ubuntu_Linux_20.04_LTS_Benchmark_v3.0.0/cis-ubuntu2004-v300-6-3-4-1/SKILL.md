---
name: cis-ubuntu2004-v300-6-3-4-1
skill: cis-ubuntu2004-v300-6-3-4-1
category: cis-logging
version: "3.0.0"
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
severity_boost: {}
---

# 6.3.4.1 Ensure audit log files mode is configured (Automated)

## Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

## Description
Audit log files contain information about the system and system activity.

## Rationale
Access to audit records can reveal system and configuration data to attackers, potentially compromising its confidentiality.

## Audit
Run the following script to verify audit log files are mode `0640` or more restrictive:

```bash
#!/usr/bin/env bash
{
  l_perm_mask="0137"
  if [ -e "/etc/audit/auditd.conf" ]; then
    l_audit_log_directory="$(dirname "$(awk -F= '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")"
    if [ -d "$l_audit_log_directory" ]; then
      l_maxperm="$(printf '%o' $(( 0777 & ~$l_perm_mask )) )"
      a_files=()
      while IFS= read -r -d $'\0' l_file; do
        [ -e "$l_file" ] && a_files+=("$l_file")
      done < <(find "$l_audit_log_directory" -maxdepth 1 -type f -perm /0137 -print0)
      if [ "${#a_files[@]}" -gt 0 ]; then
        for l_file in "${a_files[@]}"; do
          l_file_mode="$(stat -Lc '%#a' "$l_file")"
          echo -e "\n- File: \"$l_file\" is mode: \"$l_file_mode\"\n (should be mode: \"$l_maxperm\" or more restrictive)\n"
        done
      else
        echo -e "\n- Audit Result:\n ** PASS **\n - All files in \"$l_audit_log_directory\" are mode: \"$l_maxperm\" or more restrictive"
      fi
    else
      echo -e "\n- Audit Result:\n ** FAIL **\n - Log file directory not set in \"/etc/audit/auditd.conf\" please set log file directory"
    fi
  else
    echo -e "\n- Audit Result:\n ** FAIL **\n - File: \"/etc/audit/auditd.conf\" not found.\n - ** Verify auditd is installed **"
  fi
}
```

## Remediation
Run the following command to remove more permissive mode than `0640` from audit log files:

```bash
[ ! -f /etc/audit/auditd.conf ] && find "$(dirname "$(awk -F= '/^\s*log_file/ {print $2}' /etc/audit/auditd.conf | xargs)")" -type f -perm /0137 -exec chmod u-x,g+w,o-rwx {} +
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
