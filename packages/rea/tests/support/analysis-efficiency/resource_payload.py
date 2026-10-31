"""Observe a finished payload while its owned cgroup observer is still alive."""

import json
import os
from pathlib import Path
import subprocess
import sys
import time


def pairs(path):
    values = {}
    for line in path.read_text().splitlines():
        name, value = line.split()
        number = int(value)
        if number < 0 or name in values:
            raise ValueError('Invalid kernel counter')
        values[name] = number
    return values


def snapshot(group, token, code):
    actors = [int(line) for line in (group / 'cgroup.procs').read_text().splitlines()]
    observer = os.getpid()
    return {
        'phase': 'payload-exited-observer-alive', 'ownership_token': token,
        'payload_exit_code': code, 'observer_pid': observer,
        'remaining_processes': actors, 'payload_cleanup_verified': actors == [observer],
        'resource_events': {name: pairs(group / name)
                            for name in ['memory.events', 'pids.events']},
        'cpu_stat': pairs(group / 'cpu.stat'),
        'memory_peak_bytes': int((group / 'memory.peak').read_text()),
        'control_group': str(group.relative_to('/sys/fs/cgroup')),
    }


def read_observation(path, token):
    """Validate the observer receipt; missing/malformed witnesses stay unknown."""
    try:
        if path.is_symlink():
            return None
        value = json.loads(path.read_text())
        if not isinstance(value, dict) or value.get('ownership_token') != token:
            return None
        if value.get('phase') != 'payload-exited-observer-alive':
            return None
        if not isinstance(value.get('control_group'), str) or not value['control_group']:
            return None
        for name in ['payload_exit_code', 'observer_pid', 'memory_peak_bytes']:
            if type(value.get(name)) is not int:
                return None
        if value['observer_pid'] <= 0 or value['memory_peak_bytes'] < 0:
            return None
        actors = value.get('remaining_processes')
        if not isinstance(actors, list) or any(type(x) is not int or x <= 0 for x in actors):
            return None
        if type(value.get('payload_cleanup_verified')) is not bool:
            return None
        if value['payload_cleanup_verified'] != (actors == [value['observer_pid']]):
            return None
        required = {'memory.events': ['high', 'max', 'oom', 'oom_kill'],
                    'pids.events': ['max']}
        events = value.get('resource_events')
        if not isinstance(events, dict):
            return None
        for name, keys in required.items():
            record = events.get(name)
            if not isinstance(record, dict) or any(key not in record for key in keys):
                return None
            if any(type(x) is not int or x < 0 for x in record.values()):
                return None
        cpu = value.get('cpu_stat')
        if not isinstance(cpu, dict) or 'usage_usec' not in cpu:
            return None
        if any(type(x) is not int or x < 0 for x in cpu.values()):
            return None
        names = ['phase', 'ownership_token', 'payload_exit_code', 'observer_pid',
                 'remaining_processes', 'payload_cleanup_verified',
                 'cpu_stat', 'memory_peak_bytes', 'control_group']
        return {**{name: value[name] for name in names},
                'resource_events': {name: events[name] for name in required}}
    except (OSError, ValueError, TypeError):
        return None


def main():
    output, release, token = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    command = sys.argv[4:]
    if not command:
        raise SystemExit('Missing explicit payload command')
    child = subprocess.Popen(command)
    code = child.wait()
    paths = [line[3:] for line in Path('/proc/self/cgroup').read_text().splitlines()
             if line.startswith('0::')]
    try:
        if len(paths) != 1:
            raise ValueError('Expected one unified cgroup')
        group = Path('/sys/fs/cgroup') / paths[0].lstrip('/')
        observation = snapshot(group, token, code)
        with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600),
                       'w') as file:
            json.dump(observation, file)
        # Keep the owner alive until its supervisor acknowledges the receipt.
        # Bound a broken supervisor by the existing ten-second cleanup interval.
        deadline = time.monotonic() + 10
        while not release.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
    except (OSError, ValueError) as error:
        print('Payload counter observation unavailable: ' + type(error).__name__, file=sys.stderr)
    raise SystemExit(code if code >= 0 else 128 - code)


if __name__ == '__main__':
    main()
