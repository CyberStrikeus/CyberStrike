---
name: cis-ubuntu2004-v300-1-2-1-1
description: "Ensure GPG keys are configured"
category: cis-storage
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, package-management, gpg, integrity]
cis_id: "1.2.1.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.1.1 Ensure GPG keys are configured (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Most package managers implement GPG key signing to verify package integrity during installation.

## Rationale

It is important to ensure that updates are obtained from a valid source to protect against spoofing that could lead to the inadvertent installation of malware on the system.

## Audit Procedure

### Command Line

Verify GPG keys are configured correctly for your package manager:

```bash
# apt-key list
```

Note:

- `apt-key list` is deprecated. Manage keyring files in `trusted.gpg.d` instead (see apt-key(8)).
- With the deprecation of `apt-key` it is recommended to use the `Signed-By` option in `sources.list` to require a repository to pass apt-secure(8) verification with a certain set of keys rather than all trusted keys apt has configured.

- OR -

1. Run the following script and verify GPG keys are configured correctly for your package manager:

```bash
#!/usr/bin/env bash

{
   for file in /etc/apt/trusted.gpg.d/*.{gpg,asc} /etc/apt/sources.list.d/*.{gpg,asc} ; do
      if [ -f "$file" ]; then
         echo -e "File: $file"
         gpg --list-packets "$file" 2>/dev/null | awk '/keyid/ && !seen[$NF]++ {print "keyid:", $NF}'
         gpg --list-packets "$file" 2>/dev/null | awk '/Signed-By:/ {print "signed-by:", $NF}'
         echo -e
      fi
   done
}
```

2. REVIEW and VERIFY to ensure that GPG keys are configured correctly for your package manager IAW site policy.

## Expected Result

GPG keys should be configured and verified according to site policy.

## Remediation

### Command Line

Update your package manager GPG keys in accordance with site policy.

## References

1. NIST SP 800-53 Rev. 5: SI-2
2. https://manpages.debian.org/stretch/apt/sources.list.5.en.html

## CIS Controls

| Controls Version | Control                                                      | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------ | ---- | ---- | ---- |
| v8               | 7.3 Perform Automated Operating System Patch Management      | \*   | \*   | \*   |
| v8               | 7.4 Perform Automated Application Patch Management           | \*   | \*   | \*   |
| v7               | 3.4 Deploy Automated Operating System Patch Management Tools | \*   | \*   | \*   |
| v7               | 3.5 Deploy Automated Software Patch Management Tools         | \*   | \*   | \*   |

MITRE ATT&CK Mappings: T1195, T1195.001, T1195.002 | TA0001 | M1051
