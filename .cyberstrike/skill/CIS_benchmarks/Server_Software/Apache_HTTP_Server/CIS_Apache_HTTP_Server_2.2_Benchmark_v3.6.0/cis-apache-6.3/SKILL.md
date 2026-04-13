---
name: cis-apache-6.3
description: "Ensure the Server Access Log Is Configured Correctly"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring]
cis_id: "6.3"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Server Access Log Is Configured Correctly

## Description

The `LogFormat` directive defines the format and information to be included in the server access log entries. The `CustomLog` directive specifies the log file, syslog facility, or piped logging utility.

## Rationale

The server access logs are invaluable for a variety of reasons. They can be used to determine what resources are being used most. Most importantly, they can be used to investigate anomalous behavior that may be an indication an attack is pending or has occurred. If the server only logs errors and does not log successful access, it is very difficult to investigate incidents. You may see that the errors stop and wonder if the attacker gave up or if the attack was successful.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Verify the `CustomLog` directive is configured to an appropriate log file, syslog facility, or piped logging utility and the directive uses a log format that includes all of the format string tokens listed below. The log format string may be specified as a `LogFormat` nickname or as an explicit string. For example, either of the following two configurations are compliant:

```
LogFormat "%h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-agent}i\"" combined
CustomLog log/access_log combined
```

```
CustomLog log/access_log "%h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-agent}i\""
```

The log format string should include the following tokens in any order. The portion "= description text. " describes the information to be logged.

- `%h` = Remote hostname or IP address if HostnameLookups is set to Off, which is the default.
- `%l` = Remote logname / identity.
- `%u` = Remote user, if the request was authenticated.
- `%t` = Time the request was received,
- `%r` = First line of request.
- `%>s` = Final status.
- `%b` = Size of response in bytes.
- `%{Referer}i` = Variable value for Referer header.
- `%{User-agent}i` = Variable value for User Agent header.

2. Verify there is a similar `CustomLog` directives for each virtual host configured if the virtual host will have different people responsible for the web site.

## Remediation

Perform the following to implement the recommended state:

1. Add or modify the `LogFormat` directives in the Apache configuration to use the `combined` format show as shown below.

```
LogFormat "%h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-agent}i\"" combined
```

2. Add or modify the `CustomLog` directives in the Apache configuration to use the `combined` format with an appropriate log file, syslog facility or piped logging utility.

```
CustomLog log/access_log combined
```

3. Add a similar `CustomLog` directives for each virtual host configured if the virtual host will have different people responsible for the web site. Each responsible individual or organization needs access to their own web logs as well as the skills/training/tools for monitoring the logs.

## Default Value

The following is the default log configuration:

```
LogFormat "%h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-Agent}i\""" combined
LogFormat "%h %l %u %t \"%r\" %>s %b" common
CustomLog "logs/access_log" common
```

## References

1. https://httpd.apache.org/docs/2.2/mod/mod_log_config.html#customlog
2. https://httpd.apache.org/docs/2.2/mod/mod_log_config.html#formats

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
