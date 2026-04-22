---
name: cis-ubuntu1204-v110-9-3-11
description: "Use Only Approved Cipher in Counter Mode"
category: cis-os-hardening
version: "1.1.0"
author: cyberstrike-official
tags: [cis, ubuntu, 12.04, linux, authentication, ssh, ciphers, encryption]
cis_id: "9.3.11"
cis_benchmark: "CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.3.11 Use Only Approved Cipher in Counter Mode (Scored)

## Profile Applicability
- Level 1

## Description
This variable limits the types of ciphers that SSH can use during communication.

## Rationale
Based on research conducted at various institutions, it was determined that the symmetric portion of the SSH Transport Protocol (as described in RFC 4253) has security weaknesses that allowed recovery of up to 32 bits of plaintext from a block of ciphertext that was encrypted with the Cipher Block Chaining (CBC) method. From that research, new Counter mode algorithms (as described in RFC 4344) were designed that are not vulnerable to these types of attacks and these algorithms are now recommended for standard use.

## Audit Procedure
### Using Command Line
To verify the correct SSH setting, run the following command and verify that the output is as shown:
```bash
grep "Ciphers" /etc/ssh/sshd_config
```

## Expected Result
```
Ciphers aes128-ctr,aes192-ctr,aes256-ctr
```

## Remediation
### Using Command Line
Edit the `/etc/ssh/sshd_config` file to set the parameter as follows:
```bash
Ciphers aes128-ctr,aes192-ctr,aes256-ctr
```

## Default Value
Ciphers aes128-ctr,aes192-ctr,aes256-ctr,aes128-cbc,3des-cbc,blowfish-cbc,cast128-cbc,aes192-cbc,aes256-cbc

## References
- CIS Ubuntu 12.04 LTS Server Benchmark v1.1.0
- RFC 4253 - The Secure Shell (SSH) Transport Layer Protocol
- RFC 4344 - The Secure Shell (SSH) Transport Layer Encryption Modes

## Profile
Level 1 - Scored
