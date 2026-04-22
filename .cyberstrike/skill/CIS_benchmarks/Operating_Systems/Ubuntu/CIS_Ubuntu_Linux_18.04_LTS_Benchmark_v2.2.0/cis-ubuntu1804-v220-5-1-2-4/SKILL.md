---
name: cis-ubuntu1804-v220-5-1-2-4
description: "Ensure rsyslog default file permissions are configured"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, rsyslog, logging]
cis_id: "5.1.2.4"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.2.4 Ensure rsyslog default file permissions are configured (Automated)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

RSyslog will create logfiles that do not already exist on the system. This setting controls what permissions will be applied to these newly created files.

## Rationale

It is important to ensure that log files have the correct permissions to ensure that sensitive data is archived and protected.

## Impact

The systems global `umask` could override, but only making the file permissions stricter, what is configured in RSyslog with the `FileCreateMode` directive. RSyslog also has it's own `$umask` directive that can alter the intended file creation mode. In addition, consideration should be given to how `FileCreateMode` is used.

Thus it is critical to ensure that the intended file creation mode is not overridden with less restrictive settings in `/etc/rsyslog.conf`, `/etc/rsyslog.d/*conf` files and that `FileCreateMode` is set before any file is created.

## Audit Procedure

### Command Line

Run the following command:

```bash
grep ^\$FileCreateMode /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

Verify the output matches:

```
$FileCreateMode 0640
```

Should a site policy dictate less restrictive permissions, ensure to follow said policy. NOTE: More restrictive permissions such as `0600` is implicitly sufficient.

## Expected Result

The output should show `$FileCreateMode 0640` or more restrictive.

## Remediation

### Command Line

Edit either `/etc/rsyslog.conf` or a dedicated `.conf` file in `/etc/rsyslog.d/` and set `$FileCreateMode` to `0640` or more restrictive:

```
$FileCreateMode 0640
```

Restart the service:

```bash
systemctl restart rsyslog
```

## Default Value

$FileCreateMode 0640

## References

1. See the rsyslog.conf(5) man page for more information.
2. NIST SP 800-53 Rev. 5: AC-3, AC-6, MP-2

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v8               | 3.3 Configure Data Access Control Lists - Configure data access control lists based on a user's need to know. Apply data access control lists, also known as access permissions, to local and remote file systems, databases, and applications. |
| v8               | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.                                                                                 |
| v7               | 5.1 Establish Secure Configurations - Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                         |
| v7               | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices.                                                                                                                                  |
| v7               | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.                                         |
