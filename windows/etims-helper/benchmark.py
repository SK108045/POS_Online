"""Read-only timing probes. Never click, type, save, print or submit a job."""
import argparse
import json
from pathlib import Path
import statistics
import subprocess
import tempfile
import time

from client import Client
from offline import require_offline
from powershell_host import HOST
from workflow import BASE, read_state, ps


def measure(operation, repetitions):
    samples = []
    for _ in range(repetitions):
        started = time.perf_counter()
        operation()
        samples.append(round(time.perf_counter() - started, 4))
    return dict(samples_seconds=samples, median_seconds=round(statistics.median(samples), 4))


def benchmark(repetitions=4, legacy_assets=None):
    require_offline()
    state = read_state('')
    if len(state['process_ids']) != 1:
        raise ValueError('Open exactly one logged-in eTIMS client for read-only timing')
    client = Client(state['process_ids'][0])
    screen = client.detect()
    result = dict(read_only=True, screen=screen,
                  offline_check=measure(require_offline, repetitions),
                  native_state_read=measure(lambda: read_state(''), repetitions),
                  screen_detection=measure(client.detect, repetitions))
    with tempfile.TemporaryDirectory(prefix='etims-readonly-timing-') as folder:
        instruction = Path(folder) / 'guard.json'

        def prepare(root):
            # This deliberately unsupported action validates the screenshot,
            # then stops BEFORE any UI action or field read is dispatched.
            instruction.write_text(json.dumps(dict(pid=client.pid, action='BenchmarkGuardOnly',
                x=0, y=0, text=None, reference=str(root/'profiles'/(screen+'.png')),
                regions=[client.region(screen)])), encoding='utf-8')

        if legacy_assets:
            root = Path(legacy_assets).resolve(strict=True)
            prepare(root)

            def legacy():
                run = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive',
                    '-ExecutionPolicy', 'Bypass', '-File', str(root/'ui-step.ps1'),
                    '-Instruction', str(instruction)], capture_output=True, timeout=40,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                if run.returncode == 0 or b'Unsupported UI action' not in run.stderr:
                    raise ValueError('Legacy guard-only probe did not reach its safe stopping point')

            result['legacy_screen_guard'] = measure(legacy, repetitions)
        prepare(BASE)

        def current():
            try:
                ps('ui-step.ps1', '-Instruction', str(instruction), timeout=40)
            except RuntimeError as error:
                if 'ui-step.ps1 failed' not in str(error) or '(' in str(error):
                    raise
            else:
                raise ValueError('Guard-only probe unexpectedly accepted an unsupported action')

        current()  # Warm the compiled comparer before reporting repeated work.
        result['optimized_screen_guard'] = measure(current, repetitions)
        if legacy_assets:
            result['screen_guard_speedup'] = round(
                result['legacy_screen_guard']['median_seconds'] /
                result['optimized_screen_guard']['median_seconds'], 2)
    result['native_invoice_count_unchanged'] = read_state('')['max_invoice'] == state['max_invoice']
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--iterations', type=int, default=4)
    parser.add_argument('--legacy-assets', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not 1 <= args.iterations <= 20:
        parser.error('Choose 1 to 20 iterations')
    try:
        report = benchmark(args.iterations, args.legacy_assets)
        raw = json.dumps(report, indent=2)
        if args.output:
            args.output.write_text(raw, encoding='utf-8')
        print(raw)
    finally:
        HOST.close()
