---
name: cis-tomcat8-v110-10.4
description: "Force SSL when accessing the manager application via HTTP (Manual)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, ssl, manager, security]
cis_id: "10.4"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.4 Force SSL when accessing the manager application via HTTP (Manual)

## Description

Use the transport-guarantee attribute to ensure SSL protection when accessing the manager application.

## Rationale

By default when accessing the manager application via HTTP, login information is sent over the wire in plain text. By setting the transport-guarantee within `web.xml`, SSL is enforced.

Note: This requires SSL to be configured.

## Audit Procedure

Ensure `$CATALINA_HOME/webapps/manager/WEB-INF/web.xml` has the `<transport-guarantee>` set to `CONFIDENTIAL`.

```
# grep transport-guarantee $CATALINA_HOME/webapps/manager/WEB-INF/web.xml
```

## Remediation

Set `<transport-guarantee>` to `CONFIDENTIAL` in `$CATALINA_HOME/webapps/manager/WEB-INF/web.xml`:

```xml
<security-constraint>
  <user-data-constraint>
    <transport-guarantee>CONFIDENTIAL</transport-guarantee>
  </user-data-constraint>
</security-constraint>
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

Level 1
