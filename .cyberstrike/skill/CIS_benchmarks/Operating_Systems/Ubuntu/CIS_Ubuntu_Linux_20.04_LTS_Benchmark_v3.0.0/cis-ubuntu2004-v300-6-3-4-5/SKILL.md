---
name: cis-ubuntu2004-v300-6-3-4-5
skill: cis-ubuntu2004-v300-6-3-4-5
category: cis-logging
version: "3.0.0"
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
severity_boost: {}
---

# 6.3.4.5 Ensure audit configuration files mode is configured (Automated)

## Profile Applicability
- Level 2 - Server
- Level 2 - Workstation

## Description
Audit configuration files control auditd and what events are audited.

## Rationale
Access to the audit configuration files could allow unauthorized personnel to prevent the auditing of critical events.

Misconfigured audit configuration files may prevent the auditing of critical events or impact the system's performance by overwhelming the audit log. Misconfiguration of the audit configuration files may also make it more difficult to establish and investigate events relating to an incident.

## Audit
Run the following script to verify that the audit configuration files are mode `0640` or more restrictive:

```bash
#!/usr/bin/env bash
{
  l_output="" l_output2="" l_perm_mask="0137"
  l_maxperm="$( printf '%o' $(( 0777 & ~$l_perm_mask )) )"
  while IFS= read -r -d $'\0' l_fname; do
    l_mode="$( stat -Lc '%#a' "$l_fname" )"
    if [ $(( $l_mode & $l_perm_mask )) -gt 0 ]; then
      l_output2="$l_output2\n - file: \"$l_fname\" is mode: \"$l_mode\" (should be mode: \"$l_maxperm\" or more restrictive)"
    else
      l_output="$l_output\n - file: \"$l_fname\" is correctly configured to mode: \"$l_mode\""
    fi
  done < <(find /etc/audit/ -type f \( -name '*.conf' -o -name '*.rules' \) -print0)
  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n ** PASS **\n - All audit configuration files are mode: \"$l_maxperm\" or more restrictive"
  else
    echo -e "\n- Audit Result:\n ** FAIL **\n$l_output2"
  fi
}
```

## Remediation
Run the following command to remove more permissive mode than `0640` from the audit configuration files:

```bash
find /etc/audit/ -type f \( -name '*.conf' -o -name '*.rules' \) -exec chmod u-x,g-wx,o-rwx {} +
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
