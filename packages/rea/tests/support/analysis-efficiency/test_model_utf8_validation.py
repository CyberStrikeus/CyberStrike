"""Phase receipt fault injection only; these stand-ins do not qualify a model provider."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


class ModelPhaseReceipts(unittest.TestCase):
    def run_phase(self, inspect_body, close_body):
        driver = Path(__file__).with_name('model-utf8-validation.mjs').resolve()
        with tempfile.TemporaryDirectory(prefix='rea-model-phase-test-') as directory:
            root = Path(directory)
            artifact = root / 'input'
            artifact.write_bytes(b'receipt fixture, not a model')
            expected = {'artifact': {'path': str(artifact)}}
            (root / 'expected.json').write_text(json.dumps(expected))
            (root / 'package.json').write_text('{"type":"module"}')
            module = root / 'dist' / 'model'
            module.mkdir(parents=True)
            (module / 'ModelArtifactProvider.js').write_text(
                'export class ModelArtifactProvider {\n'
                'async inspect() {' + inspect_body.replace('EXPECTED', json.dumps(expected)) + '}\n'
                'async close() {' + close_body + '}\n}\n')
            result = subprocess.run([
                'node', str(driver), '--phase', '--runtime', str(root),
                '--artifact', str(artifact), '--expected', str(root / 'expected.json'),
                '--output', str(root / 'output'),
            ], capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 1, result.stderr)
            report = json.loads((root / 'output' / 'report.json').read_text())
            self.assertEqual(json.loads(result.stdout), report)
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['receipt_failures'], [])
            return report

    def test_rejected_inspection_keeps_cost_and_primary_failure_after_close_failure(self):
        report = self.run_phase(
            'throw new Error("inspection failed");',
            'throw new Error("cleanup failed");')
        self.assertEqual(len(report['calls']), 1)
        sample = report['calls'][0]
        self.assertEqual(sample['phase'], 'fresh')
        self.assertTrue(sample['is_error'])
        self.assertGreaterEqual(sample['elapsed_ms'], 0)
        self.assertIn('inspection failed', sample['failure'])
        self.assertIn('inspection failed', report['failure'])
        self.assertEqual(report['cleanup_failures'], ['provider: Error: cleanup failed'])

    def test_mismatch_keeps_inspection_time_and_failure(self):
        report = self.run_phase('return {ok:true,value:{wrong:true}};', '')
        self.assertEqual(len(report['calls']), 1)
        self.assertTrue(report['calls'][0]['is_error'])
        self.assertGreaterEqual(report['calls'][0]['elapsed_ms'], 0)
        self.assertIn('AssertionError', report['failure'])
        self.assertEqual(report['cleanup_failures'], [])

    def test_close_failure_keeps_all_successful_samples_and_publishes_failed_receipt(self):
        report = self.run_phase('return {ok:true,value:EXPECTED};',
                                'throw new Error("cleanup failed");')
        self.assertEqual(len(report['calls']), 7)
        self.assertTrue(all(not sample['is_error'] for sample in report['calls']))
        self.assertNotIn('failure', report)
        self.assertEqual(report['cleanup_failures'], ['provider: Error: cleanup failed'])


if __name__ == '__main__':
    unittest.main()
