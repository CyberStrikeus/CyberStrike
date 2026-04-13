---
name: cis-tomcat101-10.15
description: "Do not resolve hosts on logging valves (Automated)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security, logging]
cis_id: "10.15"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.15 Do not resolve hosts on logging valves (Automated)

## Description

Setting `enableLookups` to `true` on Connector will result in a DNS look-ups to obtain the host name of the remote client before logging any information. This uses additional resources when logging.

## Rationale

Allowing `enableLookups` adds additional overhead to resolve the host name of a remote client which is rarely needed.

## Audit Procedure

Ensure Connector elements have the `enableLookups` attribute does not exist or is set to `false`.

```
# grep enableLookups $CATALINA_HOME/conf/server.xml
```

## Remediation

In Connector elements, set the `enableLookups` attribute to `false` or remove it.

```xml
<Connector ... enableLookups="false" />
```

## Default Value

By default, DNS lookups are disabled.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/valve.html
2. https://tomcat.apache.org/tomcat-9.0-doc/config/http.html

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 9.2 Use DNS Filtering Services<br>Use DNS filtering services on all enterprise assets to block access to known malicious domains. | ● | ● | ● |
| v7 | 7.7 Use of DNS Filtering Services<br>Use DNS filtering services to help block access to known malicious domains. | ● | ● | ● |

## Profile

Level 2
