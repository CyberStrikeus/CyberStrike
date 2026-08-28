---
name: cis-apache24-7.9
description: "Ensure All Web Content is Accessed via HTTPS (Manual)"
category: cis-apache
version: "2.3.0"
author: cyberstrike-official
tags: [cis, apache, linux, ssl, tls, https, redirect]
cis_id: "7.9"
cis_benchmark: "CIS Apache HTTP Server 2.4 Benchmark v2.3.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure All Web Content is Accessed via HTTPS (Manual)

## Profile Applicability

- Level 1

## Description

All of the website content should be served via HTTPS rather than HTTP. A redirect from the HTTP website to the HTTPS content is often useful and is recommended, but all significant content should be accessed via HTTPS so that it is authenticated and encrypted.

## Rationale

The usage of clear text HTTP prevents the client browser from authenticating the connection and ensuring the integrity of the website information. Without the HTTPS authentication, a client may be subjected to a variety of man-in-the-middle and spoofing attacks which would cause them to receive modified web content which could harm the organization's reputation. Through DNS attacks or malicious redirects, the client could arrive at a malicious website instead of the intended website. The malicious website could deliver malware, request credentials, or deliver false information.

## Audit

Perform the following to determine if the recommended state is implemented:

- Gather the list of listening IP addresses from the Apache configuration files. The commands below may be used to extract the relevant IP addresses from the configuration files. The `CONF_DIRS` needs to be set to the list of directories that contain all of the Apache configuration files.
  - `## Replace the following directory list with the appropriate list.`
  - `CONF_DIRS="/etc/httpd/conf /etc/httpd/conf.d /etc/httpd/conf.d2 . . ."`
  - `CONFS=$(find $CONF_DIRS -type f -name '*.conf' )`
  - `## Search for Listen directives that are not port :443 or https`
  - `IPS=$(egrep -ih '^\s*Listen ' $CONFS | egrep -iv '(:443\b)|https' | cut -d' ' -f2)`
- Gather the list of virtual host names from the Apache configuration files. The commands below can be used to extract the relevant virtual host names from the configuration files listed in `$CONFS`. The resulting list will include all virtual hosts not running on port :443. Although some listed virtual hosts may be TLS enabled, but on a non-standard port. Such websites will return an error rather than HTML content, as shown in the final steps.
  - `## Get host names and ports of all of the virtual hosts`
  - `VHOSTS=$(egrep -iho '^\s*<VirtualHost .*>' $CONFS | egrep -io '\s+[A-Z:.0-9]+>' | \tr -d ' >' | \)`
- For each of the IP address and virtual hosts name, prefix the IP address or host name with the `http://` protocol and then a slash as well.
  - `URL=$'for h in $LIPADDR $VHOSTS ; do echo "http://$h/"; done)'`
  - Check to ensure each URL does not deliver significate web content via the HTTP protocol. The URL's may be manually entered in a browser for testing, or may be scripted with a command line web client such as curl, as shown below.
  - `## For each of the URL's test with curl, and truncate the output to 300 characters`
  - `for u in $URLS ; do echo -e "\n\n\n=== $u ==="; curl -fSs $u | head -c 300 ; done`

Any URLs which return significant HTML document content, rather than a redirect or an error are not compliant. Two compliant examples are shown; the first one has a redirect.

```html
=== http://www.cisecurity.org/ ===
<!DOCTYPE html PUBLIC "-//IETF//DTD HTML 2.0//EN">
<html>
  <head>
    <title>301 Moved Permanently</title>
  </head>
  <body>
    <h1>Moved Permanently</h1>
    <p>The document has moved <a href="https://www.cisecurity.org/">here</a>.</p>
  </body>
</html>
```

This compliant example below returns an error, due to using HTTP on a HTTPS website.

```
=== http://www.example.com:4430/ ===
curl: (22) The requested URL returned error: 400 Bad Request
```

## Remediation

Perform the following to implement the recommended state:

Move the web content to a TLS enabled website, and add an HTTP `Redirect` directive to the Apache configuration file to redirect to the TLS enabled website similar to the example shown.

```apache
Redirect permanent / https://www.cisecurity.org/
```

## Default Value

The following are the default values:

TLS is not enabled by default.

## References

1. https://httpd.apache.org/docs/2.4/mod/mod_ssl.html

## CIS Controls

**v8:**

- 3.10 Encrypt Sensitive Data in Transit
  - Encrypt sensitive data in transit. Example implementations can include: Transport Layer Security (TLS) and Open Secure Shell (OpenSSH).

**v7:**

- 11 Secure Configuration for Network Devices, such as Firewalls, Routers and Switches
  - Secure Configuration for Network Devices, such as Firewalls, Routers and Switches
- 14.4 Encrypt All Sensitive Information in Transit
  - Encrypt all sensitive information in transit.

## Profile

- Level 1
