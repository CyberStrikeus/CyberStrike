---
name: cis-tomcat9-v120-10.17
description: "Setting Security Lifecycle Listener (Automated)"
category: cis-tomcat
version: "1.2.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.17"
cis_benchmark: "CIS Apache Tomcat 9 Benchmark v1.2.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.17 Setting Security Lifecycle Listener (Automated)

## Description

The Security Lifecycle Listener performs a number of security checks when Tomcat starts and prevents Tomcat from starting if they fail.

## Rationale

When enabled, the Security Lifecycle Listener can

- Enforce a blacklist of OS users that must not be used to start Tomcat.
- Set the least restrictive `umask` before Tomcat start

## Audit Procedure

Review `server.xml` to ensure the Security Lifecycle Listener element is uncommented with the `checkedOsUsers` and `minimumUmask` attributes set with expected values.

## Remediation

Uncomment the listener in `$CATALINA_BASE/conf/server.xml`. If the operating system supports `umask` then the line in `$CATALINA_HOME/bin/catalina.sh` that obtains the `umask` also needs to be uncommented.

Within Server elements add:

- `checkedOsUsers`: A comma separated list of OS users that must not be used to start Tomcat. If not specified, the default value of `root` is used.

- `minimumUmask`: The least restrictive `umask` that must be configured before Tomcat will start. If not specified, the default value of `0007` is used.

```xml
<Listener className="org.apache.catalina.security.SecurityListener"
checkedOsUsers="alex,bob" minimumUmask="0007" />
```

## Default Value

The Security Lifecycle Listener is not enabled by default. For `checkedOsUsers`, the default value is `root`. For `minimumUmask`, the default value is `0007`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/listeners.html#Security_Lifecycle_Listener_-_org.apache.catalina.security.SecurityListener

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 5.4 Restrict Administrator Privileges to Dedicated Administrator Accounts<br>Restrict administrator privileges to dedicated administrator accounts on enterprise assets. Conduct general computing activities, such as internet browsing, email, and productivity suite use, from the user's primary, non-privileged account. | ● | ● | ● |
| v7 | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software. | ● | ● | ● |

## Profile

Level 1
