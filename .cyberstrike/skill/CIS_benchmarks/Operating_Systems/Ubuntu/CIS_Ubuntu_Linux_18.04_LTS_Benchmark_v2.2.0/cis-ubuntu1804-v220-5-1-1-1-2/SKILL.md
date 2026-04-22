---
name: cis-ubuntu1804-v220-5-1-1-1-2
description: "Ensure systemd-journal-remote is configured"
category: cis-logging
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, journald, logging]
cis_id: "5.1.1.1.2"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 5.1.1.1.2 Ensure systemd-journal-remote is configured (Manual)

## Profile

- **Level:** 1 - Server
- **Level:** 1 - Workstation
- **Assessment Status:** Manual

## Description

Journald (via `systemd-journal-remote`) supports the ability to send log events it gathers to a remote log host or to receive messages from remote hosts, thus enabling centralised log management.

## Rationale

Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

## Audit Procedure

### Command Line

Verify `systemd-journal-remote` is configured. Run the following command:

```bash
grep -P "^ *URL=|^ *ServerKeyFile=|^ *ServerCertificateFile=|^ *TrustedCertificateFile=" /etc/systemd/journal-upload.conf
```

Verify the output matches per your environments certificate locations and the URL of the log server. Example:

```
URL=192.168.50.42
ServerKeyFile=/etc/ssl/private/journal-upload.pem
ServerCertificateFile=/etc/ssl/certs/journal-upload.pem
TrustedCertificateFile=/etc/ssl/ca/trusted.pem
```

## Expected Result

Output should show URL, ServerKeyFile, ServerCertificateFile, and TrustedCertificateFile configured per your environment.

## Remediation

### Command Line

Edit the `/etc/systemd/journal-upload.conf` file and ensure the following lines are set per your environment:

```
URL=192.168.50.42
ServerKeyFile=/etc/ssl/private/journal-upload.pem
ServerCertificateFile=/etc/ssl/certs/journal-upload.pem
TrustedCertificateFile=/etc/ssl/ca/trusted.pem
```

Restart the service:

```bash
systemctl restart systemd-journal-upload
```

## Default Value

systemd-journal-remote is not configured by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-12, SI-5

## CIS Controls

| Controls Version | Control |
|-----------------|---------|
| v8 | 8.2 Collect Audit Logs - Collect audit logs. Ensure that logging, per the enterprise's audit log management process, has been enabled across enterprise assets. |
| v7 | 6.2 Activate audit logging - Ensure that local logging has been enabled on all systems and networking devices. |
| v7 | 6.3 Enable Detailed Logging - Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements. |
