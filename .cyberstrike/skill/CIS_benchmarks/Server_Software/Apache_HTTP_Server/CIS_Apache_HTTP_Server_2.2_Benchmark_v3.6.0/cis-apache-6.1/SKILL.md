---
name: cis-apache-6.1
description: "Ensure the Error Log Filename and Severity Level Are Configured Correctly"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring]
cis_id: "6.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Error Log Filename and Severity Level Are Configured Correctly

## Description

The `LogLevel` directive is used to configure the severity level for the error logs, while the `ErrorLog` directive configures the log file name. The log level values are the standard syslog levels of `emerg`, `alert`, `crit`, `error`, `warn`, `notice`, `info` and `debug`. The recommended level is `notice`, so that all errors from the `emerg` level through the `notice` level will be logged.

## Rationale

The server error logs are invaluable because they can be used to spot potential problems before they become serious. Most importantly, they can be used to watch for anomalous behavior such as numerous "not found" or "unauthorized" errors that may be an indication an attack is pending or has occurred.

## IMPORTANT NOTE

The Apache httpd server stopped including `404 not found` errors in its error log several years ago. Not including the 404 errors may cause log monitoring and host intrusion detection and prevention software to miss web scanning attacks which cause a large number of `not found` errors, and may fail to block the attack. For Apache 2.4 benchmark we have recommended using "`notice core:info`" in order to pick up the 404 errors. However, in Apache 2.2, the `LogLevel` directive doesn't support multiple levels. So the same recommended solution is not available. There are three alternatives to consider:

1. Set the `LogLevel` to info – However this may create excessive logs, especially for TLS connections. The excessive logs may overwhelm the log monitoring processes.

2. Adapt the log monitoring and IDS to monitor the access logs. Which are much more frequent and may also overwhelm the log monitoring system.

3. Upgrade to Apache 2.4.

For historical context:

- A useful discussion which includes a justification by the bug fix author for the not found log level change. https://stackoverflow.com/questions/36568205/404-error-doesnt-appear-in-apache-error-log
- The Apache "bug fix" that caused the change in logging 404 not found errors is available at https://bz.apache.org/bugzilla/show_bug.cgi?id=35768

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Verify the `LogLevel` in the Apache server configuration has a value of `notice` or lower. Note that it is also compliant to have a value of `info` or `debug` if there is a need for a more verbose log and storage and monitoring processes are capable of handling the extra load. The recommended value is `notice`.
2. Verify the `ErrorLog` directive is configured to an appropriate log file or syslog facility.
3. Verify there is a similar `ErrorLog` directive for each virtual host configured if the virtual host will have different people responsible for the web site.

## Remediation

Perform the following to implement the recommended state:

1. Add or modify the `LogLevel` in the Apache configuration to have a value of `notice` or lower. Note that is it is compliant to have a value of `info` or `debug` if there is a need for a more verbose log and the storage and monitoring processes are capable of handling the extra load. The recommended value is `notice`.

```
LogLevel notice
```

2. Add an `ErrorLog` directive if not already configured. The file path may be relative or absolute, or the logs may be configured to be sent to a syslog server.

```
ErrorLog "logs/error_log"
```

3. Add a similar `ErrorLog` directive for each virtual host configured if the virtual host will have different people responsible for the web site. Each responsible individual or organization needs access to their own web logs.

## Default Value

The following is the default configuration:

```
LogLevel warn
ErrorLog "logs/error_log"
```

## References

1. https://httpd.apache.org/docs/2.2/logs.html
2. https://httpd.apache.org/docs/2.2/mod/core.html#loglevel
3. https://httpd.apache.org/docs/2.2/mod/core.html#errorlog

## CIS Controls

**Version 6**

6.2 Ensure Audit Log Settings Support Appropriate Log Entry Formatting
Validate audit log settings for each hardware device and the software installed on it, ensuring that logs include a date, timestamp, source addresses, destination addresses, and various other useful elements of each packet and/or transaction. Systems should record logs in a standardized format such as syslog entries or those outlined by the Common Event Expression initiative. If systems cannot generate logs in a standardized format, log normalization tools can be deployed to convert logs into such a format.

**Version 7**

6.2 Activate audit logging
Ensure that local logging has been enabled on all systems and networking devices.

6.3 Enable Detailed Logging
Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

## Profile

Level 1 | Scored
Level 2 | Scored
