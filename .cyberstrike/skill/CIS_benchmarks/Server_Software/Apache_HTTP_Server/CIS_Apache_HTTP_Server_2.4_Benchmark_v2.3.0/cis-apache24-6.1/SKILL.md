---
name: cis-apache24-6.1
description: "Ensure the Error Log Filename and Severity Level Are Configured Correctly"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring, maintenance]
cis_id: "6.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Error Log Filename and Severity Level Are Configured Correctly (Automated)

## Profile Applicability

Level 1

## Description

The `LogLevel` directive is used to configure the severity level for the error logs. While the `ErrorLog` directive configures the file name. The log level values are the standard syslog levels of `emerg`, `alert`, `crit`, `error`, `warn`, `notice`, `info` and `debug`. The recommended level is `notice` for most modules, so that all errors from the `emerg` level through `notice` level will be logged. The recommended setting for the `core` module is `info` so that any `not found` requests will be included in the error logs.

## Rationale

The server error logs are invaluable because they can also be used to spot any potential problems before they occur. Most importantly, they can be used to watch for anomalous behavior such as a lot of `not found` or `unauthorized` errors may be an indication that an attack is pending or has occurred. Starting with Apache 2.4 the error log does not include the `not found` errors except at the `info` logging level. Therefore, it is important that the log level be set to `info` for the `core` module. The `not found` requests need to be included in the error log for both forensics' investigation and host intrusion detection purposes. Monitoring the access logs may not be practical for many web servers with high volume traffic.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Verify the `LogLevel` in the Apache server configuration has a value of `info` or lower for the core module and `notice` or lower for other modules. Note that it is also compliant to have a value of `info` or `debug` if there is a need for a more verbose log and the storage and monitoring processes are capable of handling the extra load. The recommended value is `notice core:info`.

2. Verify the `ErrorLog` directive is configured to an appropriate log file or syslog facility.

3. Verify there is a similar `ErrorLog` directive for each virtual host configured if the virtual host will have different people responsible for the web site.

## Remediation

Perform the following to implement the recommended state:

1. Add or modify the `LogLevel` in the Apache configuration to have a value of `info` or lower for the core module and `notice` or lower for all other modules. Note that is it is compliant to have a value of `info` or `debug` if there is a need for a more verbose log and the storage and monitoring processes are capable of handling the extra load. The recommended value is `notice core:info`.
   ```
   LogLevel notice core:info
   ```

2. Add an `ErrorLog` directive if not already configured. The file path may be relative or absolute, or the logs may be configured to be sent to a syslog server.
   ```
   ErrorLog "logs/error_log"
   ```

3. Add a similar `ErrorLog` directive for each virtual host configured if the virtual host will have different people responsible for the web site. Each responsible individual or organization needs access to their own web logs and needs the skills/training/tools for monitoring the logs.

## Default Value

The following is the default configuration:

```
LogLevel warn
ErrorLog "logs/error_log"
```

## References

1. https://httpd.apache.org/docs/2.4/logs.html
2. https://httpd.apache.org/docs/2.4/mod/core.html#loglevel
3. https://httpd.apache.org/docs/2.4/mod/core.html#errorlog

## CIS Controls

**v8:**
- 8.2 Collect Audit Logs
  - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets.

**v7:**
- 6.2 Activate audit logging
  - Ensure that local logging has been enabled on all systems and networking devices.

- 6.3 Enable Detailed Logging
  - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.
