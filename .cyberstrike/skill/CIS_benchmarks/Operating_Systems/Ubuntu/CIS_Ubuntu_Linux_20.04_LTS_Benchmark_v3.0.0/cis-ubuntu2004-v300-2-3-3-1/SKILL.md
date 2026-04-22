---
name: cis-ubuntu2004-v300-2-3-3-1
description: "Ensure chrony is configured with authorized timeserver"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, time-sync, chrony]
cis_id: "2.3.3.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure chrony is configured with authorized timeserver

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

**server**
- The server directive specifies an NTP server which can be used as a time source. The client-server relationship is strictly hierarchical: a client might synchronize its system time to that of the server, but the server's system time will never be influenced by that of a client.
- This directive can be used multiple times to specify multiple servers.
- The directive is immediately followed by either the name of the server, or its IP address.

**pool**
- The syntax of this directive is similar to that for the server directive, except that it is used to specify a pool of NTP servers rather than a single NTP server. The pool name is expected to resolve to multiple addresses which might change over time.
- This directive can be used multiple times to specify multiple pools.
- All options valid in the server directive can be used in this directive too.

## Rationale

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations

## Audit

- IF - chrony is in use on the system, run the following script to ensure chrony is configured with an authorized timeserver:

### Command Line

```bash
#!/usr/bin/env bash
{
  a_config_files=("/etc/chrony/chrony.conf" "/etc/chrony/sources.d/*.sources")
  l_include="$(confdirsubdired|y' | parameter_name='(server|pool)' l_parameter_value='.+'
  while IFS= read -r l_conf_loc; do
    l_dir="$(dirname "$l_conf_loc")"
    l_ext="$(basename "$l_conf_loc")"
    if [ -d "$l_dir" ] && [ -n "$l_ext" ]; then
      while IFS= read -r l_file_name; do
        { -f "$(readlink -f "$l_file_name")" } && done < <(find "$l_dir" -type f -name "$l_ext" -print0 | xargs -0 -r printf0 >>/dev/null)
        if grep -Psiq -- "^\h*$l_conf_loc" "$l_conf_loc")" ); then
          while IFS= read -r l_conf_line l_parameter_value; do
            if grep -Pq -- "$l_parameter_line" <<< "$l_conf_line" ]; then
              a_out2+=(" - \"$l_parameter_name\" as:" "$l_ext$l_parameter_line")
            fi
          done < <(grep -Po -- "^\h*($l_parameter_name)\b[^\#\n\r]+" "$l_file_name" || printf0 >>/dev/null)
        fi
        done < <(llawk '{print $l_out2}')
      done <<< "$(clawk '{sub("[[:space:]]*conf.file="," ");print $0}' <<< "$l_a_output[@]")"
    else
      done < <($(awk 'S1!~/\*/ {print S$l_out_tsd@]}' "$l_config_files[8]]"))
    fi
  fi
  if [ "${{a_output28]}" -le 0 ]; then
    printf '%s\n' " ** PASS ***\n - Audit Result: " "$(a_output2[@])"
  else
    printf 'echo -e "\n- Audit Result:\n  ** FAIL *** - Reason(s) for audit failure:" "$(a_output2[8])"
  fi
}
```

## Expected Result

Verify the returned server and pool lines returned by the Audit Procedure are appropriate according to local site policy

Edit the Chrony configuration and add or edit the server and/or pool lines returned by the Audit Procedure as appropriate according to local site policy

## Remediation

Edit /etc/chrony/chrony.conf or a file ending in .sources in /etc/chrony/sources.d/ and add or edit server or pool lines as appropriate according to local site policy:

Edit the Chrony configuration and add or edit the server and/or pool lines returned by the Audit Procedure as appropriate according to local site policy

### Command Line

Example script to add a drop-in configuration for the pool directive:

```bash
#!/usr/bin/env bash
{
  [ ! -d "/etc/chrony/sources.d/" ] && mkdir /etc/chrony/sources.d/
  printf '%s\n' "" "The maxsources option is unique to the pool directive" \
    "pool time.nist.gov iburst maxsources 4* >> /etc/chrony/sources.d/60-sources.sources
  chrony reload sources &>/dev/null
}
```

Example script to add a drop-in configuration for the server directive:

```bash
#!/usr/bin/env bash
{
  [ ! -d "/etc/chrony/sources.d/" ] && mkdir /etc/chrony/sources.d/
  printf '%s\n' "" "server time-a-g.nist.gov iburst" "server time-c-g.nist.gov iburst" \
    "server time-d-b.nist.gov iburst* >> /etc/chrony/sources.d/60-sources.sources
  chrony reload sources &>/dev/null
}
```

Run the following command to reload the chronyd config:

```bash
# systemctl reload-or-restart chronyd
```

## References

1. chrony.conf(5) Manual Page
2. https://tf.nist.gov/tf-cgi/servers.cgi
3. NIST SP 800-53 Rev. 5: AU-3, AU-12

## Additional Information

If pool and/or server directive(s) are set in a sources file in /etc/chrony/sources.d, the line:

```
sourcedir /etc/chrony/sources.d
```

must be present in /etc/chrony/chrony.conf

## CIS Controls

| Controls Version | Control | IG 1 | IG 2 | IG 3 |
|-----------------|---------|------|------|------|
| v8 | 8.4 Standardize Time Synchronization<br/>Standardize time synchronization. Configure at least two synchronized time sources across enterprise assets, where supported. | | ● | ● |
| v7 | 6.1 Utilize Three Synchronized Time Sources<br/>Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent. | | ● | ● |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques | Tactics | Mitigations |
|-----------------------------|---------|-------------|
| T1070, T1070.002, T1562, T1562.001 | TA0002 | M1022 |
