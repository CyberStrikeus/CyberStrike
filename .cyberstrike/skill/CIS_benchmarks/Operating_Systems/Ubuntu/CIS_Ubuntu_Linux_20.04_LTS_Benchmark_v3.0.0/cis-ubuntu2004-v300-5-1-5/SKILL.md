---
name: cis-ubuntu2004-v300-5-1-5
description: "Ensure sshd Banner is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.5"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sshd Banner is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The `Banner` parameter specifies a file whose contents must be sent to the remote user before authentication is permitted. By default, no banner is displayed.

## Rationale

Banners are used to warn connecting users of the particular site's policy regarding connection. Presenting a warning message prior to the normal user login may assist the prosecution of trespassers on the computer system.

## Audit Procedure

### Command Line

Run the following command to verify `Banner` is set:

```bash
# sshd -T | grep -Pi -- '^\h*banner\h+\/\H+'
```

Example:

```
banner /etc/issue.net
```

- IF - `Match` set statements are used in your environment, specify the connection parameters to use for the `-T` extended test mode and run the audit to verify the setting is not incorrectly configured in a match block.
  Example additional audit needed for a match block for the user _sshuser_:

```bash
# sshd -T -C user=sshuser | grep -Pi -- '^\h*banner\h+\/\H+'
```

Run the following command and verify that the contents or the file being called by the `Banner` argument match site policy:

```bash
# [ -e "$(sshd -T | awk '$1 == "banner" {print $2}')" ] && cat "$(sshd -T | awk '$1 == "banner" {print $2}')"
```

Run the following command and verify no results are returned:

```bash
# grep -Psi -- "(\\v|\\r|\\m|\\s)\b$(grep -Pi -- '^ID=' /etc/os-release | cut -d= -f2 | sed -e 's/"//g')\b" "$(sshd -T | awk '$1 == "banner" {print $2}')"
```

## Expected Result

Banner should be set to a valid file path (e.g., `/etc/issue.net`). The banner content should match site policy and not contain `\m`, `\r`, `\s`, `\v` or references to the OS platform.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the `Banner` parameter above any `Include` and `Match` entries as follows:

```
Banner /etc/issue.net
```

Note: First occurrence of a option takes precedence, Match set statements withstanding. If Include locations are enabled, used, and order of precedence is understood in your environment, the entry may be created in a file in Include location.
Edit the file being called by the `Banner` argument with the appropriate contents according to your site policy, remove any instances of `\m`, `\r`, `\s`, `\v` or references to the OS platform.
Example:

```bash
# printf '%s\n' "Authorized users only. All activity may be monitored and reported." > "$(sshd -T | awk '$1 == "banner" {print $2}')"
```

## References

1. NIST SP 800-53 Rev. 5: CM-1, CM-2, CM-6, CM-7, IA-5

## CIS Controls

v8 - 0.0 Explicitly Not Mapped

v7 - 0.0 Explicitly Not Mapped

MITRE ATT&CK Mappings: TA0001, TA0007 | M1035
