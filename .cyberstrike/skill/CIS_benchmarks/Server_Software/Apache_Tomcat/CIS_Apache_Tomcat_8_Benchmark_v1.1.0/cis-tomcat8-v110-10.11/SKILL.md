---
name: cis-tomcat8-v110-10.11
description: "Force SSL for all applications (Automated)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, ssl, hardening, security]
cis_id: "10.11"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.11 Force SSL for all applications (Automated)

## Description

Use the `transport-guarantee` attribute to ensure SSL protection when accessing all applications. This can be overridden on a per application basis in the application configuration.

## Rationale

By default, when accessing applications SSL will be enforced to protect information sent over the network. By using the `transport-guarantee` attribute within `web.xml`, SSL is enforced.

Note: This requires SSL to be configured.

## Impact

If the data protection level is set to `INTEGRAL` or `CONFIDENTIAL`, and the client is not already using SSL, then the client is redirected to the same URI, but using port 443 or the port defined for the `redirectPort` attribute in the `<Connector>` element in `server.xml`.

## Audit Procedure

Ensure `$CATALINA_HOME/conf/web.xml` has the `transport-guarantee` attribute set to `CONFIDENTIAL`.

```
# grep transport-guarantee $CATALINA_HOME/conf/web.xml
```

## Remediation

Set `transport-guarantee` to `CONFIDENTIAL` in `$CATALINA_HOME/conf/web.xml`:

```xml
<user-data-constraint>
  <transport-guarantee>CONFIDENTIAL</transport-guarantee>
</user-data-constraint>
```

## Default Value

By default this configuration is not present.

## References

1. https://www.owasp.org/index.php/Securing_tomcat

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 3.10 Encrypt Sensitive Data in Transit<br>Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH). | | ● | ● |
| v7 | 14.4 Encrypt All Sensitive Information in Transit<br>Encrypt all sensitive information in transit. | | ● | ● |

## Profile

Level 2
