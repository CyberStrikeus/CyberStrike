---
name: cis-ubuntu2004-v300-3-2-3
description: "Ensure rds kernel module is not available"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, kernel-module]
cis_id: "3.2.3"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.2.3 Ensure rds kernel module is not available (Automated)

## Profile

- Level 2 - Server
- Level 2 - Workstation

## Description

The Reliable Datagram Sockets (RDS) protocol is a transport layer protocol designed to provide low-latency, high-bandwidth communications between cluster nodes. It was developed by the Oracle Corporation.

## Rationale

- IF - the protocol is not required, it is recommended that the drivers not be installed to reduce the potential attack surface.

## Impact

None expected if the RDS protocol is not in use.

## Audit Procedure

### Command Line

Verify the rds kernel module is not available on the system or has been disabled. This can be verified by performing the following or by running the audit script included below.

Run the following script to determine if the rds kernel module is available on the system:

```bash
#!/usr/bin/env bash

{
  l_mod_name="rds" l_mod_type="net"
  while IFS= read -r l_mod_path; do
      if [ -d "$l_mod_path/${l_mod_name//\-/\/}" ] && [ -n "$(ls -A "$l_mod_path/${l_mod_name//\-/\/}")" ]; then
          printf '%s\n' "$l_mod_name exists in $l_mod_path"
      fi
  done < <(readlink -f /usr/lib/modules/**/kernel/$l_mod_type || readlink -f
/lib/modules/**/kernel/$l_mod_type)
}
```

If nothing is returned, the rds kernel module is not available on the system and no further audit steps are required.
Note: Some systems may include the rds filesystem as part of the kernel opposed to being available as a kernel module. In this case, the above audit will not return anything. This is also considered a passing state.

If anything is returned, verify the rds kernel module is not loaded and not loadable by performing the following:

Run the following command to verify the rds kernel module is not loaded:

```bash
# lsmod | grep 'rds'
```

Nothing should be returned.

Run the following command to verify the rds kernel module is not loadable:

```bash
# modprobe --showconfig | grep -P -- '\b(install|blacklist)\h+rds\b'
```

Verify the output includes:

```
blacklist rds
 -AND-
install rds /bin/false
 -OR-
install rds /bin/true
```

## Expected Result

The rds kernel module should not be available, or if present, it should be blacklisted and set to install /bin/false or /bin/true, and not currently loaded.

## Remediation

### Command Line

Run the following to unload and disable the rds kernel module. This can also be done by running the script included below.

Run the following commands to unload the rds kernel module:

```bash
# modprobe -r rds 2>/dev/null
# rmmod rds 2>/dev/null
```

Perform the following to disable the rds kernel module:
Create a file ending in `.conf` with `install rds /bin/false` in the `/etc/modprobe.d/` directory.
Example:

```bash
# printf '\n%s\n' "install rds /bin/false" >> rds.conf
```

Create a file ending in `.conf` with `blacklist rds` in the `/etc/modprobe.d/` directory.
Example:

```bash
# printf '\n%s\n' "blacklist rds" >> rds.conf
```

## Default Value

rds kernel module is available but not loaded by default.

## References

1. NIST SP 800-53 Rev. 5: SI-4, CM-7

## CIS Controls

| Controls Version | Control                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software |      | x    | x    |
| v7               | 9.2 Ensure Only Approved Ports, Protocols and Services Are Running              |      | x    | x    |
