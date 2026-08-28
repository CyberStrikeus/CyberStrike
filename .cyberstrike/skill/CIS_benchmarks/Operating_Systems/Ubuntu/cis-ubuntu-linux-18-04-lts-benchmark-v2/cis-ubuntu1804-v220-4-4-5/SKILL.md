---
name: cis-ubuntu1804-v220-4-4-5
description: "Ensure all current passwords uses the configured hashing algorithm"
category: cis-iam
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, pam, authentication]
cis_id: "4.4.5"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.4.5

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

All accounts should use the configured password hashing algorithm. With PAM this is typically yescrypt or sha512.

## Rationale

If accounts are still using older or weaker hashing algorithms after changing the system default, those password hashes remain more vulnerable to brute-force attacks.

## Audit Procedure

### Command Line

Run the following script to verify all current passwords use the configured hashing algorithm:

```bash
#!/usr/bin/env bash
{
  l_hashing_algorithm="$(grep -Pi '^\h*ENCRYPT_METHOD\h+(SHA512|yescrypt)\b' /etc/login.defs | awk '{print $2}' | tr '[:upper:]' '[:lower:]')"
  case "$l_hashing_algorithm" in
    yescrypt) l_hash_value='\$y\$' ;;
    sha512) l_hash_value='\$6\$' ;;
    *) echo "ERROR: ENCRYPT_METHOD not set to SHA512 or yescrypt"; exit 1 ;;
  esac
  l_output=""
  while IFS= read -r l_user; do
    l_hash="$(awk -F: -v user="$l_user" '($1 == user){print $2}' /etc/shadow)"
    if ! grep -Pq "$l_hash_value" <<< "$l_hash"; then
      l_output="$l_output\n - User: $l_user is not using $l_hashing_algorithm hashing"
    fi
  done < <(awk -F: '($2 ~ /^\$.+\$/){print $1}' /etc/shadow)
  if [ -z "$l_output" ]; then
    echo -e "\n- Audit Result:\n  ** PASS **\n - All users are using $l_hashing_algorithm"
  else
    echo -e "\n- Audit Result:\n  ** FAIL **\n - Reasons for audit failure:$l_output"
  fi
}
```

### Expected Result

```
** PASS ** - All users are using the configured hashing algorithm
```

## Remediation

### Command Line

Set all users' passwords to use the configured hashing algorithm. Lock non-compliant accounts and force password changes:

```bash
passwd -e <user>
```

This will force the user to change their password on next login, which will use the new hashing algorithm.

## References

1. NIST SP 800-53 Rev. 5: IA-5(1)

## CIS Controls

v8 - 3.11 Encrypt Sensitive Data at Rest.

v7 - 16.4 Encrypt or Hash All Authentication Credentials.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Manual
