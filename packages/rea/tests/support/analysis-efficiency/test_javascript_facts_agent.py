"""Exercise the real experiment CLI with controlled command/cleanup outcomes.

No model, application or leftover process is launched. Production private-root
creation/removal and OwnedCommandFailure are used; the command port supplies
interleavings which cannot safely be forced using a real orphan process.
Requires the built checkout used by the experiment itself.
"""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPOSITORY = Path(__file__).resolve().parents[3]
HARNESS = Path(__file__).with_name('javascript-facts-agent.mjs')


class JavaScriptFactsAgentTests(unittest.TestCase):
    def run_harness(self, mode):
        directory = tempfile.TemporaryDirectory(prefix='rea-facts-agent-test-')
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        repository = root / 'repository'
        modules = repository / 'dist/process'
        modules.mkdir(parents=True)
        (repository / 'package.json').write_text('{"type":"module"}')
        config = dict(mode=mode, root=str(root), output=str(root / 'output'))
        original_root = (REPOSITORY / 'dist/process/PrivateRuntimeRoot.js').as_uri()
        original_command = (REPOSITORY / 'dist/process/OwnedCommand.js').as_uri()
        self.assertTrue((REPOSITORY / 'dist/process/OwnedCommand.js').is_file(), 'Build REA before running the experiment boundary checks')
        (modules / 'PrivateRuntimeRoot.js').write_text('''
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrivateRuntimeRoot as RealRoot } from ORIGINAL_ROOT;
const config = CONFIG;
export const PrivateRuntimeRoot = { async create(options) {
  const root = await RealRoot.create({...options, parent: config.root});
  await writeFile(join(config.root, 'workspace.txt'), root.path);
  const close = root.close.bind(root);
  root.close = async () => {
    if (config.mode === 'root-close') throw new Error('fixture root cleanup failure: ' + root.path);
    if (config.mode === 'late-cancel') process.emit('SIGINT');
    await close();
  };
  return root;
}};
'''.replace('ORIGINAL_ROOT', json.dumps(original_root)).replace('CONFIG', json.dumps(config)))
        (modules / 'OwnedCommand.js').write_text('''
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { OwnedCommandFailure } from ORIGINAL_COMMAND;
export { OwnedCommandFailure };
const config = CONFIG;
const snapshot = (text, exitCode = 0) => ({
  stdout: {text, bytes: Buffer.byteLength(text), observedBytes: Buffer.byteLength(text)},
  stderr: {text: 'fixture diagnostic', bytes: 18, observedBytes: 18},
  exitCode, signal: null
});
export async function runOwnedCommand(spawn) {
  await appendFile(join(config.root, 'commands.jsonl'), JSON.stringify(spawn.arguments) + '\\n');
  if (spawn.arguments[0] === '--version') {
    if (config.mode === 'version-failure') throw new OwnedCommandFailure('process', 'fixture version probe failure', snapshot(''));
    return snapshot(config.mode === 'empty-version' ? '\\n' : 'codex-cli 0.999.0\\n');
  }
  if (['retained', 'recording-failure', 'root-close', 'timeout'].includes(config.mode)) {
    const retained = ['retained', 'recording-failure'].includes(config.mode);
    if (config.mode === 'recording-failure') await mkdir(join(config.output, 'failure.json'));
    const partial = snapshot('partial-é\\n');
    partial.stdout.observedBytes += 5;
    partial.diagnosticTruncated = true;
    throw new OwnedCommandFailure('timeout', 'primary fixture command failure', partial,
      retained ? 'fixture cleanup denied' : null,
      retained ? {cleanupResult: {cleaned: false, reason: 'fixture-denied'}, collectionFailure: true} : {},
      retained ? ['fixture-run', 'pid:424242', 'process-group:424242'] : [],
      retained ? {fixtureOwner: true} : undefined);
  }
  const answer = spawn.arguments[spawn.arguments.indexOf('--output-last-message') + 1];
  await writeFile(answer, '{}');
  return snapshot(JSON.stringify({type: 'turn.completed', usage: {input_tokens: 1}}) + '\\n', config.mode === 'nonzero' ? 7 : 0);
}
'''.replace('ORIGINAL_COMMAND', json.dumps(original_command)).replace('CONFIG', json.dumps(config)))
        completed = subprocess.run(
            [shutil.which('node'), str(HARNESS), '--repository', str(repository),
             '--artifact', str(root / 'unread.asar'), '--arm', 'view', '--task', 'direct',
             '--output', str(root / 'output')],
            text=True, capture_output=True, timeout=20,
        )
        workspace = Path((root / 'workspace.txt').read_text())
        commands = [json.loads(line) for line in (root / 'commands.jsonl').read_text().splitlines()]
        return completed, root / 'output', workspace, commands

    def test_records_observed_cli_version_and_closes_successful_workspace(self):
        result, output, workspace, commands = self.run_harness('success')
        self.assertEqual(result.returncode, 0, result.stderr)
        trial = json.loads((output / 'trial.json').read_text())
        self.assertEqual(trial['cli_version'], 'codex-cli 0.999.0')
        self.assertEqual(commands[0], ['--version'])
        self.assertEqual(len(commands), 2)
        self.assertFalse(workspace.exists())

    def test_version_failure_does_not_start_a_trial(self):
        for mode in ['version-failure', 'empty-version']:
            with self.subTest(mode=mode):
                result, output, workspace, commands = self.run_harness(mode)
                self.assertNotEqual(result.returncode, 0)
                failure = json.loads((output / 'failure.json').read_text())
                self.assertEqual(failure['phase'], 'cli-version')
                self.assertEqual(commands, [['--version']])
                self.assertFalse((output / 'trial.json').exists())
                self.assertFalse(workspace.exists())

    def test_retains_owner_workspace_original_error_and_cleanup_diagnostics(self):
        result, output, workspace, _ = self.run_harness('retained')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('OwnedCommandFailure', result.stderr)
        self.assertIn('primary fixture command failure', result.stderr)
        failure = json.loads((output / 'failure.json').read_text())
        self.assertTrue(workspace.is_dir())
        self.assertEqual(failure['retained_workspace'], str(workspace))
        self.assertEqual(failure['cleanup_result'], {'cleaned': False, 'reason': 'fixture-denied'})
        self.assertEqual(failure['resources'], ['fixture-run', 'pid:424242', 'process-group:424242'])
        self.assertEqual(failure['cleanup_failure'], 'fixture cleanup denied')
        self.assertTrue(failure['collection_failure'])
        self.assertTrue(failure['stdout_truncated'])
        self.assertTrue(failure['diagnostic_truncated'])
        self.assertEqual((output / 'partial-events.jsonl').read_text(), 'partial-é\n')

    def test_failure_recording_error_preserves_primary_and_owned_workspace(self):
        result, _, workspace, _ = self.run_harness('recording-failure')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(workspace.is_dir())
        self.assertIn('Pilot and failure recording failed', result.stderr)
        self.assertIn('primary fixture command failure', result.stderr)
        self.assertIn('EISDIR', result.stderr)

    def test_root_cleanup_failure_preserves_primary_error(self):
        result, output, workspace, _ = self.run_harness('root-close')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(workspace.is_dir())
        self.assertIn('Verifier cleanup failed', result.stderr)
        self.assertIn('primary fixture command failure', result.stderr)
        self.assertIn('fixture root cleanup failure', result.stderr)
        self.assertEqual(json.loads((output / 'failure.json').read_text())['reason'], 'timeout')

    def test_ordinary_timeout_releases_workspace_and_preserves_partial_output(self):
        result, output, workspace, _ = self.run_harness('timeout')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(workspace.exists())
        failure = json.loads((output / 'failure.json').read_text())
        self.assertEqual(failure['reason'], 'timeout')
        self.assertFalse(failure['cleanup_owner_retained'])
        self.assertEqual(failure['phase'], 'agent-trial')
        self.assertEqual(failure['cli_version'], 'codex-cli 0.999.0')
        self.assertEqual((output / 'partial-events.jsonl').read_text(), 'partial-é\n')

    def test_nonzero_command_remains_an_incomplete_trial_after_cleanup(self):
        result, output, workspace, _ = self.run_harness('nonzero')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads((output / 'trial.json').read_text())['exit_code'], 7)
        self.assertFalse(workspace.exists())

    def test_cleanup_time_cancellation_keeps_completed_trial_and_reports_cancelled(self):
        result, output, workspace, _ = self.run_harness('late-cancel')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((output / 'trial.json').is_file())
        self.assertIn("reason: 'cancelled'", result.stderr)
        self.assertIn('cancelled during finalization', result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertFalse(workspace.exists())


if __name__ == '__main__':
    unittest.main()
