---
name: cis-ubuntu1604-v200-5-4-1
description: "Ensure password creation requirements are configured"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.4.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure password creation requirements are configured

**Profile Applicability:**

- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The `pam_pwquality.so` module checks the strength of passwords. It performs checks such as making sure a password is not a dictionary word, it is a certain length, contains a mix of characters (e.g. alphabet, numeric, other) and more. The following are definitions of the `pam_pwquality.so` options.

The following options are set in the `/etc/security/pwquality.conf` file:

- **Password Length:**
  - `minlen = 14` - password must be 14 characters or more
- **Password complexity:**
  - `minclass = 4` - The minimum number of required classes of characters for the new password (digits, uppercase, lowercase, others)

  _OR_
  - `dcredit = -1` - provide at least one digit
  - `ucredit = -1` - provide at least one uppercase character
  - `ocredit = -1` - provide at least one special character
  - `lcredit = -1` - provide at least one lowercase character

The following is set in the `/etc/pam.d/common-password` file:

- `retry=3` - Allow 3 tries before sending back a failure. The settings shown above are one possible policy. Alter these values to conform to your own organization's password policies.

## Rationale

Strong passwords protect systems from being hacked through brute force methods.

## Audit Procedure

### Command Line

Verify password creation requirements conform to organization policy. Run the following command to verify the minimum password length is 14 or more characters:

```bash
grep '^\s*minlen\s*' /etc/security/pwquality.conf
```

**Expected output:**

```
minlen = 14
```

Run one of the following commands to verify the required password complexity:

```bash
grep '^\s*minclass\s*' /etc/security/pwquality.conf
```

**Expected output:**

```
minclass = 4
```

_OR_

```bash
grep -E '^\s*[duol]credit\s*' /etc/security/pwquality.conf
```

**Expected output:**

```
dcredit = -1
ucredit = -1
lcredit = -1
ocredit = -1
```

Run the following command to verify the number of attempts allowed before sending back a failure are no more than 3:

```bash
grep -E '^\s*password\s+(requisite|required)\s+pam_pwquality\.so\s+(\S+\s+)*retry=[1-3]\s*(\s+\S+\s*)*(\s+#.*)?$' /etc/pam.d/common-password
```

**Expected output:**

```
password        requisite                       pam_pwquality.so retry=3
```

## Remediation

### Command Line

Run the following command to install the pam_pwquality module:

```bash
apt install libpam-pwquality
```

Edit the file `/etc/security/pwquality.conf` and add or modify the following line for password length to conform to site policy:

```
minlen = 14
```

Edit the file `/etc/security/pwquality.conf` and add or modify the following line for password complexity to conform to site policy:

```
minclass = 4
```

_OR_

```
dcredit = -1
ucredit = -1
ocredit = -1
lcredit = -1
```

Edit the `/etc/pam.d/common-password` file to include the appropriate options for `pam_pwquality.so` and to conform to site policy:

```
password requisite pam_pwquality.so retry=3
```

## Additional Information

Additional module options may be set, recommendation requirements only cover including `try_first_pass` and `minlen` set to 14 or more.

Settings in `/etc/security/pwquality.conf` must use spaces around the `=` symbol.

## References

None

## CIS Controls

| Controls Version | Control                                                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 4.4 Use Unique Passwords - Where multi-factor authentication is not supported (such as local administrator, root, or service accounts), accounts will use passwords that are unique to that system. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
