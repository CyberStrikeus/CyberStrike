---
name: cis-ubuntu1804-v220-4-2-6
description: "Ensure sshd ClientAliveInterval and ClientAliveCountMax are configured"
category: cis-networking
version: "2.2.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-18.04, ssh, remote-access]
cis_id: "4.2.6"
cis_benchmark: "CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# CIS Ubuntu Linux 18.04 LTS Benchmark v2.2.0 - Control 4.2.6

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Description

The two options `ClientAliveInterval` and `ClientAliveCountMax` control the timeout of SSH sessions.

- `ClientAliveInterval` sets a timeout interval in seconds after which if no data has been received from the client, sshd will send a message through the encrypted channel to request a response from the client. The default is 0, indicating that these messages will not be sent to the client.
- `ClientAliveCountMax` sets the number of client alive messages which may be sent without sshd receiving any messages back from the client. If this threshold is reached while client alive messages are being sent, sshd will disconnect the client, terminating the session.

## Rationale

Having no timeout value associated with a connection could allow an unauthorized user access to another user's SSH session. Setting a timeout value reduces this risk.

The `ClientAliveCountMax` parameter sets a limit on the number of times the server will attempt to send alive messages before disconnecting.

## Audit Procedure

### Command Line

Run the following command and verify the output:

```bash
sshd -T | grep -Pi '(clientaliveinterval|clientalivecountmax)'
```

### Expected Result

```
clientaliveinterval 15
clientalivecountmax 3
```

OR site-appropriate values. `clientaliveinterval` should be between 1 and 300. `clientalivecountmax` should be between 1 and 3.

## Remediation

### Command Line

Edit the `/etc/ssh/sshd_config` file to set the parameters according to site policy:

```bash
ClientAliveInterval 15
ClientAliveCountMax 3
```

## Default Value

ClientAliveInterval 0
ClientAliveCountMax 3

## References

1. NIST SP 800-53 Rev. 5: CM-6

## CIS Controls

None

## Profile Applicability

- Level 1 - Server
- Level 1 - Workstation

## Assessment Status

Automated
