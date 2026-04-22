---
name: cis-tomcat8-v110-10.16
description: "Enable memory leak listener (Automated)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, hardening, security]
cis_id: "10.16"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.16 Enable memory leak listener (Automated)

## Description

The JRE Memory Leak Prevention Listener provides work-arounds for known places where the Java Runtime uses the context class loader to load a singleton as this will cause a memory leak if a web application class loader happens to be the context class loader at the time. The work-around is to initialize these singletons when this listener starts as Tomcat's common class loader is the context class loader at that time. It also provides work-arounds for known issues that can result in locked JAR files.

## Rationale

Enabling the JRE Memory Leak Prevention Listener provides work-arounds for preventing memory leaks.

## Audit Procedure

Ensure this line is present and not commented out in the `$CATALINA_HOME/conf/server.xml`:

```xml
<Listener
className="org.apache.catalina.core.JreMemoryLeakPreventionListener" />
```

## Remediation

Uncomment the JRE Memory Leak Prevention Listener in `$CATALINA_HOME/conf/server.xml`

```xml
<Listener
className="org.apache.catalina.core.JreMemoryLeakPreventionListener" />
```

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/config/listeners.html#JRE_Memory_Leak_Prevention_Listener_-_org.apache.catalina.core.JreMemoryLeakPreventionListener

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software<br>Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications). |      |      |      |
| v7               | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                                                                       | ●    | ●    | ●    |

## Profile

Level 1
