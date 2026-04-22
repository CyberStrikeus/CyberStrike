---
name: cis-ubuntu1804-v220-5-1-1-7
description: "Ensure journald default file permissions configured"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, journald, logging]
cis_id: "5.1.1.7"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.7 Ensure journald default file permissions configured (Manual)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

Journald will create logfiles that do not already exist on the system. This setting controls what permissions will be applied to these newly created files.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Audit Procedure

### Command Line

First see if there is an override file `/etc/tmpfiles.d/systemd.conf`. If so, this file will override all default settings as defined in `/usr/lib/tmpfiles.d/systemd.conf` and should be inspected.

If there is no override file, inspect the default `/usr/lib/tmpfiles.d/systemd.conf` against the site specific requirements.

Ensure that file permissions are `0640`. Should a site policy dictate less restrictive permissions, ensure to follow said policy. NOTE: More restrictive permissions such as `0600` is implicitly sufficient.

## Expected Result

File permissions should be `0640` or more restrictive.

## Remediation

### Command Line

If the default configuration is not appropriate for the site specific requirements, copy `/usr/lib/tmpfiles.d/systemd.conf` to `/etc/tmpfiles.d/systemd.conf` and modify as required. Requirements is either `0640` or site policy if that is less restrictive.

## Default Value

0640

## References

1. NIST SP 800-53 Rev. 5: AC-3, AU-2, AU-12, MP-2, SI-5

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. |
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. |
| v7 | 5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
