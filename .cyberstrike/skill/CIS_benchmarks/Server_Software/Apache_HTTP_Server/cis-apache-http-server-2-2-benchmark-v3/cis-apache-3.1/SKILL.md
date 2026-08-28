---
name: cis-apache-3.1
description: "Ensure the Apache Web Server Runs As a Non-Root User"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership]
cis_id: "3.1"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure the Apache Web Server Runs As a Non-Root User

## Description

Although Apache is typically started with root privileges in order to listen on port 80 and 443, it can and should run as another non-root user in order to perform the web services. The Apache User and Group directives are used to designate the user and group to be used.

## Rationale

One of the best ways to reduce your exposure to attack when running a web server is to create a unique, unprivileged user and group for the server application. The `nobody` or `daemon` user and group that come with most Unix variants should NOT be used to run the web server because the account is commonly used for other separate daemon services. Instead, an account should be used only by the Apache software so as to not give unnecessary access to other services. Also, the user used for the Apache user should be a unique value between 1 and 499, as these lower values are reserved for the special system accounts not used by regular users, as discussed in the User Accounts section of the CIS Red Hat benchmark.

As an even more secure alternative, if the Apache web server can be run on high unprivileged ports, it is not necessary to start Apache as root, and all the Apache processes may be run as the Apache specific user, as described below.

## Impact

None documented

## Audit Procedure

Ensure the apache account is unique and has been created with a UID between 1-499 with the Apache group and configured in the httpd.conf file.

1. Ensure the following lines are present in the Apache configuration and not commented out:

```
# grep -i '^User' $APACHE_PREFIX/conf/httpd.conf
User apache
# grep -i '^Group' $APACHE_PREFIX/conf/httpd.conf
Group apache
```

2. Ensure the Apache account is correct:

```
# grep '^UID_MIN' /etc/login.defs
# id apache
```

The 'uid' must be less than the UID_MIN value in `/etc/login.defs`, and the group for apache must be similar to the following entries:

```
uid=48(apache) gid=48(apache) groups=48(apache)
```

3. While the web server is running, check the user id for the httpd processes. The username should match the configuration file.

```
# ps axu | grep httpd | grep -v '^root'
```

## Remediation

Perform the following:

1. If the Apache user and group do not already exist, create the account and group as a unique system account:

```
# groupadd -r apache
# useradd apache -r -g apache -d /var/www -s /sbin/nologin
```

2. Configure the Apache user and group in the Apache configuration file httpd.conf:

```
User apache
Group apache
```

## Default Value

The default Apache user and group are configured as 'daemon'.

## References

None documented

## CIS Controls

### Version 6

5.1 Minimize And Sparingly Use Administrative Privileges

Minimize administrative privileges and only use administrative accounts when they are required. Implement focused auditing on the use of administrative privileged functions and monitor for anomalous behavior.

### Version 7

4.3 Ensure the Use of Dedicated Administrative Accounts

Ensure that all users with administrative account access use a dedicated or secondary account for elevated activities. This account should only be used for administrative activities and not internet browsing, email, or similar activities.

## Profile

Level 1 | Scored
