---
name: cis-tomcat101-10.5
description: "Rename the manager application (Manual)"
category: cis-tomcat
version: "1.0.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, manager, security]
cis_id: "10.5"
cis_benchmark: "CIS Apache Tomcat 10.1 Benchmark v1.0.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.5 Rename the manager application (Manual)

## Description

The manager application allows administrators to manage Tomcat remotely via a web interface. The manager application should be renamed to make it harder for attackers or automated scripts to locate.

## Rationale

By relocating the manager applications, an attacker will need to guess its location rather than simply navigate to the standard location in order to carry out an attack.

## Audit Procedure

Ensure `$CATALINA_HOME/conf/Catalina/localhost/manager.xml`, `$CATALINA_HOME/webapps/host-manager/manager.xml`, `$CATALINA_HOME/webapps/manager` and `$CATALINA_HOME/webapps/manager` do not exist.

## Remediation

Perform the following to rename the manager application:

1. Rename the manager application XML file:

```
# mv $CATALINA_HOME/webapps/host-manager/manager.xml \
$CATALINA_HOME/webapps/host-manager/<new-name>.xml
```

2. Update the docBase attribute within `$CATALINA_HOME/webapps/host-manager/<new-name>.xml` to `$CATALINA_HOME/webapps/<new-name>`

3. Move `$CATALINA_HOME/webapps/manager` to `$CATALINA_HOME/webapps/<new-name>`

```
# mv $CATALINA_HOME/webapps/manager $CATALINA_HOME/webapps/<new-name>
```

## Default Value

The default name of the manager application is `manager` and is located at:

```
$CATALINA_HOME/webapps/manager
```

## References

1. https://www.owasp.org/index.php/Securing_tomcat

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                                       | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 4.8 Uninstall or Disable Unnecessary Services on Enterprise Assets and Software<br>Uninstall or disable unnecessary services on enterprise assets and software, such as an unused file sharing service, web application module, or service function.                                                          |      | ●    | ●    |
| v7               | 1.7 Deploy Port Level Access Control<br>Utilize port level access control, following 802.1x standards, to control which devices can authenticate to the network. The authentication system shall be tied into the hardware asset inventory data to ensure only authorized devices can connect to the network. |      | ●    | ●    |

## Profile

Level 2
