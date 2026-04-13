---
name: cis-gcp-cos-1.2.1
description: "Ensure dm-verity is enabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, dm-verity, integrity, filesystem]
cis_id: "1.2.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.2.1 Ensure dm-verity is enabled (Automated)

## Description

device-mapper-verity (dm-verity) kernel feature provides transparent integrity checking of block devices using a cryptographic digest provided by the kernel crypto API. When a dm-verity device is configured, it is expected that the caller has been authenticated in some way (cryptographic signatures, etc). After instantiation, all hashes will be verified on-demand during disk access. If they cannot be verified up to the root node of the tree, the root hash, then the I/O will fail. This should detect tampering with any data on the device and the hash data.

## Rationale

The Container-Optimized OS root filesystem is always mounted as read-only. Additionally, its checksum is computed at build time and verified by the kernel on each boot. This mechanism prevents against attackers from "owning" the machine through permanent local changes.

## Audit Procedure

Verify dm-verity is enabled in kernel config with the following command:

```bash
# zcat /proc/config.gz | grep CONFIG_DM_VERITY
CONFIG_DM_VERITY=y
```

## Expected Result

The output should show `CONFIG_DM_VERITY=y`.

## Remediation

An OS image update that has the dm-verity enabled kernel is required.

## References

1. AIDE stable manual: http://aide.sourceforge.net/stable/manual.html

## Additional Information

The prelinking feature can interfere with AIDE because it alters binaries to speed up their start up times. Run `prelink -ua` to restore the binaries to their prelinked state, thus avoiding false positives from AIDE.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|------------------|---------|------|------|------|
| v8 | 3.14 Log Sensitive Data Access | | | x |
| v8 | 8.5 Collect Detailed Audit Logs | | x | x |
| v7 | 14.9 Enforce Detail Logging for Access or Changes to Sensitive Data | | | x |

## Profile

Level 1 - Server | Automated
