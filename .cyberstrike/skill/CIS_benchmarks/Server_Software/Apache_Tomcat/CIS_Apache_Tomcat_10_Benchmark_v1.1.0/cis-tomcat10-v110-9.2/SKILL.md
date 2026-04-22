---
name: cis-tomcat10-v110-9.2
description: "Disable deploy on startup of applications (Automated)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, deployment, auto-deploy]
cis_id: "9.2"
cis_benchmark: "CIS Apache Tomcat 10 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.2 Disable deploy on startup of applications (Automated)

## Description

Tomcat allows auto deployment of applications on startup. It is recommended that this capability be disabled.

## Rationale

This could allow malicious or untested applications to be deployed and should be disabled.

## Audit Procedure

Perform the following to ensure `deployOnStartup` is set to `false`.

```
# grep "deployOnStartup" $CATALINA_HOME/conf/server.xml
```

## Remediation

In the `$CATALINA_HOME/conf/server.xml` file, change `deployOnStartup` to `false`.

```
deployOnStartup="false"
```

## Default Value

`deployOnStartup` is set to `true`.

## References

1. https://tomcat.apache.org/tomcat-9.0-doc/deployer-howto.html#Deployment_on_Tomcat_startup
2. https://tomcat.apache.org/tomcat-9.0-doc/config/host.html#Automatic_Application_Deployment

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                        | IG 1 | IG 2 | IG 3 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4 Secure Configuration of Enterprise Assets and Software<br>Establish and maintain the secure configuration of enterprise assets (end-user devices, including portable and mobile; network devices; non-computing/IoT devices; and servers) and software (operating systems and applications). |      |      |      |
| v7               | 5.1 Establish Secure Configurations<br>Maintain documented, standard security configuration standards for all authorized operating systems and software.                                                                                                                                       | ●    | ●    | ●    |

## Profile

Level 2
