#!/usr/bin/env bash
# Host-side orchestration. Root is used only to stage/read files and send the
# intent; TermuxService launches all package/build/browser work as the app UID.
set -euo pipefail

staging="${RUNNER_TEMP:?}/rea-termux"
app_home=/data/data/com.termux/files/home
prefix=/data/data/com.termux/files/usr
mkdir -p "$staging/diagnostics"
collect_diagnostics() {
  adb logcat -d > "$staging/diagnostics/logcat.txt" 2>&1 || true
  adb exec-out cat "$app_home/rea-ci/run.log" > "$staging/diagnostics/termux.log" 2>&1 || true
  adb exec-out cat "$app_home/rea-ci/status" > "$staging/diagnostics/status.txt" 2>&1 || true
}
trap collect_diagnostics EXIT

adb root
adb wait-for-device
adb install "$staging/termux-app_v0.118.3+github-debug_x86_64.apk"
adb shell am start -n com.termux/.app.TermuxActivity
# First launch unpacks the APK's bundled bootstrap. Do not replace it with a
# root-installed userland: that would miss Termux's own initialization.
deadline=$((SECONDS + 180))
until adb shell test -x "$prefix/bin/bash"; do
  if (( SECONDS >= deadline )); then
    echo 'Termux bootstrap did not finish within 180 seconds' >&2
    exit 1
  fi
  sleep 2
done

git archive --format=tar HEAD > "$staging/source.tar"
adb push "$staging/source.tar" /data/local/tmp/rea-source.tar
adb push scripts/verify/termux/in-app.sh /data/local/tmp/rea-in-app.sh
adb shell chmod 644 /data/local/tmp/rea-source.tar /data/local/tmp/rea-in-app.sh
app_uid=$(adb shell stat -c %u /data/data/com.termux | tr -d '\r')
[[ "$app_uid" =~ ^[0-9]+$ && "$app_uid" != 0 ]]
adb shell mkdir -p "$app_home/rea-ci" "$app_home/.termux"
adb shell "echo allow-external-apps=true > $app_home/.termux/termux.properties"
adb shell cp /data/local/tmp/rea-in-app.sh "$app_home/rea-ci/in-app.sh"
adb shell cp /data/local/tmp/rea-source.tar "$app_home/rea-ci/source.tar"
adb shell chown -R "$app_uid:$app_uid" "$app_home/rea-ci" "$app_home/.termux"
adb shell restorecon -RF "$app_home/rea-ci" "$app_home/.termux"
# Reload the external-command policy in a fresh app process before sending it.
adb shell am force-stop com.termux
adb shell am start -n com.termux/.app.TermuxActivity
# Root may send this permission-protected intent; the service executes as the
# application, rather than running Node/Chromium through adb shell or su.
adb shell am startservice \
  -n com.termux/.app.RunCommandService \
  -a com.termux.RUN_COMMAND \
  --es com.termux.RUN_COMMAND_PATH "$prefix/bin/bash" \
  --esa com.termux.RUN_COMMAND_ARGUMENTS "-l,$app_home/rea-ci/in-app.sh" \
  --es com.termux.RUN_COMMAND_WORKDIR "$app_home" \
  --ez com.termux.RUN_COMMAND_BACKGROUND true

deadline=$((SECONDS + 2100))
until adb shell test -f "$app_home/rea-ci/status"; do
  if (( SECONDS >= deadline )); then
    echo 'Termux verification exceeded 35 minutes' >&2
    exit 1
  fi
  sleep 5
done
adb exec-out cat "$app_home/rea-ci/run.log"
status=$(adb shell cat "$app_home/rea-ci/status" | tr -d '\r')
[[ "$status" == 0 ]]
