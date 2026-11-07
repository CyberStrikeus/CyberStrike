"""Run one owned experiment in a bounded, transient Linux systemd scope."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

from resource_payload import read_observation


def available_bytes():
    for line in Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    raise RuntimeError('MemAvailable unavailable')


def scope_has_processes(group):
    if group is None:
        return False
    try:
        return bool((group / 'cgroup.procs').read_text().strip())
    except FileNotFoundError:
        return False


def final_resource_events(group):
    """An exited transient cgroup may disappear; missing counters are unknown."""
    if group is None:
        return None
    try:
        result = {name: dict((key, int(value)) for key, value in
                            (line.split() for line in (group / name).read_text().splitlines()))
                  for name in ['memory.events', 'pids.events']}
    except (OSError, ValueError):
        return None
    required = {'memory.events': ['high', 'max', 'oom', 'oom_kill'],
                'pids.events': ['max']}
    if not all(all(key in result[name] for key in keys)
               for name, keys in required.items()):
        return None
    return result


def stop_owned_scope(unit, process, group):
    subprocess.run(['systemctl', '--user', 'stop', '--no-block', unit],
                   check=False, timeout=5)
    for attempt in range(2):
        deadline = time.monotonic() + 10
        while process.poll() is None or scope_has_processes(group):
            if time.monotonic() >= deadline:
                break
            time.sleep(0.1)
        else:
            return
        if attempt == 1:
            raise RuntimeError('Cleanup unverified; retain owned scope ' + unit)
        subprocess.run(['systemctl', '--user', 'kill', '--kill-who=all',
                        '--signal=SIGKILL', unit], check=False, timeout=5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--task-ceiling', type=int, default=192)
    parser.add_argument('--observe-payload-exit', action='store_true',
                        help='Observe payload-exit counters before the cgroup observer exits')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    options = parser.parse_args()
    if options.task_ceiling <= 0:
        parser.error('--task-ceiling must be positive')
    if options.observe_payload_exit and options.task_ceiling < 2:
        parser.error('--observe-payload-exit requires capacity for the observer and payload (at least 2 tasks)')
    args = options.command
    if args and args[0] == '--':
        args = args[1:]
    if not args:
        raise SystemExit('Usage: resource-run.py -- COMMAND ARGS...')
    gib = 1024 ** 3
    if available_bytes() < 8 * gib:
        raise SystemExit('Refusing experiment: less than 8 GiB available')
    unit = 'rea-efficiency-' + uuid.uuid4().hex + '.scope'
    cpu = max(os.sched_getaffinity(0))
    receipt_root = tempfile.TemporaryDirectory(prefix='rea-payload-counters-') if options.observe_payload_exit else None
    receipt_path = Path(receipt_root.name) / 'observation.json' if receipt_root else None
    release_path = Path(receipt_root.name) / 'release' if receipt_root else None
    payload = args if receipt_root is None else [
        sys.executable, str(Path(__file__).with_name('resource_payload.py')),
        str(receipt_path), str(release_path), unit, *args,
    ]
    command = [
        'systemd-run', '--user', '--scope', '--unit=' + unit,
        '-p', 'MemoryMax=4G', '-p', 'MemoryHigh=3G', '-p', 'MemorySwapMax=0',
        '-p', 'CPUQuota=100%', '-p', 'TasksMax=' + str(options.task_ceiling),
        'taskset', '-c', str(cpu), *payload,
    ]
    observer_sources = {
        name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
        for name in ['resource-run.py', 'resource_payload.py']
    } if options.observe_payload_exit else None
    try:
        process = subprocess.Popen(command)
    except BaseException:
        if receipt_root is not None:
            receipt_root.cleanup()
        raise
    peak = 0
    peak_tasks = 0
    events = {}
    cpu_stats = {}
    abort = None
    final_events = None
    payload_observation = None
    payload_group = None
    code = None
    group = None
    started = time.monotonic()
    try:
        while process.poll() is None:
            if group is None:
                reply = subprocess.run(
                    ['systemctl', '--user', 'show', unit, '--value',
                     '--property=ControlGroup'],
                    capture_output=True, text=True, check=False,
                )
                path = reply.stdout.strip()
                if path:
                    group = Path('/sys/fs/cgroup') / path.lstrip('/')
            if receipt_path is not None and payload_observation is None and group is not None:
                candidate = read_observation(receipt_path, unit)
                if candidate is not None:
                    payload_observation = candidate
                    if candidate['control_group'] == str(group.relative_to('/sys/fs/cgroup')):
                        try:
                            actors = [int(x) for x in (group / 'cgroup.procs').read_text().splitlines()]
                            if candidate['observer_pid'] in actors:
                                payload_group = group
                        except (OSError, ValueError):
                            pass
                    release_path.touch(exist_ok=False)
            current = group / 'memory.current' if group else None
            if current and current.exists():
                try:
                    peak = max(peak, int(current.read_text()))
                    peak_tasks = max(peak_tasks, int((group / 'pids.current').read_text()))
                    cpu_stats = dict((key, int(value)) for key, value in
                                     (line.split() for line in (group / 'cpu.stat').read_text().splitlines()))
                    for event_file in ['memory.events', 'pids.events']:
                        events[event_file] = dict(
                            (key, int(value)) for key, value in
                            (line.split() for line in (group / event_file).read_text().splitlines())
                        )
                except FileNotFoundError:
                    # A completed transient scope can disappear between reads.
                    pass
            if peak > 3 * gib:
                abort = 'scope_memory_early_stop'
            elif available_bytes() < 4 * gib:
                abort = 'host_available_memory_early_stop'
            elif events.get('pids.events', {}).get('max', 0):
                abort = 'scope_task_limit_observed'
            if abort:
                stop_owned_scope(unit, process, group)
                break
            time.sleep(0.1)
        # Read while the owned group still exists, before wait/cleanup can remove it.
        final_events = final_resource_events(group)
        code = process.wait()
        if receipt_path is not None and payload_observation is None:
            payload_observation = read_observation(receipt_path, unit)
    except BaseException:
        stop_owned_scope(unit, process, group)
        raise
    finally:
        if scope_has_processes(group):
            final_events = None
            stop_owned_scope(unit, process, group)
        print(json.dumps({
            'resource_scope': unit, 'peak_cgroup_bytes_sampled': peak,
            'elapsed_seconds': round(time.monotonic() - started, 3),
            'abort': abort, 'hard_memory_bytes': 4 * gib,
            'early_stop_bytes': 3 * gib, 'cpu_quota_percent': 100,
            'cpu_affinity': [cpu],
            'task_ceiling': options.task_ceiling, 'peak_tasks_sampled': peak_tasks,
            'resource_events_last_observed': events,
            'resource_events_final': final_events,
            'resource_counters_verified': final_events is not None,
            'cpu_stat_last_observed': cpu_stats,
            **({
                'payload_resource_observation': payload_observation,
                'payload_resource_observation_verified': (
                    payload_observation is not None
                    and payload_observation['payload_cleanup_verified']
                    and payload_group is not None and abort is None
                    and code is not None
                    and (payload_observation['payload_exit_code'] if payload_observation['payload_exit_code'] >= 0
                         else 128 - payload_observation['payload_exit_code']) == code
                ),
                'payload_observation_scope': 'Counters at payload exit while observer remains alive; not final whole-scope counters.',
                'payload_observer_sources_sha256': observer_sources,
            } if options.observe_payload_exit else {}),
        }), file=sys.stderr)
        if receipt_root is not None:
            receipt_root.cleanup()
    raise SystemExit(125 if abort else code)


if __name__ == '__main__':
    main()
