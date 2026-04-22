---
name: cis-tomcat8-v110-3.2
description: "Disable the Shutdown port (Not Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, shutdown-port, network-security]
cis_id: "3.2"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Disable the Shutdown port (Not Scored)

## Description

Tomcat listens on TCP port `8005` to accept shutdown requests. By connecting to this port and sending the `SHUTDOWN` command, all applications within Tomcat are halted. The shutdown port is not exposed to the network as it is bound to the loopback interface. If this functionality is not used, it is recommended that the shutdown port be disabled.

## Rationale

Disabling the Shutdown port will eliminate the risk of malicious local entities using the shutdown command to disable the Tomcat server.

## Audit Procedure

Perform the following to determine if the shutdown port has been disabled. Ensure the port attribute in `$CATALINA_HOME/conf/server.xml` is set to `-1`.

```bash
$ cd $CATALINA_HOME/conf/
$ grep '<Server[[:space:]]\+[^>]*port[[:space:]]*=[[:space:]]*"-1"' server.xml
```

## Remediation

Set the port to `-1` in the `$CATALINA_HOME/conf/server.xml` to disable the shutdown port.

```xml
<Server port="-1" shutdown="SHUTDOWN">
```

## Default Value

The shutdown port is enabled on TCP port `8005`, bound to the loopback address.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/config/server.html

## CIS Controls

**v7:**

- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running
  - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile Applicability

- Level 2
