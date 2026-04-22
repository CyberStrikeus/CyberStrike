---
name: "CIS Ubuntu 14.04 LTS - 6.1.1 Audit system file permissions"
description: "Audit system file permissions using dpkg --verify to detect unauthorized changes"
category: "cis-os-hardening"
version: "2.1.0"
author: "cyberstrike-official"
tags:
  - cis
  - ubuntu
  - ubuntu-14.04
  - level-2
  - not-scored
  - file-permissions
cis_id: "6.1.1"
cis_benchmark: "CIS Ubuntu Linux 14.04 LTS Benchmark v2.1.0"
tech_stack:
  - ubuntu
  - linux
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: "low"
---

# 6.1.1 Audit system file permissions (Not Scored)

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

The `dpkg -S` command can be used to determine which package a particular file belongs to. For example the following commands determines which package the `/bin/bash` file belongs to:

```bash
# dpkg -S /bin/bash
bash: /bin/bash
```

To verify the settings for the package that controls the `/bin/bash` file, run the following:

```bash
# dpkg --verify bash
??5?????? c /etc/bash.bashrc
```

## Rationale

It is important to confirm that packaged system files and directories are maintained with the permissions they were intended to have from the OS vendor.

## Audit Procedure

Run the following to review all installed packages. Note that this may be very time consuming and may be best scheduled via the `cron` utility. It is recommended that the output of this command be redirected to a file that can be reviewed later.

```bash
dpkg --verify > <filename>
```

## Expected Result

Review the output file for any discrepancies. No unexpected permission changes should be present.

## Remediation

Correct any discrepancies found and rerun the audit until output is clean or risk is mitigated or accepted.

## Default Value

Permissions are set by the package maintainer.

## References

1. http://docs.fedoraproject.org/en-US/Fedora_Draft_Documentation/0.1/html/RPM_Guide/index.html

## Notes

Since packages and important files may change with new updates and releases, it is recommended to verify everything, not just a finite list of files. This can be a time consuming task and results may depend on site policy therefore it is not a scorable benchmark item, but is provided for those interested in additional security measures.

Some of the recommendations of this benchmark alter the state of files audited by this recommendation. The audit command will alert for all changes to a file permissions even if the new state is more secure than the default.

## CIS Controls

14.4 Protect Information With Access Control Lists - All information stored on systems shall be protected with file system, network share, claims, application, or database specific access control lists.

## Profile

- Level 2
