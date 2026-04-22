---
name: cis-apache24-6.4
description: "Ensure Log Storage and Rotation Is Configured Correctly"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, logging, monitoring, maintenance]
cis_id: "6.4"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Log Storage and Rotation Is Configured Correctly (Manual)

## Profile Applicability

Level 1

## Description

It is important that there is adequate disk space on the partition that will hold all the log files, and that log rotation is configured to retain at least 3 months or 13 weeks if central logging is not used for storage.

## Rationale

Keep in mind that the generation of logs is under a potential attacker's control. So, do not load any Apache log files on the root partition of the OS. This could result in a denial of service against your web server host by filling up the root partition and causing the system to crash. For this reason, it is recommended that the log files should be stored on a dedicated partition. Likewise consider that attackers sometimes put information into your logs which is intended to attack your log collection or log analysis processing software. So, it is important that they are not vulnerable. Investigation of incidents often require access to several months or logs, which is why it is important to keep at least 3 months available. Two common log rotation utilities include rotatelogs(8) which is bundled with Apache, and logrotate(8) commonly bundled on Linux distributions are described in the remediation section.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Verify the web log rotation configuration matches the Apache configured log files.
2. Verify the rotation period and number of logs to retain is at least 13 weeks or 3 months.
3. For each virtual host configured with its own log files ensure that those log files are also included in a similar log rotation.

## Remediation

To implement the recommended state, do either option 'a' if using the Linux logrotate utility or option 'b' if using a piped logging utility such as the Apache rotatelogs:

a) File Logging with Logrotate:

1. Add or modify the web log rotation configuration to match your configured log files in /etc/logrotate.d/httpd or '/etc/logrotate.d/apache2' to be similar to the following.

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

2. Modify the rotation period and number of logs to keep so that at least 13 weeks or 3 months of logs are retained. This may be done as the default value for all logs in /etc/logrotate.conf or in the web specific log rotation configuration in /etc/logrotate.d/httpd to be similar to the following.

   ```
   # rotate log files weekly
   weekly
   # keep 13 weeks of backlogs
   rotate 13
   ```

3. For each virtual host configured with its own log files ensure that those log files are also included in a similar log rotation.

b) Piped Logging:

1. Configure the log rotation interval and log file names to a suitable interval such as daily.

   ```
   CustomLog "|/bin/rotatelogs -l /var/logs/logfile.%Y.%m.%d 86400" combined
   ```

2. Ensure the log file naming and any rotation scripts provide for retaining at least 3 months or 13 weeks of log files.

3. For each virtual host configured with its own log files ensure that those log files are also included in a similar log rotation.

## Default Value

The following is the default httpd log rotation configuration in /etc/logrotate.d/httpd or '/etc/logrotate2' :

```
/var/log/httpd/*log {
    missingok
    notifempty
    sharedscripts
    postrotate
    /bin/kill -HUP `cat /var/run/httpd.pid 2>/dev/null` 2> /dev/null || true
    endscript
}
```

The default log retention configured in /etc/logrotate.conf:

```
# rotate log files weekly
weekly
# keep 4 weeks worth of backlogs
rotate 4
```

## References

1. https://httpd.apache.org/docs/2.4/logs.html

## CIS Controls

**v8:**

- 8.3 Ensure Adequate Audit Log Storage

**v7:**

- 6.4 Ensure adequate storage for logs
