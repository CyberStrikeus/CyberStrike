---
name: cis-tomcat8-v110-10.19
description: "Ensure Manager Application Passwords are Encrypted (Manual)"
category: cis-tomcat
version: "1.1.0"
author: cyberstrike-official
tags: [cis, tomcat, linux, java, configuration, manager, security, password]
cis_id: "10.19"
cis_benchmark: "CIS Apache Tomcat 8 Benchmark v1.1.0"
tech_stack: [linux, tomcat, java]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 10.19 Ensure Manager Application Passwords are Encrypted (Manual)

## Description

Apache Tomcat ships with a Manager Application which requires users with a role of `manager-gui`, `manager-status`, `manager-script`, and/or `manager-jmx` to authenticate. The usernames and passwords to log onto the Manager Application are stored in the `tomcat-users.xml` in plain text by default.

## Rationale

Storing passwords in plain text may allow users with access to read the `tomcat-users.xml` file to obtain the credentials of user who have been assigned roles for the Manager Application. This may allow for accounts to be compromised on Tomcat and elsewhere.

## Audit Procedure

Perform the following to determine if password digests are in use:

```bash
$ grep -i <login-config>|.\n|*<auth-method>DIGEST</auth-method>|.\n] *<realm-
name>UserDatabase</realm-name>:.\n|*</login-config>
$CATALINA_HOME/webapps/manager/WEB-INF/web.xml
```

If a Realm exists without a `digest` attribute or without a value for the `digest` attribute, this is a fail.

## Remediation

1. Generate the encrypted password:

```bash
cd $CATALINA_HOME/bin
digest.bat -a sha-256 YOURPASSWORD
```

This will return the original password followed by encrypted password:

```
YOURPASSWORD:240be518fabd27724db6f04eeb1da5967e31c72a9
c720a9
```

2. Replace the plain text password with the above encrypted password generated above in `CATALINA_HOME/conf/tomcat-user.xml` file as follows.

## Default Value

## References

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                                                                                 | IG 1 | IG 2 | IG 3 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.5 Collect Detailed Audit Logs<br>Configure detailed audit logging for enterprise assets containing sensitive data. Include event source, date, username, timestamp, source addresses, destination addresses, and other useful elements that could assist in a forensic investigation. |      | ●    | ●    |
| v7               | 6.3 Enable Detailed Logging<br>Enable system logging to include detailed information such as an event source, date, user, timestamp, source addresses, destination addresses, and other useful elements.                                                                                |      | ●    | ●    |

## Profile

Level 1
