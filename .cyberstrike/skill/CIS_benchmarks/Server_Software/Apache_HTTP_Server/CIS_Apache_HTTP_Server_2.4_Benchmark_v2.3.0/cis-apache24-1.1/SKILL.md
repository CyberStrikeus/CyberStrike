---
name: cis-apache24-1.1
description: "Ensure the Pre-Installation Planning Checklist Has Been Implemented"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, planning, installation]
cis_id: "1.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 1.1 Ensure the Pre-Installation Planning Checklist Has Been Implemented (Manual)

## Profile Applicability
- Level 1

## Description
Review and implement the following items as appropriate:

- Reviewed and implemented company's security policies as they relate to web security.
- Implemented a secure network infrastructure by controlling access to/from your web server by using firewalls, routers or switches.
- Harden the underlying Operating System of the web server, by minimizing listening network services, applying proper patches and hardening the configurations as recommended in the appropriate Center for Internet Security benchmark for the platform.
- Implement central log monitoring processes.
- Implemented a disk space monitoring process and log rotation mechanism.
- Educate developers, architects and testers about developing secure applications, and integrate security into the software development lifecycle. https://www.owasp.org/ http://www.webappsec.org/
- Ensure the WHOIS Domain information registered for our web presence does not reveal sensitive personnel information, which may be leveraged for Social Engineering (Individual POC Names, War Dialing (Phone Numbers) and Brute Force Attacks (Email addresses matching actual system usernames).
- Ensure your Domain Name Service (DNS) servers have been properly secured to prevent attacks, as recommended in the CIS BIND DNS Benchmark.
- Implemented a Network Intrusion Detection System to monitor attacks against the web server.

## Rationale
Proper planning and preparation are essential for a secure Apache installation. These steps help establish a foundation for security before the web server is even installed.

## Audit
This is a manual review of organizational policies and procedures. Verify that the pre-installation planning checklist has been reviewed and appropriate items have been implemented based on organizational requirements.

## Remediation
Review the pre-installation planning checklist and implement all items that are appropriate for your organization's security requirements and operational needs.

## References
1. Open Web Application Security Project - https://owasp.org/
2. Web Application Security Consortium - http://www.webappsec.org/

## CIS Controls
- v8: 13.11 Tune Security Event Alerting Thresholds
- v8: 16.7 Use Standard Hardening Configuration Templates for Application Infrastructure
- v7: 13.1 Maintain an Inventory Sensitive Information
- v7: 18.11 Use Standard Hardening Configuration Templates for Databases

## Profile
- Level 1
