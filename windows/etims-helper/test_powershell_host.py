"""Transport failure/concurrency checks; no real client or fiscal writes."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import queue
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

from powershell_host import PowerShellHost


class TransportFailures(unittest.TestCase):
    def ready(self):
        host = PowerShellHost()
        host.process = Mock()
        host.process.poll.return_value = None
        host.responses = queue.Queue()
        self.addCleanup(host.close)
        return host

    def test_only_known_scripts_are_callable(self):
        host = PowerShellHost()
        with patch.object(host, '_start') as start:
            for script in ('../read-state.ps1', 'tools/../read-state.ps1', 'cmd.exe', 'arbitrary.ps1'):
                with self.assertRaisesRegex(ValueError, 'Unsupported'):
                    host.execute(script)
            start.assert_not_called()

    def test_timeout_kills_worker_without_replaying_operation(self):
        host = self.ready()
        process = host.process
        with self.assertRaisesRegex(RuntimeError, 'not retried'):
            host.execute('ui-step.ps1', ('-Instruction', 'fixture'), timeout=.01)
        process.stdin.write.assert_called_once()
        process.kill.assert_called_once()
        self.assertIsNone(host.process)

    def test_wrong_response_identity_stops_without_replay(self):
        host = self.ready()
        process = host.process
        host.responses.put(dict(id=999, ok=True, output=''))
        with self.assertRaisesRegex(RuntimeError, 'not retried'):
            host.execute('ui-step.ps1')
        process.stdin.write.assert_called_once()
        process.kill.assert_called_once()

    def test_next_explicit_operation_can_replace_dead_worker(self):
        host = self.ready()
        host.process.poll.return_value = 1
        def start():
            host.process = Mock()
            host.process.poll.return_value = None
            host.responses = queue.Queue()
            host.responses.put(dict(id=1, ok=True, output='fresh'))
        with patch.object(host, '_start', side_effect=start) as launch:
            result = host.execute('read-state.ps1')
        self.assertEqual(result.stdout, b'fresh')
        launch.assert_called_once()

    def test_metrics_include_only_script_names_and_durations(self):
        host = self.ready()
        host.responses.put(dict(id=1, ok=True, output='PRIVATE-OUTPUT'))
        host.execute('read-state.ps1', ('-BuyerPin', 'PRIVATE-ARGUMENT'))
        data = json.dumps(host.metrics)
        self.assertNotIn('PRIVATE', data)
        self.assertEqual(host.metrics['read-state.ps1']['calls'], 1)


@unittest.skipUnless(os.name == 'nt', 'Actual Windows PowerShell transport')
class WindowsTransport(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory(prefix='etims-worker-fixture-')
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        shutil.copy2(Path(__file__).with_name('powershell-worker.ps1'), self.root)
        (self.root / 'read-state.ps1').write_text('''param([string]$BuyerPin)
if($BuyerPin -eq 'failure'){throw 'PRIVATE-STORED-CREDENTIAL'}
if($BuyerPin -eq 'slow'){Start-Sleep -Seconds 5}
$global:fixtureCounter++
@{counter=$global:fixtureCounter;pid=$PID;value=$BuyerPin}|ConvertTo-Json -Compress
''', encoding='utf-8')
        self.host = PowerShellHost(self.root)
        self.addCleanup(self.host.close)

    def test_worker_reused_and_unicode_arguments_never_evaluated(self):
        text = 'É → "value"\n$(throw "do not execute") ` & ;'
        first = json.loads(self.host.execute('read-state.ps1', ('-BuyerPin', text)).stdout)
        second = json.loads(self.host.execute('read-state.ps1', ('-BuyerPin', 'second')).stdout)
        self.assertEqual(first['value'], text)
        self.assertEqual(second['counter'], 2)
        self.assertEqual(first['pid'], second['pid'])

    def test_concurrent_calls_keep_responses_bound_to_request(self):
        def call(i):
            return json.loads(self.host.execute('read-state.ps1', ('-BuyerPin', str(i))).stdout)
        with ThreadPoolExecutor(max_workers=4) as executor:
            rows = list(executor.map(call, range(8)))
        self.assertEqual([r['value'] for r in rows], list(map(str, range(8))))
        self.assertEqual(len({r['pid'] for r in rows}), 1)
        self.assertEqual(sorted(r['counter'] for r in rows), list(range(1, 9)))

    def test_script_error_is_sanitized_and_worker_remains_usable(self):
        result = self.host.execute('read-state.ps1', ('-BuyerPin', 'failure'))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b'')
        self.assertNotIn(b'PRIVATE', result.stderr)
        self.assertEqual(result.stderr, b'Windows operation failed')
        self.assertEqual(self.host.execute('read-state.ps1', ('-BuyerPin', 'ok')).returncode, 0)

    def test_only_one_helper_can_own_the_windows_loopback_port(self):
        from http.server import BaseHTTPRequestHandler
        from server import LocalServer
        first = LocalServer(('127.0.0.1', 0), BaseHTTPRequestHandler)
        self.addCleanup(first.server_close)
        with self.assertRaises(OSError):
            second = LocalServer(first.server_address, BaseHTTPRequestHandler)
            second.server_close()


if __name__ == '__main__':
    unittest.main()
