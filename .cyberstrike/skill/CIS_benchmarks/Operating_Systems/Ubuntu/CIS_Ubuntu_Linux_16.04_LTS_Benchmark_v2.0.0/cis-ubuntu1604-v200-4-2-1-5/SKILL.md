---
name: cis-ubuntu1604-v200-4-2-1-5
description: "Ensure rsyslog is configured to send logs to a remote log host"
category: cis-logging
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, logging, rsyslog]
cis_id: "4.2.1.5"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 4.2.1.5

## Profile
- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Automated

## Description

The `rsyslog` utility supports the ability to send logs it gathers to a remote log host running `syslogd(8)` or to receive messages from remote hosts, reducing administrative overhead.

## Rationale

Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

**Note:** Ensure that the selection of logfiles being sent follows local site policy.

## Impact

None.

## Audit Procedure

Review the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files and verify that logs are sent to a central host.

### Command Line

```bash
grep -E '^\s*([^#]+\s+)?action\(([^#]+\s+)?\btarget=\"?[^#"]+\"?\b' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

Output should include `target=<FQDN or IP of remote loghost>`

OR

```bash
grep -E '^[^#]\s*\S+\.\*\s+@' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

## Expected Result

Output should include either the FQDN or the IP of the remote loghost.

## Remediation

Edit the `/etc/rsyslog.conf` and `/etc/rsyslog.d/*.conf` files and add one of the following lines:

### Command Line

Newer syntax:

```bash
# Add the following to /etc/rsyslog.conf or /etc/rsyslog.d/*.conf:
*.* action(type="omfwd" target="<FQDN or ip of loghost>" port="<port number>" protocol="tcp"
        action.resumeRetryCount="<number of re-tries>"
                                        queue.type="LinkedList"
        queue.size=<number of messages to queue>)
```

Example:

```bash
*.* action(type="omfwd" target="192.168.2.100" port="514" protocol="tcp"
        action.resumeRetryCount="100"
        queue.type="LinkedList" queue.size="1000")
```

Older syntax:

```bash
# Add the following to /etc/rsyslog.conf or /etc/rsyslog.d/*.conf:
*.* @@<FQDN or ip of loghost>
```

Example:

```bash
*.* @@192.168.2.100
```

Run the following command to reload the `rsyslog` configuration:

```bash
systemctl restart rsyslog
```

## Additional Information

The double "at" sign (`@@`) directs `rsyslog` to use TCP to send log messages to the server, which is a more reliable transport mechanism than the default UDP protocol.

The `*.*` is a "wildcard" to send all logs to the remote loghost.

## Default Value

rsyslog is not configured to send logs to a remote host by default.

## References

1. See the rsyslog.conf(5) man page for more information.

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v7 | 6.6 Deploy SIEM or Log Analytic tool<br/>Deploy Security Information and Event Management (SIEM) or log analytic tool for log correlation and analysis. | | | |
| v7 | 6.8 Regularly Tune SIEM<br/>On a regular basis, tune your SIEM system to better identify actionable events and decrease event noise. | | | |
