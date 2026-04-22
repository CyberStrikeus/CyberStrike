---
name: cis-ubuntu2004-v300-7-2-2
description: "Ensure /etc/shadow password fields are not empty"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, users]
cis_id: "7.2.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 7.2.2 Ensure /etc/shadow password fields are not empty (Automated)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

An account with an empty password field means that anybody may log in as that user without providing a password.

## Rationale

All accounts must have passwords or be locked to prevent the account from being used by an unauthorized user.

## Impact

None

## Audit Procedure

### Command Line

Run the following command and verify that no output is returned:

```bash
# awk -F: '($2 == "" ) { print $1 " does not have a password "}' /etc/shadow
```

## Expected Result

No output should be returned.

## Remediation

### Command Line

If any accounts in the `/etc/shadow` file do not have a password, run the following command to lock the account until it can be determined why it does not have a password:

```bash
# passwd -l <username>
```

Also, check to see if the account is logged in and investigate what it is being used for to determine if it needs to be forced off.

## Default Value

N/A

## References

1. NIST SP 800-53 Rev. 5: IA-5
2. NIST SP 800-53 Revision 5 :: CM-6 b
3. NIST SP 800-53A :: CM-6.1 (iv)

## CIS Controls

| Controls Version | Control                  | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------ | ---- | ---- | ---- |
| v8               | 5.2 Use Unique Passwords | X    | X    | X    |
| v7               | 4.4 Use Unique Passwords |      | X    | X    |

MITRE ATT&CK Mappings:

| Techniques / Sub-techniques | Tactics | Mitigations |
| --------------------------- | ------- | ----------- |
| T1078, T1078.001, T1078.003 | TA0003  | M1027       |
