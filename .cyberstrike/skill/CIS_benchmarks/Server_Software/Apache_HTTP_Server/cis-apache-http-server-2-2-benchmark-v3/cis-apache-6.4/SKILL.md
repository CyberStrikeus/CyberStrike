---
name: cis-apache-6.4
description: "Ensure Log Storage and Rotation Is Configured Correctly"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring, maintenance]
cis_id: "6.4"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Log Storage and Rotation Is Configured Correctly

## Description

It is important that there is adequate disk space on the partition to hold all the log files, and that log rotation is configured to retain at least three months or 13 weeks of logs if central logging is not used for storage.

## Rationale

The generation of logs is under a potential attacker's control, so do not hold any Apache log files on the root partition of the OS. This could result in a denial of service against your web server host by filling up the root partition and causing the system to crash. For this reason, it is recommended that the log files be stored on a dedicated partition. Likewise, consider that attackers sometimes put information into your logs which is intended to attack your log collection or log analysis processing software. So it is important that they are not vulnerable. Investigation of incidents often requires access to several months or more of logs, which is why it is important to keep at least three months' worth available. Two common log rotation utilities are `rotatelogs(8)`, which is bundled with Apache, and `logrotate(8)`, commonly bundled on Linux distributions.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Verify the web log rotation configuration matches the Apache configured log files.
2. Verify the rotation period and number of logs to retain is at least 13 weeks or three months.
3. For each virtual host configured with its own log files, ensure those log files are also included in a similar log rotation.

## Remediation

To implement the recommended state, do either option a) if using the Linux `logrotate` utility or option b) if using a piped logging utility such as the Apache `rotatelogs`:

### a) File Logging with Logrotate:

1. Add or modify the web log rotation configuration to match your configured log files in `/etc/logrotate.d/httpd` to be similar to the following.

```
/var/log/httpd/*log {
    missingok
    notifempty
    sharedscripts
        postrotate
    /bin/kill -HUP 'cat /var/run/httpd.pid 2>/dev/null' 2> /dev/null || true
    endscript
}
```

2. Modify the rotation period and number of logs to keep so that at least 13 weeks or three months of logs are retained. This may be done as the default value for all logs in `/etc/logrotate.conf` or in the web specific log rotation configuration in `/etc/logrotate.d/httpd` to be similar to the following.

```
# rotate log files weekly
weekly

# keep 1 year of logs
rotate 52
```

3. For each virtual host configured with its own log files, ensure those log files are also included in a similar log rotation.

### b) Piped Logging:

1. Configure the log rotation interval and log filenames to a suitable interval such as daily.

```
CustomLog "|bin/rotatelogs -l /var/logs/logfile.%Y.%m.%d 86400" combined
```

2. Ensure the log file naming and any rotation scripts provide for retaining at least three months or 13 weeks of log files.
3. For each virtual host configured with its own log files, ensure those log files are included in a similar log rotation.

## Default Value

The following is the default httpd log rotation configuration in `/etc/logrotate.d/httpd`:

```
/var/log/httpd/*log {
    missingok
    notifempty
    sharedscripts
        postrotate
    /bin/kill -HUP 'cat /var/run/httpd.pid 2>/dev/null' 2> /dev/null || true
    endscript
}
```

## References

1. https://httpd.apache.org/docs/2.2/logs.html
2. https://httpd.apache.org/docs/2.2/programs/rotatelogs.html

## CIS Controls

**Version 6**

6.3 Protect Information stored on removable media
Protect data on USB or other removable media through physical security and encryption.

6.4 Ensure adequate storage for logs
Ensure that all systems that store logs have adequate storage space for the logs generated.

**Version 7**

6.3 Enable Detailed Logging
Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.

6.4 Ensure adequate storage for logs
Ensure that all systems that store logs have adequate storage space for the logs generated.

## Profile

Level 1 | Scored
Level 2 | Scored
