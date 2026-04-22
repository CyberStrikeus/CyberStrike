---
name: cis-ubuntu2004-v300-6-2-3-6
description: "Ensure rsyslog is configured to send logs to a remote log host"
category: cis-logging
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, rsyslog]
cis_id: "6.2.3.6"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 6.2.3.6 Ensure rsyslog is configured to send logs to a remote log host (Manual)

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

`rsyslog` supports the ability to send log events it gathers to a remote log host or to receive messages from remote hosts, thus enabling centralized log management.

## Rationale

Storing log data on a remote host protects log integrity from local attacks. If an attacker gains root access on the local system, they could tamper with or remove log data that is stored on the local system.

## Audit Procedure

### Command Line

Run the following command and review the output of `rsyslog` configuration. Verify that logs are sent to a central host used by your organization:

basic format:

```bash
# grep "^.*[^I][^I]*@" /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

Output should include `@@<FQDN or IP of remote loghost>`, for example:

```
*.* @@loghost.example.com
```

Output should include `@@<FQDN or IP of remote loghost>`:

Example output:

```
/etc/rsyslog.d/60-rsyslog.conf:*.* @@loghost.example.com
```

- OR -

Run the following command and review the output of `rsyslog` configuration. Verify that logs are sent to a central host used by your organization:

advanced format:

```bash
# grep -E '^\s*([^#]+\s+)?action\(([^#]+\s+)?\btarget=\"?[^#"]+\"?\b' /etc/rsyslog.conf /etc/rsyslog.d/*.conf
```

Output should include `target=<FQDN or IP of remote loghost>`:

Example output:

```
/etc/rsyslog.d/60-rsyslog.conf:*.* action(type="omfwd" target="loghost.example.com" port="514" protocol="tcp"
```

## Expected Result

Verify logs are being sent to a remote log host.

## Remediation

### Command Line

Edit the `rsyslog` configuration and add the following line (where `loghost.example.com` is the name of your central log host). The `target` directive may either be a fully qualified domain name or an IP address.

```
*.* action(type="omfwd" target="192.168.2.100" port="514" protocol="tcp"
        action.resumeRetryCount="100"
        queue.type="linkedList" queue.size="1000")
```

Run the following command to reload `rsyslog.service`:

```bash
# systemctl reload-or-restart rsyslog.service
```

## Default Value

Not configured by default.

## References

1. See the rsyslog.conf(5) man page for more information.
2. NIST SP 800-53 Rev. 5: AU-6
3. https://www.rsyslog.com/doc/

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
