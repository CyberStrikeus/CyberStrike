---
name: "T0814_denial-of-service"
description: "Adversaries may perform Denial-of-Service (DoS) attacks to disrupt expected device functionality."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - ics
  - t0814
  - inhibit-response-function
technique_id: "T0814"
tactic: "inhibit-response-function"
all_tactics:
  - inhibit-response-function
platforms:
  - ICS
mitre_url: "https://attack.mitre.org/techniques/T0814"
tech_stack:
  - ics
cwe_ids:
  - CWE-400
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T0814 Denial of Service

## High-Level Description

Adversaries may perform Denial-of-Service (DoS) attacks to disrupt expected device functionality. Examples of DoS attacks include overwhelming the target device with a high volume of requests in a short time period and sending the target device a request it does not know how to handle. Disrupting device state may temporarily render it unresponsive, possibly lasting until a reboot can occur. When placed in this state, devices may be unable to send and receive requests, and may not perform expected response functions in reaction to other events in the environment. 

Some ICS devices are particularly sensitive to DoS events, and may become unresponsive in reaction to even a simple ping sweep. Adversaries may also attempt to execute a Permanent Denial-of-Service (PDoS) against certain devices, such as in the case of the BrickerBot malware. 

Adversaries may exploit a software vulnerability to cause a denial of service by taking advantage of a programming error in a program, service, or within the operating system software or kernel itself to execute adversary-controlled code. Vulnerabilities may exist in software that can be used to cause a denial of service condition. 

Adversaries may have prior knowledge about industrial protocols or control devices used in the environment through Remote System Information Discovery. There are examples of adversaries remotely causing a Device Restart/Shutdown by exploiting a vulnerability that induces uncontrolled resource consumption.

## Kill Chain Phase

- Inhibit Response Function (TA0107)

**Platforms:** ICS

## What to Check

- [ ] Identify if Denial of Service technique is applicable to target ICS environment
- [ ] Check ICS/SCADA systems for indicators of Denial of Service
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Identify Attack Surface

Determine if the target ICS/SCADA environment is susceptible to Denial of Service by examining operational technology systems and network architecture.

### Assess Existing Defenses

Review whether mitigations for T0814 are in place. If defenses are absent or misconfigured, this technique may be exploitable in the ICS environment.

## Remediation Guide

### M0815 Watchdog Timers
System and process restarts should be performed when a timeout condition occurs.


## Detection

### Detection of Denial of Service


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Denial of Service technique applicable | High | Inhibit Response Function |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-400 | Uncontrolled Resource Consumption |


## References

- [Common Weakness Enumeration January 2019](http://cwe.mitre.org/data/definitions/400.html)
- [ICS-CERT April 2017](https://www.us-cert.gov/ics/alerts/ICS-ALERT-17-102-01A)
- [ICS-CERT August 2018](https://ics-cert.us-cert.gov/advisories/ICSA-15-202-01)
- [MITRE March 2018](https://nvd.nist.gov/vuln/detail/CVE-2015-5374)
- [MITRE ATT&CK ICS - T0814](https://attack.mitre.org/techniques/T0814)
