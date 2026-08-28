---
name: cis-ubuntu1604-v200-6-1-1
description: "Audit system file permissions"
category: cis-storage
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, file-permissions, maintenance]
cis_id: "6.1.1"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - 6.1.1

## Profile Applicability

- Level 2 - Server
- Level 2 - Workstation

## Description

The Debian package manager has a number of useful options. One of these, the `--verify` option, can be used to verify that system packages are correctly installed. The `--verify` option can be used to verify a particular package or to verify all system packages. If no output is returned, the package is installed correctly. The following table describes the meaning of output from the verify option:

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| S    | File size differs.                                           |
| M    | File mode differs (includes permissions and file type).      |
| 5    | The MD5 checksum differs.                                    |
| D    | The major and minor version numbers differ on a device file. |
| L    | A mismatch occurs in a link.                                 |
| U    | The file ownership differs.                                  |
| G    | The file group owner differs.                                |
| T    | The file time (mtime) differs.                               |

The `dpkg -S` command can be used to determine which package a particular file belongs to. For example the following command determines which package the `/bin/bash` file belongs to:

```bash
# dpkg -S /bin/bash
bash: /bin/bash
```

To verify the settings for the package that controls the `/bin/bash` file, run the following:

```bash
# dpkg --verify bash
??5?????? c /etc/bash.bashrc
```

**Notes:**

- Since packages and important files may change with new updates and releases, it is recommended to verify everything, not just a finite list of files. This can be a time consuming task and results may depend on site policy therefore it is not a assessed benchmark item, but is provided for those interested in additional security measures.
- Some of the recommendations of this benchmark alter the state of files audited by this recommendation. The audit command will alert for all changes to a file permissions even if the new state is more secure than the default.

## Rationale

It is important to confirm that packaged system files and directories are maintained with the permissions they were intended to have from the OS vendor.

## Audit Procedure

### Command Line

Run the following command to review all installed packages. Note that this may be very time consuming and may be best scheduled via the `cron` utility. It is recommended that the output of this command be redirected to a file that can be reviewed later.

```bash
dpkg --verify <package name>
```

## Expected Result

No output should be returned if the package is installed correctly.

## Remediation

### Command Line

Correct any discrepancies found and rerun the audit until output is clean or risk is mitigated or accepted.

## Default Value

Not applicable.

## References

1. CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v7               | 14.6 Protect Information through Access Control Lists<br>Protect all information stored on systems with file system, network share, claims, application, or database specific access control lists. These controls will enforce the principle that only authorized individuals should have access to the information based on their need to access the information as a part of their responsibilities. |

## Assessment Status

Manual
