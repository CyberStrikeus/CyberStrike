---
name: cis-ubuntu1604-v200-1-5-2
description: "Ensure address space layout randomization (ASLR) is enabled"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, aslr, kernel, hardening, exploit-mitigation]
cis_id: "1.5.2"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 1.5.2

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

Address space layout randomization (ASLR) is an exploit mitigation technique which randomly arranges the address space of key data areas of a process.

## Rationale

Randomly placing virtual memory regions will make it difficult to write memory page exploits as the memory placement will be consistently shifting.

## Audit Procedure

### Command Line

Run the following commands and verify output matches:

```bash
sysctl kernel.randomize_va_space
```

Expected output: `kernel.randomize_va_space = 2`

```bash
grep -Es "^\s*kernel\.randomize_va_space\s*=\s*([0-1]|[3-9]|[1-9][0-9]+)" /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /usr/local/lib/sysctl.d/*.conf /run/sysctl.d/*.conf
```

Nothing should be returned.

## Expected Result

`kernel.randomize_va_space` should be set to `2`. No overriding configurations should exist in sysctl configuration files.

## Remediation

### Command Line

Set the following parameter in `/etc/sysctl.conf` or a `/etc/sysctl.d/*` file ending in `.conf`:

```
kernel.randomize_va_space = 2
```

Run the following script to comment out entries that override the default setting of kernel.randomize_va_space:

```bash
#!/usr/bin/bash

for file in /etc/sysctl.conf /etc/sysctl.d/*.conf /usr/lib/sysctl.d/*.conf /usr/local/lib/sysctl.d/*.conf /run/sysctl.d/*.conf; do
   if [ -f "$file" ]; then
      grep -Esq "^\s*kernel\.randomize_va_space\s*=\s*([0-1]|[3-9]|[1-9][0-9]+)" "$file" && sed -ri 's/^\s*kernel\.randomize_va_space\s*=\s*([0-1]|[3-9]|[1-9][0-9]+)/# &/gi' "$file"
   fi
done
```

Run the following command to set the active kernel parameter:

```bash
sysctl -w kernel.randomize_va_space=2
```

## Additional Information

Configuration files are read from directories in `/etc/`, `/run/`, `/usr/local/lib/`, and `/lib/`, in order of precedence. Files must have the ".conf" extension. Files in `/etc/` override files with the same name in `/run/`, `/usr/local/lib/`, and `/lib/`. Files in `/run/` override files with the same name under `/usr/`.

## Default Value

kernel.randomize_va_space = 2

## References

1. http://manpages.ubuntu.com/manpages/focal/man5/sysctl.d.5.html

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v7 | 8.3 Enable Operating System Anti-Exploitation Features/ Deploy Anti-Exploit Technologies |

## Assessment Status

Automated
