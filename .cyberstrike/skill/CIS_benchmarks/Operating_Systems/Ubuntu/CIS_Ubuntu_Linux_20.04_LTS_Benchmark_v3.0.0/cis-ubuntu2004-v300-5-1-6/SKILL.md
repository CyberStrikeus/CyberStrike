---
name: cis-ubuntu2004-v300-5-1-6
description: "Ensure sshd Ciphers are configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sshd Ciphers are configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

This variable limits the ciphers that SSH can use during communication.

Notes:
- Some organizations may have stricter requirements for approved ciphers.
- Ensure that ciphers used are in compliance with site policy.
- The only "strong" ciphers currently FIPS 140 compliant are:
  - aes256-gcm@openssh.com
  - aes128-gcm@openssh.com
  - aes256-ctr
  - aes192-ctr
  - aes128-ctr

## Rationale

Weak ciphers that are used for authentication to the cryptographic module cannot be relied upon to provide confidentiality or integrity, and system data may be compromised.

- The Triple DES ciphers, as used in SSH, have a birthday bound of approximately four billion blocks, which makes it easier for remote attackers to obtain clear text data via a birthday attack against a long-duration encrypted session, aka a "Sweet32" attack.
- Error handling in the SSH protocol; Client and Server, when using a block cipher algorithm in Cipher Block Chaining (CBC) mode, makes it easier for remote attackers to recover certain plain text data from an arbitrary block of cipher text in an SSH session via unknown vectors.

## Audit Procedure

### Command Line

Run the following command to verify none of the "weak" ciphers are being used:

```bash
# sshd -T | grep -Pi -- '^\h*ciphers\h+\"?([^#\n\r]+,)?(3des|blowfish|cast128|aes(128|192|256)-cbc|arcfour(128|256)?|rijndael-cbc@lysator\.liu\.se|chacha20-poly1305@openssh\.com)\b'
```

- IF - a line is returned, review the list of ciphers. If the line includes `chacha20-poly1305@openssh.com`, review CVE-2023-48795 and verify the system has been patched. No ciphers in the list below should be returned as they're considered "weak":

```
3des-cbc
aes128-cbc
aes192-cbc
aes256-cbc
```

## Expected Result

Nothing should be returned (no weak ciphers in use).

## Remediation

### Command Line

Edit the /etc/ssh/sshd_config file and add/modify the `Ciphers` line to contain a comma separated list of the site unapproved (weak) Ciphers preceded with a `-` above any `Include` entries:
Example:

```
Ciphers -3des-cbc,aes128-cbc,aes192-cbc,aes256-cbc,chacha20-poly1305@openssh.com
```

- IF - CVE-2023-48795 has been addressed, and it meets local site policy, `chacha20-poly1305@openssh.com` may be removed from the list of excluded ciphers.
Note: First occurrence of an option takes precedence. If Include locations are enabled, used, and order of precedence is understood in your environment, the entry may be created in a file in Include location.

## Default Value

Ciphers chacha20-poly1305@openssh.com,aes128-ctr,aes192-ctr,aes256-ctr,aes128-gcm@openssh.com,aes256-gcm@openssh.com

## References

1. https://nvd.nist.gov/vuln/detail/CVE-2023-48795
2. https://nvd.nist.gov/vuln/detail/CVE-2019-1543
3. https://nvd.nist.gov/vuln/detail/CVE-2016-2183
4. https://nvd.nist.gov/vuln/detail/CVE-2008-5161
5. https://www.openssh.com/txt/cbc.adv
6. SSHD_CONFIG(5)
7. NIST SP 800-53 Rev. 5: SC-8

## CIS Controls

v8 - 3.10 Encrypt Sensitive Data in Transit
Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH).

v7 - 14.4 Encrypt All Sensitive Information in Transit
Encrypt all sensitive information in transit.

MITRE ATT&CK Mappings: T1040, T1040.000, T1557 | TA0006 | M1041
