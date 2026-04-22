---
name: cis-ubuntu1604-v200-5-3-17
description: "Ensure SSH Idle Timeout Interval is configured"
category: cis-networking
version: "2.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-16.04, ssh, remote-access]
cis_id: "5.3.17"
cis_benchmark: "CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 16.04 LTS Benchmark v2.0.0 - Control 5.3.17

## Description

The two options `ClientAliveInterval` and `ClientAliveCountMax` control the timeout of ssh sessions.

- `ClientAliveInterval` sets a timeout interval in seconds after which if no data has been received from the client, sshd will send a message through the encrypted channel to request a response from the client. The default is 0, indicating that these messages will not be sent to the client.
- `ClientAliveCountMax` sets the number of client alive messages which may be sent without sshd receiving any messages back from the client. If this threshold is reached while client alive messages are being sent, sshd will disconnect the client, terminating the session. The default value is 3.
  - The client alive messages are sent through the encrypted channel
  - Setting `ClientAliveCountMax` to 0 disables connection termination

Example: The default value is 3. If `ClientAliveInterval` is set to 15, and `ClientAliveCountMax` is left at the default, unresponsive SSH clients will be disconnected after approximately 45 seconds.

## Rationale

Having no timeout value associated with a connection could allow an unauthorized user access to another user's `ssh` session (e.g. user walks away from their computer and doesn't lock the screen). Setting a timeout value reduces this risk.

- The recommended `ClientAliveInterval` setting is no greater than `900` seconds (15 minutes)
- The recommended `ClientAliveCountMax` setting is `0`
- At the 15 minute interval, if the ssh session is inactive, the session will be terminated.

## Impact

In some cases this setting may cause termination of long-running scripts over SSH or remote automation tools which rely on SSH. In developing the local site policy, the requirements of such scripts should be considered and appropriate ServerAliveInterval and ClientAliveInterval settings should be calculated to insure operational continuity.

## Audit Procedure

### Command Line

Run the following commands and verify `ClientAliveInterval` is between 1 and `900`:

```bash
sshd -T -C user=root -C host="$(hostname)" -C addr="$(grep $(hostname) /etc/hosts | awk '{print $1}')" | grep clientaliveinterval
```

### Expected Result

```
clientaliveinterval 900
```

Run the following command and verify `ClientAliveCountMax` is 0:

```bash
sshd -T -C user=root -C host="$(hostname)" -C addr="$(grep $(hostname) /etc/hosts | awk '{print $1}')" | grep clientalivecountmax
```

### Expected Result

```
clientalivecountmax 3
```

Run the following commands and verify the output:

```bash
grep -Ei '^\s*ClientAliveInterval\s+(0|9[0-9][1-9]|[1-9][0-9][0-9][0-9]+|1[6-9]m|[2-9][0-9]m|[1-9][0-9][0-9]+m)\b' /etc/ssh/sshd_config
```

Nothing should be returned.

```bash
grep -Ei '^\s*ClientAliveCountMax\s+([1-9]|[1-9][0-9]+)\b' /etc/ssh/sshd_config
```

Nothing should be returned.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameters according to site policy. This should include `ClientAliveInterval` between `1` and `900` and `ClientAliveCountMax` of `0`:

```
ClientAliveInterval 900
ClientAliveCountMax 0
```

## Default Value

ClientAliveInterval 0

ClientAliveCountMax 3

## References

1. https://man.openbsd.org/sshd_config

## CIS Controls

Version 7

16.11 Lock Workstation Sessions After Inactivity - Automatically lock workstation sessions after a standard period of inactivity.

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
