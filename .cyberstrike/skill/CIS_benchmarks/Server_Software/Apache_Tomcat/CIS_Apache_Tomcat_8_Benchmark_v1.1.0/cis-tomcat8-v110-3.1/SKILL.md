---
name: cis-tomcat8-v110-3.1
description: "Set a nondeterministic Shutdown command value (Scored)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, shutdown-port, access-control]
cis_id: "3.1"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Set a nondeterministic Shutdown command value (Scored)

## Description

Tomcat listens on TCP port `8005` to accept shutdown requests. By connecting to this port and sending the `SHUTDOWN` command, all applications within Tomcat are halted. The shutdown port is not exposed to the network as it is bound to the loopback interface. It is recommended that a nondeterministic value be set for the shutdown attribute in `$CATALINA_HOME/conf/server.xml`.

## Rationale

Setting the shutdown attribute to a nondeterministic value will prevent malicious local users from shutting down Tomcat.

## Audit Procedure

Perform the following to determine if the shutdown port is configured to use the default `shutdown` command. Ensure the `shutdown` attribute in `$CATALINA_HOME/conf/server.xml` is not set to `SHUTDOWN`.

```bash
$ cd $CATALINA_HOME/conf
$ grep 'shutdown[[:space:]]*=[[:space:]]*"SHUTDOWN"' server.xml
```

## Remediation

Perform the following to set a nondeterministic value for the `shutdown` attribute. Update the `shutdown` attribute in `$CATALINA_HOME/conf/server.xml` as follows:

```xml
<Server port="8005" shutdown="NONDETERMINISTICVALUE">
```

**Note:** `NONDETERMINISTICVALUE` should be replaced with a sequence of random characters.

## Default Value

The default value for the `shutdown` attribute is `SHUTDOWN`.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/config/server.html
2. https://tomcat.apache.org/tomcat-8.5-doc/config/server.html

## CIS Controls

**v7:**

- 4.7 Limit Access to Script Tools
  - Limit access to scripting tools (such as Microsoft PowerShell and Python) to only administrative or development users with the need to access those capabilities.

## Profile Applicability

- Level 1
