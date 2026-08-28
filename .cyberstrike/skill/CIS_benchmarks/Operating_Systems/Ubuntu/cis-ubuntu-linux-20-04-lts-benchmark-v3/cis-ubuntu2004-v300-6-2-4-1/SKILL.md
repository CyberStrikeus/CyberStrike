---
name: cis-ubuntu2004-v300-6-2-4-1
description: "Ensure access to all logfiles has been configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, logging]
cis_id: "6.2.4.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.4.1 Ensure access to all logfiles has been configured (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Log files contain information from many services on the the local system, or in the event of a centralized log server, others systems logs as well.

In general log files are found in `/var/log/`, although application can be configured to store logs elsewhere. Should your application store logs in another, ensure to run the same test on that location.

## Rationale

It is important that log files have the correct permissions to ensure that sensitive data is protected and that only the appropriate users / groups have access to them.

## Audit Procedure

### Command Line

Run the following script to verify that files in `/var/log/` have appropriate permissions and ownership:

```bash
#!/usr/bin/env bash
{
    a_output=(); a_output2=()
    f_file_test_chk()
    {
        a_out2=()
        maxperm="$( printf '%o' $(( 0777 & ~$perm_mask )) )"
        [ $(( $l_mode & $perm_mask )) -gt 0 ] && \
            a_out2+=("   o Mode: \"$l_mode\" should be \"$maxperm\" or more restrictive")
        [[ ! "$l_user" =~ $l_auser ]] && \
            a_out2+=("   o Owned by: \"$l_user\" and should be owned by \"${l_auser//|/ or }\"")
        [[ ! "$l_group" =~ $l_agroup ]] && \
            a_out2+=("   o Group owned by: \"$l_group\" and should be group owned by \"${l_agroup//|/ or }\"")
        [ "${#a_out2[@]}" -gt 0 ] && a_output2+=(" - File: \"$l_fname\" is:" "${a_out2[@]}")
    }
    while IFS= read -r -d $'\0' l_file; do
        while IFS=: read -r l_fname l_mode l_user l_group; do
            # ... (full audit script from benchmark)
        done
    done < <(find -L /var/log -type f \( -perm /0137 -o ! -user root -o ! -group root \) -print0)
    if [ "${#a_output2[@]}" -le 0 ]; then
        a_output+=(" - All files in \"/var/log/\" have appropriate permissions and ownership")
        printf '\n%s' "- Audit Result:" " ** PASS **" "${a_output[@]}" ""
    else
        printf '\n%s' "- Audit Result:" " ** FAIL **" " - Reason(s) for audit failure:" "${a_output2[@]}" ""
    fi
}
```

## Expected Result

All files in "/var/log/" should have appropriate permissions and ownership.

## Remediation

### Command Line

Review the audit output and correct any log file permissions or ownership that do not conform to site policy. The specific permissions required depend on the log file type and the site's security requirements.

## Default Value

Default permissions vary by log file.

## References

1. NIST SP 800-53 Rev. 5: AC-3, AU-2, AU-12, MP-2, SI-5

## CIS Controls

| Controls Version | Control                                               | IG 1 | IG 2 | IG 3 |
| ---------------- | ----------------------------------------------------- | ---- | ---- | ---- |
| v8               | 3.3 Configure Data Access Control Lists               |      |      |      |
| v7               | 14.6 Protect Information through Access Control Lists |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1083, T1083.000 | TA0007  | M1022       |
