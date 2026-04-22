---
name: cis-ubuntu2004-v300-5-1-14
description: "Ensure sshd LogLevel is configured"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, ssh]
cis_id: "5.1.14"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure sshd LogLevel is configured (Automated)

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

SSH provides several logging levels with varying amounts of verbosity. The `DEBUG` options are specifically not recommended other than strictly for debugging SSH communications. These levels provide so much data that it is difficult to identify important security information, and may violate the privacy of users.

## Rationale

The `INFO` level is the basic level that only records login activity of SSH users. In many situations, such as Incident Response, it is important to determine when a particular user was active on a system. The logout record can eliminate those users who disconnected, which helps narrow the field.

The `VERBOSE` level specifies that login and logout activity as well as the key fingerprint for any SSH key used for login will be logged. This information is important for SSH key management, especially in legacy environments.

## Audit Procedure

### Command Line

Run the following command and verify that output matches `loglevel VERBOSE` or `loglevel INFO`:

```bash
# sshd -T | grep loglevel
```

```
loglevel VERBOSE
   - OR -
loglevel INFO
```

- IF - `Match` set statements are used in your environment, specify the connection parameters to use for the `-T` extended test mode and run the audit to verify the setting is not incorrectly configured in a match block.
  Example additional audit needed for a match block for the user _sshuser_:

```bash
# sshd -T -C user=sshuser | grep loglevel
```

Note: If provided, any Match directives in the configuration file that would apply are applied before the configuration is written to standard output. The connection parameters are supplied as keyword=value pairs and may be supplied in any order, either with multiple `-C` options or as a comma-separated list. The keywords are `addr` (source address), `user` (user), `host` (resolved source host name), `laddr` (local address), `lport` (local port number), and `rdomain` (routing domain)

## Expected Result

```
loglevel VERBOSE
```

or

```
loglevel INFO
```

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the `LogLevel` parameter to `VERBOSE` or `INFO` above any `Include` and `Match` entries as follows:

```
LogLevel VERBOSE
   - OR -
LogLevel INFO
```

Note: First occurrence of a option takes precedence, `Match` set statements withstanding. If `Include` locations are enabled, used, and order of precedence is understood in your environment, the entry may be created in a file in `Include` location.

## Default Value

LogLevel INFO

## References

1. https://www.ssh.com/ssh/sshd_config/
2. NIST SP 800-53 Rev. 5: AU-3, AU-12, SI-5

## CIS Controls

v8 - 8.2 Collect Audit Logs
Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.

v7 - 6.2 Activate audit logging
Ensure that local logging has been enabled on all systems and networking devices.

v7 - 6.3 Enable Detailed Logging
Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

MITRE ATT&CK Mappings: T1562, T1562.006 | TA0005
