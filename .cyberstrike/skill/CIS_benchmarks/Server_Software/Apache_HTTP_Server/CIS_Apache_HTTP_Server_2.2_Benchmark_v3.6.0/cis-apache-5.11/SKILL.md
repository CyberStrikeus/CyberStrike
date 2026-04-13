---
name: cis-apache-5.11
description: "Ensure Access to Inappropriate File Extensions Is Restricted"
category: cis-apache
version: "3.6.0"
author: cyberstrike-official
tags: [cis, apache, linux, features, content]
cis_id: "5.11"
cis_benchmark: "CIS Apache HTTP Server 2.2 Benchmark v3.6.0"
tech_stack: [linux, apache]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure Access to Inappropriate File Extensions Is Restricted

## Description

Restrict access to inappropriate file extensions that are not expected to be a legitimate part of web sites using the `FilesMatch` directive.

## Rationale

There are many files that are often left within the web server document root that could provide an attacker with sensitive information. Most often these files are mistakenly left behind after installation, troubleshooting, or backing up files before editing. Regardless of the reason for their creation, these files can still be served by Apache even when there is no hyperlink pointing to them. The web administrators should use the `FilesMatch` directive to restrict access to only those file extensions that are appropriate for the web server. Rather than create a blacklist of potentially inappropriate file extensions such as `.bak`, `.config`, `.old`, etc., it is recommended instead that a whitelist of the appropriate and expected file extensions for the web server be created, reviewed, and enforced with a `FilesMatch` directive.

## Audit Procedure

Perform the following steps to determine if the recommended state is implemented:

1. Verify that the `FilesMatch` directive that denies access to all files is present as shown in step 3 of the remediation with the order of `Deny`, `Allow`.
2. Verify that there is another `FilesMatch` directive similar to the one in step 4 of the remediation, with an expression that matches the approved file extensions.

## Remediation

Perform the following to implement the recommended state:

1. Compile a list of existing file extensions on the web server. The following `find`/`awk` command may be useful but is likely to need some customization according to the appropriate webroot directories for your web server. Please note that the find command skips over any files without a dot (.) in the filename, as these are not expected to be appropriate web content.

```
find */htdocs -type f -name '*.*' | awk -F. '{print $NF}' | sort -u
```

2. Review the list of existing file extensions. Remove those that are inappropriate and add any appropriate file extensions expected to be added to the web server in the near future.
3. Add the `FilesMatch` directive below, which denies access to all files by default.

```
# Block all files by default, unless specifically allowed.
<FilesMatch "^.*$">
  Order Deny,Allow
  Deny from all
</FilesMatch>
```

4. Add another `FilesMatch` directive that allows access to those file extensions specifically allowed from the review process in step 2. An example `FilesMatch` directive is below. The file extensions in the regular expression should match your approved list, and not necessarily the expression below.

```
# Allow files with specifically approved file extensions
# Such as (css, htm; html; js; pdf; txt; xml; xsl; ...),
# images (gif; ico; jpeg; jpg; png; ...), multimedia
<FilesMatch "^.*\.(css|html?|js|pdf|txt|xml|xsl|gif|ico|jpe?g|png)$">
  Order Deny,Allow
  Allow from all
</FilesMatch>
```

## Default Value

There are no restrictions on file extensions in the default configuration.

## References

1. https://httpd.apache.org/docs/2.2/mod/core.html#filesmatch

## CIS Controls

**Version 6**

18.3 Sanitize Input For In-house Software
For in-house developed software, ensure that explicit error checking is performed and documented for all input, including for size, data type, and acceptable ranges or formats.

**Version 7**

18.2 Ensure Explicit Error Checking is Performed for All In-house Developed Software
For in-house developed software, ensure that explicit error checking is performed and documented for all input, including for size, data type, and acceptable ranges or formats.

## Profile

Level 2 | Scored
