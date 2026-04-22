---
name: cis-ubuntu2004-v300-5-3-3-4-3
description: "Ensure pam_unix includes a strong password hashing algorithm"
category: cis-iam
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, pam, authentication]
cis_id: "5.3.3.4.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.3.3.4.3 Ensure pam_unix includes a strong password hashing algorithm (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

A cryptographic hash function converts an arbitrary-length input into a fixed length output. Password hashing performs a one-way transformation of a password, turning the password into another string, called the hashed password.

The `pam_unix` module can be configured to use one of the following hashing algorithms for user's passwords:

- `md5` - When a user changes their password next, encrypt it with the `MD5` algorithm.
- `bigcrypt` - When a user changes their password next, encrypt it with the `DEC C2` algorithm.
- `sha256` - When a user changes their password next, encrypt it with the `SHA256` algorithm. The `SHA256` algorithm must be supported by the crypt(3) function.
- `sha512` - When a user changes their password next, encrypt it with the `SHA512` algorithm. The `SHA512` algorithm must be supported by the crypt(3) function.
- `blowfish` - When a user changes their password next, encrypt it with the `blowfish` algorithm. The `blowfish` algorithm must be supported by the crypt(3) function.

## Rationale

The `SHA-512` algorithm provides a stronger hash than other algorithms used for password hash generation. A stronger hash provides additional protection to the system by increasing the level of effort needed for an attacker to successfully determine local user passwords.

Note: These changes only apply to the local system.

## Audit Procedure

### Command Line

Run the following command to verify that a strong password hashing algorithm is set on the pam_unix.so module:

```bash
# grep -PH -- '^\h*password\h+([^#\n\r]+)\h+pam_unix\.so\h+([^#\n\r]+\h+)?{sha512}\b' /etc/pam.d/common-password
```

## Expected Result

Output should be similar to:

```
/etc/pam.d/common-password:password   [success=1 default=ignore]   pam_unix.so obscure use_authtok try_first_pass yescrypt
```

Verify that the line(s) includes `sha512`.

Note: `yescrypt` will be acceptable - IF - it becomes supported.

## Remediation

### Command Line

Run the following command:

```bash
# awk '/Password-Type:/{ f = 1;next } /-Type:/{ f = 0 } f {if (/pam_unix\.so/) print FILENAME}' /usr/share/pam-configs/*
```

Edit any returned files and edit or add a the strong sha512 hashing algorithm to the `pam_unix` lines in the `Password` section.

Example File:

```
Name: Unix authentication
Default: yes
Priority: 256
Auth-Type: Primary # <- Start of "Auth" section
Auth:
        [success=end default=ignore]    pam_unix.so try_first_pass
Auth-Initial:
        [success=end default=ignore]    pam_unix.so
Account-Type: Primary # <- Start of "Account" section
Account:
        [success=end new_authtok_reqd=done default=ignore]    pam_unix.so
Account-Initial:
        [success=end new_authtok_reqd=done default=ignore]    pam_unix.so
Session-Type: Additional  # <- Start of "Session" section
Session:
        required        pam_unix.so
Session-Initial:
        required        pam_unix.so
Password-Type: Primary # <- Start of "Password" section
Password:
        [success=end default=ignore]    pam_unix.so obscure use_authtok try_first_pass sha512 # <- **ensure hashing algorithm is sha512**
Password-Initial:
        [success=end default=ignore]    pam_unix.so obscure sha512 # <- **ensure hashing algorithm is sha512**
```

Note: `yescrypt` will be acceptable - IF - it becomes supported.

Run the following command to update the files in the `/etc/pam.d/` directory:

```bash
# pam-auth-update --enable <MODIFIED_PROFILE_NAME>
```

Example:

```bash
# pam-auth-update --enable unix
```

## Additional Information

The following command may be used to expire all non-system user ID's immediately and force them to change their passwords on next login. Any system accounts that need to be expired should be carefully done separately by the system administrator to prevent any potential problems.

```bash
# awk -F: '{ $3<'"$(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs)"' && $1 != "nfsnobody" ) { print $1 }' /etc/passwd | xargs -n 1 chage -d 0
```

## References

1. NIST SP 800-53 Rev. 5: IA-5

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 3.11 Encrypt Sensitive Data at Rest | | * | * |
| v7 | 16.4 Encrypt or Hash all Authentication Credentials | | * | * |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|---|---|---|
| T1003, T1003.008, T1110, T1110.002 | TA0006 | M1041 |
