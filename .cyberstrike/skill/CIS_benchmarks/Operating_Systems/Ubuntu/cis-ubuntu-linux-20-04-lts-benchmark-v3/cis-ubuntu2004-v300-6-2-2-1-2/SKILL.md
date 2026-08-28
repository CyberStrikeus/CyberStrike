---
name: cis-ubuntu2004-v300-6-2-2-1-2
description: "Ensure systemd-journal-upload authentication is configured"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, journald]
cis_id: "6.2.2.1.2"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.2.1.2 Ensure systemd-journal-upload authentication is configured (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

Journald `systemd-journal-upload` supports the ability to send log events it gathers to a remote log host.

## Rationale

Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

Note: This recommendation only applies if `journald` is the chosen method for client side logging. Do not apply this recommendation if `rsyslog` is used.

## Audit Procedure

### Command Line

Run the following command to verify `systemd-journal-upload` authentication is configured:

```bash
# grep -Psi "URL=|ServerKeyFile=|ServerCertificateFile=|TrustedCertificateFile=" /etc/systemd/journald.conf /etc/systemd/journal-upload.conf.d/*
```

Example output:

```
/etc/systemd/journal-upload.conf.d/60-journald_upload.conf:URL=192.168.50.42
/etc/systemd/journal-upload.conf.d/60-journald_upload.conf:ServerKeyFile=/etc/ssl/private/journal-upload.pem
/etc/systemd/journal-upload.conf.d/60-journald_upload.conf:ServerCertificateFile=/etc/ssl/certs/journal-upload.pem
/etc/systemd/journal-upload.conf.d/60-journald_upload.conf:TrustedCertificateFile=/etc/ssl/ca/trusted.pem
```

## Expected Result

Review the output to ensure it matches your environments' certificate locations and the URL of the log server.

## Remediation

### Command Line

Edit the `/etc/systemd/journal-upload.conf` file or a file in `/etc/systemd/journal-upload.conf.d` ending in `.conf` and ensure the following lines are set in the `[Upload]` section per your environment:

Example settings:

```ini
[Upload]
URL=192.168.50.42
ServerKeyFile=/etc/ssl/private/journal-upload.pem
ServerCertificateFile=/etc/ssl/certs/journal-upload.pem
TrustedCertificateFile=/etc/ssl/ca/trusted.pem
```

Run the following command to update the parameters in the service:

```bash
# systemctl reload-or-restart systemd-journal-upload
```

## Default Value

Not configured by default.

## References

1. NIST SP 800-53 Rev. 5: AU-2, AU-12

## CIS Controls

| Controls Version | Control                     | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------- | ---- | ---- | ---- |
| v8               | 8.2 Collect Audit Logs      |      |      |      |
| v7               | 6.2 Activate audit logging  |      |      |      |
| v7               | 6.3 Enable Detailed Logging |      |      |      |

### MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1562, T1562.006 | TA0040  | M1029       |
