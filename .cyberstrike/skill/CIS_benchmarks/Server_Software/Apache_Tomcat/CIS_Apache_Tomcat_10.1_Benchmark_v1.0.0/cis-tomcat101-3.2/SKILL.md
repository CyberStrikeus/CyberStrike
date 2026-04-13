---
name: cis-tomcat101-3.2
description: "Disable the Shutdown port (Automated)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, shutdown, port]
cis_id: "3.2"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Disable the Shutdown port (Automated)

## Description

Tomcat listens on TCP port 8005 to accept shutdown requests. By connecting to this port and sending the SHUTDOWN command, all applications within Tomcat are halted. The shutdown port is not exposed to the network as it is bound to the loopback interface. If this functionality is not used, it is recommended that the shutdown port be disabled.

## Rationale

Disabling the Shutdown port will eliminate the risk of malicious local entities using the shutdown command to disable the Tomcat server.

## Audit Procedure

Perform the following to determine if the shutdown port has been disabled: Ensure the port attribute in `$CATALINA_HOME/conf/server.xml` is set to -1.

```bash
$ cd $CATALINA_HOME/conf/
$ grep '<Server[[:space:]]\+\[[^]]*port[[:space:]]*=[[:space:]]*"[[:space:]]*-1"' server.xml
```

## Remediation

Set the port to -1 in the `$CATALINA_HOME/conf/server.xml` to disable the shutdown port:

```xml
<Server port="-1" shutdown="SHUTDOWN">
```

## Default Value

The shutdown port is enabled on TCP port 8005, bound to the loopback address.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/server.html

## CIS Controls

**v8:**
- 4.4 Implement and Manage a Firewall on Servers
  - Implement and manage a firewall on servers, where supported. Example implementations include a virtual firewall, operating system firewall, or a third-party firewall agent.
- 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software
  - Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.

**v7:**
- 1.7 Deploy Port Level Access Control
  - Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. The authentication system shall be tied into the hardware asset inventory data to ensure only authorized devices can connect to the network.
- 9.2 Ensure Only Approved Ports, Protocols and Services Are Running
  - Ensure that only network ports, protocols, and services listening on a system with validated business needs, are running on each system.

## Profile Applicability

- Level 2
