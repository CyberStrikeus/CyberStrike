---
name: "CIS Ubuntu 14.04 LTS - 5.2.11 Ensure only approved MAC algorithms are used"
description: "Verify SSH is configured to use only approved MAC algorithms to prevent weak cipher attacks"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-1
  - scored
  - ssh
cis_id: "5.2.11"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "medium"
---

# 5.2.11 Ensure only approved MAC algorithms are used (Scored)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

This variable limits the types of MAC algorithms that SSH can use during communication.

## Rationale

MD5 and 96-bit MAC algorithms are considered weak and have been shown to increase exploitability in SSH downgrade attacks. Weak algorithms continue to have a great deal of attention as a weak spot that can be exploited with expanded computing power. An attacker that breaks the algorithm could take advantage of a MiTM position to decrypt the SSH tunnel and capture credentials and information.

## Audit Procedure

Run the following command and verify that output does not contain any unlisted MAC algorithms:

```bash
grep "MACs" /etc/ssh/sshd_config
```

## Expected Result

```
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com,hmac-sha2-512,hmac-sha2-256,umac-128@openssh.com,curve25519-sha256@libssh.org,diffie-hellman-group-exchange-sha256
```

## Remediation

Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:

```
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,umac-128-etm@openssh.com,hmac-sha2-512,hmac-sha2-256,umac-128@openssh.com
```

## Default Value

MACs include all available algorithms by default.

## References

1. More information on SSH downgrade attacks can be found here: http://www.mitls.org/pages/attacks/SLOTH

- CIS Controls: 3.4 - Use Only Secure Channels For Remote System Administration

## Profile

- Level 1 - Server
- Level 1 - Workstation
