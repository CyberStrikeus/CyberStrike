---
name: cis-tomcat8-v110-9.3
description: "Disable deploy on startup of applications (Scored)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, tomcat-8, hardening, deployment, auto-deploy]
cis_id: "9.3"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 9.3 Disable deploy on startup of applications (Scored)

## Description

Tomcat allows auto deployment of applications on startup. It is recommended that this capability be disabled.

## Rationale

This could allow malicious or untested applications to be deployed and should be disabled.

## Audit Procedure

Perform the following to ensure `deployOnStartup` is set to `false`.

```bash
$ grep "deployOnStartup" $CATALINA_HOME/conf/server.xml
```

## Remediation

In the `$CATALINA_HOME/conf/server.xml` file, change `deployOnStartup` to `false`.

```xml
<Host name="localhost" appBase="webapps"
      unpackWARs="true" autoDeploy="false"
      deployOnStartup="false">
```

## Default Value

`deployOnStartup` is set to `true`.

## References

1. https://tomcat.apache.org/tomcat-8.0-doc/deployer-howto.html#Deployment_on_Tomcat_startup
2. https://tomcat.apache.org/tomcat-8.0-doc/config/host.html#Automatic_Application_Deployment

## CIS Controls

**v7:**

- 5.1 Establish Secure Configurations
  - Maintain documented, standard security configuration standards for all authorized operating systems and software.

## Profile Applicability

- Level 2
