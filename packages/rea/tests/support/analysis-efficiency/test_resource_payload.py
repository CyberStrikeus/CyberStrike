"""Receipt semantics; real systemd/cgroup workflows are verified separately."""

import json
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from resource_payload import read_observation


def receipt():
    return {
        'phase': 'payload-exited-observer-alive', 'ownership_token': 'own-unit',
        'payload_exit_code': 3, 'observer_pid': 100, 'remaining_processes': [100],
        'payload_cleanup_verified': True, 'memory_peak_bytes': 123,
        'control_group': 'user.slice/own-unit.scope',
        'resource_events': {'memory.events': {'high': 0, 'max': 0, 'oom': 0, 'oom_kill': 0},
                            'pids.events': {'max': 0}},
        'cpu_stat': {'usage_usec': 1000},
    }


class PayloadObservationTests(unittest.TestCase):
    def test_observer_capacity_failure_precedes_any_process_acquisition(self):
        spec = importlib.util.spec_from_file_location('resource_run', Path(__file__).with_name('resource-run.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        arguments = ['resource-run.py', '--observe-payload-exit', '--task-ceiling', '1', '--', 'payload']
        with patch.object(sys, 'argv', arguments), patch.object(sys, 'stderr', io.StringIO()), \
                patch.object(module.subprocess, 'Popen') as spawn:
            with self.assertRaises(SystemExit) as failure:
                module.main()
        self.assertEqual(failure.exception.code, 2)
        spawn.assert_not_called()

    def test_preserves_nonzero_status_kernel_peak_and_nonzero_events(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'receipt.json'
            value = receipt()
            value['resource_events']['memory.events']['oom'] = 1
            path.write_text(json.dumps(value))
            observed = read_observation(path, 'own-unit')
            self.assertEqual(observed['payload_exit_code'], 3)
            self.assertEqual(observed['memory_peak_bytes'], 123)
            self.assertEqual(observed['resource_events']['memory.events']['oom'], 1)

    def test_rejects_missing_malformed_wrong_owner_and_inconsistent_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'receipt.json'
            self.assertIsNone(read_observation(path, 'own-unit'))
            path.write_text('incomplete-json')
            self.assertIsNone(read_observation(path, 'own-unit'))
            cases = []
            for key, invalid in [('ownership_token', 'other-unit'), ('observer_pid', True),
                                 ('memory_peak_bytes', -1), ('remaining_processes', [100, 101]),
                                 ('payload_cleanup_verified', 'true'), ('phase', 'scope-exited')]:
                value = receipt()
                value[key] = invalid
                cases.append(value)
            value = receipt()
            del value['resource_events']['memory.events']['oom']
            cases.append(value)
            value = receipt()
            value['cpu_stat']['usage_usec'] = False
            cases.append(value)
            for value in cases:
                with self.subTest(value=value):
                    path.write_text(json.dumps(value))
                    self.assertIsNone(read_observation(path, 'own-unit'))

    def test_retains_lingering_actor_facts_without_certifying_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'receipt.json'
            value = receipt()
            value['remaining_processes'].append(101)
            value['payload_cleanup_verified'] = False
            path.write_text(json.dumps(value))
            observed = read_observation(path, 'own-unit')
            self.assertEqual(observed['remaining_processes'], [100, 101])
            self.assertFalse(observed['payload_cleanup_verified'])

    def test_excludes_unrelated_metadata_and_foreign_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'receipt.json'
            value = receipt()
            value['environment'] = {'ambient': 'excluded'}
            value['resource_events']['unrelated'] = {'ambient': 'excluded'}
            path.write_text(json.dumps(value))
            observed = read_observation(path, 'own-unit')
            self.assertNotIn('environment', observed)
            self.assertNotIn('unrelated', observed['resource_events'])
            link = Path(directory) / 'linked.json'
            link.symlink_to(path)
            self.assertIsNone(read_observation(link, 'own-unit'))
            self.assertEqual(json.loads(path.read_text()), value)


if __name__ == '__main__':
    unittest.main()
