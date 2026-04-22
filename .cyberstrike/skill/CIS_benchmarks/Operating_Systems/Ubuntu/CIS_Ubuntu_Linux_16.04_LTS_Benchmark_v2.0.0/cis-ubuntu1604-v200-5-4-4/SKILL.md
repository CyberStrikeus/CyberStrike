---
name: cis-ubuntu1604-v200-5-4-4
description: "Ensure password hashing algorithm is SHA-512"
category: cis-iam
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, authentication, pam]
cis_id: "5.4.4"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure password hashing algorithm is SHA-512

**Profile Applicability:**
- Level 1 - Server
- Level 1 - Workstation

**Assessment Status:** Automated

## Description

The commands below change password encryption from `md5` to `sha512` (a much stronger hashing algorithm). All existing accounts will need to perform a password change to upgrade the stored hashes to the new algorithm.

## Rationale

The SHA-512 algorithm provides much stronger hashing than MD5, thus providing additional protection to the system by increasing the level of effort for an attacker to successfully determine passwords.

Note that these change only apply to accounts configured on the local system.

## Audit Procedure

### Command Line

Run the following commands and ensure the `sha512` option is included in all results:

```bash
grep -E '^\s*password\s+(\[success=1\s+default=ignore\]|required)\s+pam_unix\.so\s+([^#]+\s+)?sha512\b' /etc/pam.d/common-password
```

**Expected output (similar to):**

```
password        [success=1 default=ignore]      pam_unix.so obscure sha512
```

## Remediation

### Command Line

Edit the `/etc/pam.d/common-password` file to include the `sha512` option for `pam_unix.so` as shown:

```
password [success=1 default=ignore] pam_unix.so sha512
```

## Additional Information

Additional module options may be set, recommendation only covers those listed here.

If it is determined that the password algorithm being used is not SHA-512, once it is changed, it is recommended that all user ID's be immediately expired and forced to change their passwords on next login.

The following command can be used:

```bash
awk -F: '( $3 >= $(awk '/^\s*UID_MIN/{print $2}' /etc/login.defs) && $1 != "nfsnobody" ) { print $1 }' /etc/passwd | xargs -n 1 chage -d 0
```

Any system accounts that need to be expired should be carefully done separately by the system administrator to prevent any potential problems.

## References

None

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 16.4 Encrypt or Hash all Authentication Credentials - Encrypt or hash with a salt all authentication credentials when stored. |

## Profile

- **Level 1 - Server**
- **Level 1 - Workstation**
