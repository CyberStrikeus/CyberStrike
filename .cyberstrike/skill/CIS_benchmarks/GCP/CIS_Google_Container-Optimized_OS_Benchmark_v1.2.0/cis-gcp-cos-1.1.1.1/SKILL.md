---
name: cis-gcp-cos-1.1.1.1
description: "Ensure mounting of udf filesystems is disabled"
category: cis-gcp-cos
version: "1.2.0"
author: cyberstrike-official
tags: [cis, gcp, container-optimized-os, filesystem, partitions, mount-options]
cis_id: "1.1.1.1"
cis_benchmark: "CIS Google Container-Optimized OS Benchmark v1.2.0"
tech_stack: [gcp, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1.1.1 Ensure mounting of udf filesystems is disabled (Automated)

## Description

The `udf` filesystem type is the universal disk format used to implement ISO/IEC 13346 and ECMA-167 specifications. This is an open vendor filesystem type for data storage on a broad range of media. This filesystem type is necessary to support writing DVDs and newer optical disc formats.

## Rationale

Removing support for unneeded filesystem types reduces the local attack surface of the system. If this filesystem type is not needed, disable it.

## Audit Procedure

Run the following commands and verify the output is as indicated:

```bash
# modprobe -n -v udf
install /bin/true
# lsmod | grep udf
<No output>
```

## Expected Result

- `modprobe -n -v udf` should return `install /bin/true`
- `lsmod | grep udf` should return no output

## Remediation

Edit or create a file in the `/etc/modprobe.d/` directory ending in `.conf`.
Example: `vim /etc/modprobe.d/udf.conf`
and add the following line:

```
install udf /bin/true
```

Run the following command to unload the `udf` module:

```bash
# rmmod udf
```

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|---|---|---|---|---|
| v8 | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function. | | x | x |
| v8 | 5.5 Establish and Maintain an Inventory of Service Accounts - Establish and maintain an inventory of service accounts. The inventory, at a minimum, must contain department owner, review date, and purpose. Perform service account reviews to validate that all active accounts are authorized, on a recurring schedule at a minimum quarterly, or more frequently. | | x | x |
| v7 | 3.3 Protect Dedicated Assessment Accounts - Use a dedicated account for authenticated vulnerability scans, which should not be used for any other administrative activities and should be tied to specific machines at specific IP addresses. | | x | x |

## Profile

Level 2 - Server | Automated
