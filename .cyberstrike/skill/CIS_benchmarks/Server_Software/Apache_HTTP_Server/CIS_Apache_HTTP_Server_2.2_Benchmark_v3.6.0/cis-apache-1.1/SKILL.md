---
name: cis-apache-1.1
description: "Ensure the Pre-Installation Planning Checklist Has Been Implemented"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, planning, installation]
cis_id: "1.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Pre-Installation Planning Checklist Has Been Implemented

## Description

Review and implement the following items as appropriate:

- Review and implement your organization's security policies as they relate to web security.
- Implement a secure network infrastructure by controlling access to/from your web server using firewalls, routers and switches.
- Harden the underlying operating system of the web server by minimizing listening network services, applying proper patches, and hardening the configurations as recommended in the appropriate Center for Internet Security benchmark for the platform.
- Implement central log monitoring processes.
- Implement a disk space monitoring process and log rotation mechanism.
- Educate developers about developing secure applications. http://www.owasp.org/ http://www.webappsec.org/
- Ensure the WHOIS Domain information registered for the web presence does not reveal sensitive personnel information, which may be leveraged for social engineering and other types of attacks.
- Ensure your Domain Name System (DNS) servers have been properly secured to prevent attacks, as recommended in the CIS BIND DNS benchmark.
- Implement intrusion detection technology, a web application firewall, or other similar technology to monitor attacks against the web server.

## Rationale

This section contains recommendations for the planning and installation of an Apache HTTP Server.

## Impact

None documented

## Audit Procedure

Review and verify that each item in the pre-installation planning checklist has been addressed according to your organization's security policies and requirements.

Verify the following:
1. Organization security policies have been reviewed and implemented
2. Secure network infrastructure is in place (firewalls, routers, switches)
3. Operating system has been hardened per CIS benchmarks
4. Central log monitoring is configured
5. Disk space monitoring and log rotation mechanisms are active
6. Developer security training has been conducted
7. WHOIS information does not reveal sensitive data
8. DNS servers are secured per CIS BIND DNS benchmark
9. Intrusion detection or WAF is deployed

## Remediation

Implement each item in the pre-installation planning checklist:

1. **Review security policies**: Document and implement organizational security policies for web security
2. **Network security**: Configure firewalls, routers, and switches to control access to/from web servers
3. **OS hardening**: Follow the appropriate CIS benchmark for your platform
4. **Logging**: Set up central log aggregation and monitoring
5. **Disk monitoring**: Implement disk space alerts and configure logrotate
6. **Security training**: Provide OWASP and web application security training to developers
7. **WHOIS sanitization**: Review and redact sensitive information from domain registration
8. **DNS security**: Harden DNS servers according to CIS BIND DNS benchmark
9. **Attack monitoring**: Deploy IDS/IPS, WAF, or similar security monitoring tools

## Default Value

No default configuration exists for this planning checklist.

## References

1. http://www.owasp.org/
2. http://www.webappsec.org/

## CIS Controls

Version 6

9.5 Operate Critical Services On Dedicated Hosts (i.e. DNS, Mail, Web, Database)
    Operate critical services on separate physical or logical host machines, such as DNS, file, mail, web, and database servers.

Version 7

2.10 Physically or Logically Segregate High Risk Applications
    Physically or logically segregated systems should be used to isolate and run software that is required for business operations but incur higher risk for the organization.

## Profile

Level 1 | Not Scored
Level 2 | Not Scored
