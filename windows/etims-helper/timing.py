"""Local performance counters: fixed labels and durations, never sale data."""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
import json
from pathlib import Path
import time

CURRENT = ContextVar('etims_timing', default=None)
PHASES = frozenset(('prepare', 'product_registration', 'stock_adjustment', 'customer',
                   'navigate', 'invoice_workflow', 'print_dialog', 'pdf_wait',
                   'pdf_extract', 'fiscal_verification', 'cleanup'))
CHECKPOINTS = frozenset(('prepared', 'entering_invoice', 'draft_save_requested',
                        'draft_saved', 'approval_requested', 'issued', 'pdf_requested', 'complete'))


class Timings:
    def __init__(self):
        self.started = time.perf_counter()
        self.phases = []
        self.checkpoints = []
        self.scripts = {}

    @contextmanager
    def span(self, name):
        if name not in PHASES:
            raise ValueError('Unknown timing phase')
        started = time.perf_counter()
        ok = False
        try:
            yield
            ok = True
        finally:
            self.phases.append(dict(phase=name, seconds=round(time.perf_counter()-started, 4), ok=ok))

    def mark(self, name):
        if name not in CHECKPOINTS:
            raise ValueError('Unknown timing checkpoint')
        self.checkpoints.append(dict(stage=name, elapsed_seconds=round(time.perf_counter()-self.started, 4)))

    def script(self, name, seconds):
        from powershell_host import SCRIPTS
        if name not in SCRIPTS:
            raise ValueError('Unknown timing script')
        entry = self.scripts.setdefault(name, dict(calls=0, seconds=0))
        entry['calls'] += 1
        entry['seconds'] = round(entry['seconds'] + seconds, 4)

    def report(self):
        return dict(elapsed_seconds=round(time.perf_counter()-self.started, 4),
                    phases=self.phases, checkpoints=self.checkpoints, scripts=self.scripts)


@contextmanager
def span(name):
    recorder = CURRENT.get()
    if recorder is None:
        yield
    else:
        with recorder.span(name):
            yield


def mark(name):
    recorder = CURRENT.get()
    if recorder is not None:
        recorder.mark(name)


@contextmanager
def record_run(path):
    recorder = Timings()
    token = CURRENT.set(recorder)
    try:
        yield recorder
    finally:
        CURRENT.reset(token)
        # Diagnostics must never turn a completed fiscal job into a failure.
        try:
            path = Path(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix('.next')
            temporary.write_text(json.dumps(recorder.report(), indent=2), encoding='utf-8')
            temporary.replace(path)
        except OSError:
            pass


def timed(name):
    def decorate(function):
        @wraps(function)
        def call(*args, **kwargs):
            with span(name):
                return function(*args, **kwargs)
        return call
    return decorate
