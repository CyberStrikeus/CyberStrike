---
name: cis-gcp-cos-5.2.1
description: "Ensure password creation requirements are configured"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, pam, password-policy, password-complexity]
cis_id: "5.2.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.2.1 Ensure password creation requirements are configured (Automated)

## Description

The `pam_passwdqc.so` module checks the strength of passwords. It performs checks such as making sure a password is not a dictionary word, it is a certain length, contains a mix of characters (e.g. alphabet, numeric, other) and more based on the following options set in the `/etc/security/passwdqc.conf`:

- `min=disabled,disabled,disabled,disabled,14` - The password must be 14 characters or more and consists of four character classes.
- `max=40` - The maximum allowed password length is 40.
- `passphrase=3` - The number of words required for a passphrase is at least 3.
- `match=4` - The length of common substring required to conclude that a password is at least partially based on information found in a character string is 4.
- `similar=deny` - The password that is similar to the old one is going to be denied.
- `random=47` - The size of randomly-generated passphrases in bits is 47.
- `enforce=everyone` - Warn everyone for weak passwords.
- `retry=3` - Let the user provide a password 3 times if the user fails to provide a sufficiently strong password and enter it twice the first time.

For more details, refer to pam_passwdqc module documentation. The settings shown above are one possible policy. Alter these values to conform to your own organization's password policies.

## Rationale

Strong passwords protect systems from being hacked through brute force methods.

## Audit Procedure

Verify password creation requirements conform to organization policy in `/etc/security/passwdqc.conf` with the following command.

```bash
# cat /etc/security/passwdqc.conf

min=disabled,disabled,disabled,disabled,14
max=40
passphrase=3
match=4
similar=deny
random=47
enforce=everyone
retry=3
```

Run the following command and verify that the output is similar to:

```bash
grep  pam_passwdqc.so /etc/pam.d/system-auth
password       required       pam_passwdqc.so config=/etc/security/passwdqc.conf
```

## Expected Result

The `/etc/security/passwdqc.conf` file should contain password complexity settings conforming to site policy. The `pam_passwdqc.so` module should be configured in `/etc/pam.d/system-auth`.

## Remediation

Edit the file `/etc/security/passwdqc.conf` and add or modify the following lines for password length and complexity to conform to site policy:

```
min=disabled,disabled,disabled,disabled,14
max=40
passphrase=3
match=4
similar=deny
random=47
enforce=everyone
retry=3
```

Edit the `/etc/pam.d/system-auth` files to include the appropriate options for pam_passwdqc.so and to conform to site policy:

```
password       required       pam_passwdqc.so config=/etc/security/passwdqc.conf
```

Additional Information:

Consult your documentation for the appropriate PAM file and module.

Additional module options may be set, recommendation requirements only cover including `try_first_pass` and `minlen` set to 14 or more.

Settings in `/etc/security/pwquality.conf` must use spaces around the `=` symbol.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | **5.2 Use Unique Passwords** - Use unique passwords for all enterprise assets. Best practice implementation includes, at a minimum, an 8-character password for accounts using MFA and a 14-character password for accounts not using MFA. | x | x | x |
| v7 | **4.4 Use Unique Passwords** - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. | | x | x |

## Profile

- Level 2 - Server
