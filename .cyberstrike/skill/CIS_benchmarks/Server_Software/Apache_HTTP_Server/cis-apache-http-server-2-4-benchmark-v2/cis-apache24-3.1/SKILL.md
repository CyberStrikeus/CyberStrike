---
name: cis-apache24-3.1
description: "Ensure the Apache Web Server Runs As a Non-Root User"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, privileges, permissions, ownership, user]
cis_id: "3.1"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# 3.1 Ensure the Apache Web Server Runs As a Non-Root User (Automated)

## Profile Applicability

- Level 1

## Description

Although Apache is typically started with root privileges in order to listen on port 80 and 443, it can and should run as another non-root user in order to perform the web services. The Apache User and Group directives are used to designate the user and group that the Apache worker processes will assume.

## Rationale

One of the best ways to reduce your exposure to attack when running a web server is to create a unique, unprivileged user and group for the server application. The nobody or daemon user and group that comes default on Unix variants should NOT be used to run the web server, since the account may be commonly used for other separate daemon services. Instead, an account used only by the apache software so as to not give unnecessary access to other services. Also, the identifier used for the apache user should be a unique system account. System user accounts UID numbers have lower values which are reserved for the special system accounts not used by regular users, such as discussed in User Accounts section of the CIS Red Hat benchmark. Typically, system accounts numbers range from 1-999, or 1-499 and are defined in the /etc/login.defs file.

As an even more secure alternative, if the Apache web server can be run on high unprivileged ports, then it is not necessary to start Apache as root, and all of the Apache processes may be run as the Apache specific user as described below.

## Audit

Ensure the apache account is unique and has been created with a UID less than the minimum normal user account with the Apache group and configured in the httpd.conf file.

1. Ensure the User and Group directives are present in the Apache configuration and not commented out:
   - `# grep -i '^User' $APACHE_PREFIX/conf/httpd.conf`
   - `User apache`
   - `# grep -i '^Group' $APACHE_PREFIX/conf/httpd.conf`
   - `Group apache`
2. Ensure the Apache account UID is correct:
   - `# grep '^UID_MIN' /etc/login.defs`
   - `# id apache`

The UID must be less than the UID_MIN value in /etc/login.defs, and group of apache similar to the following entries:

```
UID_MIN       1000
uid=48(apache) gid=48(apache) groups=48(apache)
```

9. While the web server is running, check the user id for the httpd processes. The user name should match the configuration file.
   - `# ps axu | grep httpd | grep -v '^root'`

## Remediation

Perform the following:

1. If the apache user and group do not already exist, create the account and group as a unique system account:
   - `# groupadd -r apache`
   - `# useradd apache -r -g apache -d /var/www -s /sbin/nologin`
2. Configure the Apache user and group in the Apache configuration file httpd.conf:
   - `User apache`
   - `Group apache`

## Default Value

The default Apache user and group are configured as daemon.

## CIS Controls

- v8: 6.8 Define and Maintain Role-Based Access Control
- v7: 4.3 Ensure the Use of Dedicated Administrative Accounts

## Profile

- Level 1
