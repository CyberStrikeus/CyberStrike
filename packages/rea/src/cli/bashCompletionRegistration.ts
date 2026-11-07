/** Register Incur's dynamic Bash protocol, including macOS system Bash 3.2. */
export const bashCompletionScript = (name: string): string => {
  const id = name.replace(/[^a-zA-Z0-9_]/gu, "_");
  const command = `'${name.replaceAll("'", "'\\''")}'`;
  return `_incur_complete_${id}() {
    local IFS=$'\\013'
    local _COMPLETE_INDEX=\${COMP_CWORD}
    local _completions
    _completions=( $(
        export COMPLETE="bash"
        export _COMPLETE_INDEX="$_COMPLETE_INDEX"
        ${command} -- "\${COMP_WORDS[@]}"
    ) )
    if [[ $? != 0 ]]; then
        unset COMPREPLY
        return
    fi
    local _nospace=false
    local _nospace_marker=$'\\001'
    local _c
    COMPREPLY=()
    for _c in "\${_completions[@]}"; do
        if [[ "$_c" == *"$_nospace_marker" ]]; then
            _nospace=true
            COMPREPLY+=("\${_c%"$_nospace_marker"}")
        else
            COMPREPLY+=("$_c")
        fi
    done
    if [[ $_nospace == true ]] && type compopt >/dev/null 2>&1; then
        compopt -o nospace
    fi
    return 0
}
complete -o default -o bashdefault -o nosort -F _incur_complete_${id} ${command} 2>/dev/null ||
    complete -o default -o bashdefault -F _incur_complete_${id} ${command}`;
};
