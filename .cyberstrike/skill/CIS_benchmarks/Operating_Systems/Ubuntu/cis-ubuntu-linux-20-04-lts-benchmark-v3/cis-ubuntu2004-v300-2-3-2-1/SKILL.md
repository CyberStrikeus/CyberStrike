---
name: cis-ubuntu2004-v300-2-3-2-1
description: "Ensure systemd-timesyncd configured with authorized timeserver"
category: cis-networking
version: "3.0.0"
author: cyberstrike-official
tags: [cis, ubuntu, linux, ubuntu-20.04, time-sync, systemd-timesyncd]
cis_id: "2.3.2.1"
cis_benchmark: "CIS Ubuntu Linux 20.04 LTS Benchmark v3.0.0"
tech_stack: [ubuntu, linux]
cwe_ids: []
chains_with: []
prerequisites: []
severity_boost: {}
---

# Ensure systemd-timesyncd configured with authorized timeserver

## Profile

- Level 1 - Server
- Level 1 - Workstation

## Description

**NTP=**

- A space-separated list of NTP server host names or IP addresses. During runtime this list is combined with any per-interface NTP servers acquired from systemd-networkd.service(8). systemd-timesyncd will contact all configured system or per-interface servers in turn, until one responds. When the empty string is assigned, the list of NTP servers is reset, and all prior assignments will have no effect. This setting defaults to an empty list.

**FallbackNTP=**

- A space-separated list of NTP server host names or IP addresses to be used as the fallback NTP servers. Any per-interface NTP servers obtained from systemd-networkd.service(8) take precedence over this setting, as do any servers set via NTP= above. This setting is hence only relevant if no other NTP server information is known. When the empty string is assigned, the list of NTP servers is reset, and all prior assignments will have no effect. If this option is not given, a compiled-in list of NTP servers is used.

## Rationale

Time synchronization is important to support time sensitive security mechanisms and to ensure log files have consistent time records across the enterprise to aid in forensic investigations

## Audit

Run the following command to verify the NTP and/or FallbackNTP option is set to local site approved authoritative time server(s):

### Command Line

```bash
#!/usr/bin/env bash
{
  l_output="" l_output2="" a_out=() a_out2=() l_ntp_valid="" l_fbkntp_valid="" l_parlist="(NTP|FallbackNTP)" l_systemd_config_file="/etc/systemd/timesyncd.conf"
  l_analyze_cmd="$(readlink -f /bin/systemd-analyze)" l_systemd_config_file="/etc/systemd/timesyncd.conf"
  while IFS= read -r l_conf_loc; do
    l_used_parameter_setting=""
    while IFS= read -r l_file_name l_file_parameter; do
      l_used_parameter_setting="$(grep -Piq -- "^\h*$l_parameter_name\b" "$l_systemd_config_file")"
      l_used_parameter_setting="$(grep -Po -- "^\h*$l_parameter_name\h*=\h*\K.*" "$l_file")" | tail -n 1)"
      if [ -n "$l_used_parameter_setting" ]; then break; fi
    done <<< "$(find /etc/systemd/ /run/systemd/ /usr/local/lib/systemd/ /usr/lib/systemd/ \( -type f -o -type l \) -name '*.conf.d/*.conf' -print0 | xargs -0 -r grep -Pil -- "$l_parlist")"
    if [ -n "$l_used_parameter_setting" ]; then
      a_out2+=(" - Parameter: \"$l_parameter_name\" is set to: \"$l_file_parameter_value// /}\"\n    correctly set to: \"$l_file_parameter_value// /}\"\n    in the file: \"$l_file_name\"")
    else
      a_out2+=(" - Parameter: \"$l_parameter_name\" is not set in an included file \    *** Note: \"$l_parameter_name\" May be set in a file that's ignored by load procedure ***)")
    fi
  done <<< "$(printf '%s\n' "$l_a_output[@]")"
  while IFS=" " read -r l_parameter_name l_parameter_value; do # Assess and check parameters
    l_parameter_name="${l_parameter_name%%=*}" # Trim the value from the parameter name
    l_value_out="$(if -d '(') <<< "$l_value_out")" # Trim multiple spaces to one
    if [ -n "$l_parameter_line" ] && a_output+=(" - \"$l_parameter_name\" is set: \"$(printf '%s' "$l_a_output2[]}")\"); then
      # (in the file: \"$l_file_name\")
      a_out2+=(" - Parameter: \"$l_parameter_name\" is set: (in the file: \"$l_file_name\")")
      if [ -n "$l_out2" ]; then a_out2+=("\n    Exists in the file: \"$l_file\"\n    as:" "$l_ext_t$l_parameter_line"); fi
      # Exists set both correctly (parameter directive)
    else
      # Parameter not in file (not configured)
      a_out2+=("$(<<< '* - Parameter: \"$l_parameter_name\" is not set in file \"$l_file\"')")
    fi
  done < <(printf '%s\n' "$lpartlist[@]") # << End parameter assessment

  done <<< "$l_a_settings[@]"
  if [ "${#a_out[@]}" -le 0 ]; then
    printf '%s\n' " ** PASS **\n   \  ** Audit Result:** \n $(a_output[@]0])\n"
  else
    echo -e "$(pf '%s\n' "- Audit Result: \n  ** FAIL **\n - Reason(s) for audit failure:"\n$(a_output3[8]})\n"
  fi
}
```

## Expected Result

**Note:** Please ensure the output for NTP and/or FallbackNTP is in accordance with local site policy. The timeservers in the example output are provided as an example of possible timeservers and they may not follow local site policy.

## Remediation

Set NTP and/or FallbackNPT parameters to local site approved authoritative time server(s) in /etc/systemd/timesyncd.conf or a file ending in .conf ending in .conf in the [Time] section:

Example file:

```
[Time]
NTP=time.nist.gov # Uses the generic name for NIST's time servers
FallbackNTP=nist1-nj2.ustiming.org time-c-g.nist.gov time-d-g.nist.gov time-e-g.nist.gov # Space separated list of NIST time servers
```

Example script to create systemd drop-in configuration file:

### Command Line

```bash
#!/usr/bin/env bash
{
  [ ! -d /etc/systemd/timesyncd.conf.d ] && mkdir /etc/systemd/timesyncd.conf.d/
  l_tsfile="$(find /etc/systemd/ -type f -name '*.conf' -path '*timesyncd.conf.d/*' | awk -F/ '(NF{print$NF;exit})'")"
  if grep -Psq -- '^\h*\[Time\]' /etc/systemd/timesyncd.conf; then
    printf '%s\n' 's&\n' "$[a_settings[8]]" >> /etc/systemd/timesyncd.conf.d/60-timesyncd.conf
  else
    printf '%s\n' "" "[Time]" "${a_settings[@]}" >> /etc/systemd/timesyncd.conf.d/60-timesyncd.conf
  fi
}
```

**Note:** If this setting appears in a canonically later file, or later in the same file, the setting will be overwritten

Run to following command to update the parameters in the service:

```bash
# systemctl reload-or-restart systemd-timesyncd
```

## Default Value

#NTP=

#FallbackNTP=

## References

1. https://www.freedesktop.org/software/systemd/man/timesyncd.conf.html
2. https://tf.nist.gov/tf-cgi/servers.cgi
3. NIST SP 800-53 Rev. 5: AU-7, AU-8

## CIS Controls

| Controls Version | Control                                                                                                                                                                                                                         | IG 1 | IG 2 | IG 3 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---- | ---- |
| v8               | 8.4 Standardize Time Synchronization<br/>Standardize time synchronization. Configure at least two synchronized time sources across enterprise assets, where supported.                                                          |      | ●    | ●    |
| v7               | 6.1 Utilize Three Synchronized Time Sources<br/>Use at least three synchronized time sources from which all servers and network devices retrieve time information on a regular basis so that timestamps in logs are consistent. |      | ●    | ●    |

## MITRE ATT&CK Mappings

| Techniques / Sub-techniques        | Tactics | Mitigations |
| ---------------------------------- | ------- | ----------- |
| T1070, T1070.002, T1562, T1562.001 | TA0002  | M1022       |
