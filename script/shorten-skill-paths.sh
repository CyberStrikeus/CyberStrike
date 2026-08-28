#!/usr/bin/env bash
# Shorten over-long directory SEGMENTS under .cyberstrike/skill/** so paths fit
# Windows MAX_PATH. Handles both long leaf skill names (NIST) and long
# intermediate dirs (CIS benchmark folders). Skill identity is the SKILL.md
# frontmatter `name`, not the path, so `git mv` on directories is safe.
#
# Usage: shorten-skill-paths.sh [CAP]     CAP = max chars per dir segment (default 40)
#        DRY=1 ... to plan only.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

CAP="${1:-40}"
DRY="${DRY:-0}"

# slugify + trim to CAP at a word boundary (avoid ugly mid-word cuts)
slug() {
  local s
  s=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -E 's/^-+//; s/-+$//')
  if [ ${#s} -gt "$CAP" ]; then
    s=${s:0:$CAP}
    s=${s%-*}                      # cut back to last '-' (word boundary)
    [ ${#s} -lt $((CAP/2)) ] && s=${s:0:$CAP}   # unless that loses too much
    s=$(printf '%s' "$s" | sed -E 's/-+$//')
  fi
  [ -z "$s" ] && s=dir
  printf '%s' "$s"
}

# All files (NUL-safe), then derive every unique ancestor dir under the skill root.
mapfile -d '' -t FILES < <(git ls-files -z -- '.cyberstrike/skill/')
declare -A DSET=()
for f in "${FILES[@]}"; do
  d=${f%/*}
  while :; do
    case "$d" in .cyberstrike/skill|.cyberstrike|"" ) break;; esac
    DSET["$d"]=1
    d=${d%/*}
  done
done

# Dirs whose basename exceeds CAP, shallowest-first.
declare -a ROWS=()
for d in "${!DSET[@]}"; do
  b=${d##*/}
  [ ${#b} -gt "$CAP" ] || continue
  s=${d//[!\/]/}
  ROWS+=("${#s}"$'\t'"$d")
done
mapfile -t LONGDIRS < <(printf '%s\n' "${ROWS[@]}" | sort -n -k1,1 | cut -f2-)

declare -A MAP=()   # original dir -> current dir
declare -A SIB=()   # reserved parent/newbase

resolve() {
  local orig="$1" cur="" op="" part
  IFS='/' read -ra segs <<<"$orig"
  for part in "${segs[@]}"; do
    op="${op:+$op/}$part"
    if [ -n "${MAP[$op]:-}" ]; then cur="${MAP[$op]}"; else cur="${cur:+$cur/}$part"; fi
  done
  printf '%s' "$cur"
}

count=0
for orig in "${LONGDIRS[@]}"; do
  curfull=$(resolve "$orig")
  curparent=${curfull%/*}
  base=${orig##*/}
  nb=$(slug "$base")
  key="$curparent/$nb"
  if [ -n "${SIB[$key]:-}" ]; then
    h=$(printf '%s' "$base" | shasum | cut -c1-6)
    nb="${nb:0:$((CAP-7))}"; nb=$(printf '%s' "$nb" | sed -E 's/-+$//'); nb="${nb}-${h}"; key="$curparent/$nb"
  fi
  SIB[$key]=1
  newfull="$curparent/$nb"
  MAP[$orig]="$newfull"
  [ "$curfull" = "$newfull" ] && continue
  if [ "$DRY" = 1 ]; then printf 'DRY %s\n --> %s\n' "$curfull" "$newfull"; else git mv "$curfull" "$newfull"; fi
  count=$((count+1))
done
echo "renamed dirs: $count (CAP=$CAP)"
