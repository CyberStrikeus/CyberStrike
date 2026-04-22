---
name: cis-ubuntu2004-v300-6-3-4-8
skill: cis-ubuntu2004-v300-6-3-4-8
category: cis-logging
version: "3.0.0"
tags: [cis, ubuntu, linux, ubuntu-20.04, auditing, auditd]
severity_boost: {}
---

# 6.3.4.8 Ensure audit tools mode is configured (Automated)

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

Audit tools include, but are not limited to, vendor-provided and open source audit tools needed to successfully view and manipulate audit information system activity and records. Audit tools include custom queries and report generators.

## Rationale

Protecting audit information includes identifying and protecting the tools used to view and manipulate log data. Protecting audit tools is necessary to prevent unauthorized operation on audit information.

## Audit

Run the following script to verify the audit tools are mode `0755` or more restrictive:

```bash
#!/usr/bin/env bash
{
  l_output="" l_output2="" l_perm_mask="0022"
  l_maxperm="$( printf '%o' $(( 0777 & ~$l_perm_mask )) )"
  a_audit_tools=("/sbin/auditctl" "/sbin/aureport" "/sbin/ausearch" "/sbin/autrace" "/sbin/auditd" "/sbin/augenrules")
  for l_audit_tool in "${a_audit_tools[@]}"; do
    l_mode="$(stat -Lc '%#a' "$l_audit_tool")"
    if [ $(( $l_mode & $l_perm_mask )) -gt 0 ]; then
      l_output2="$l_output2\n - Audit tool \"$l_audit_tool\" is mode: \"$l_mode\" and should be mode: \"$l_maxperm\" or more restrictive"
    else
      l_output="$l_output\n - Audit tool \"$l_audit_tool\" is correctly configured to mode: \"$l_mode\""
    fi
  done
  if [ -z "$l_output2" ]; then
    echo -e "\n- Audit Result:\n ** PASS **\n - * Correctly configured * :$l_output"
  else
    echo -e "\n- Audit Result:\n ** FAIL **\n - * Reasons for audit failure * :$l_output2\n"
    [ -n "$l_output" ] && echo -e "\n - * Correctly configured * :\n$l_output\n"
  fi
  unset a_audit_tools
}
```

## Remediation

Run the following command to remove more permissive mode from the audit tools:

```bash
chmod go-w /sbin/auditctl /sbin/aureport /sbin/ausearch /sbin/autrace /sbin/auditd /sbin/augenrules
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
