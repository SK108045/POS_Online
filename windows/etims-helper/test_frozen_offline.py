"""Windows frozen-helper check: missing outbound blocks must stop preflight.

Uses a temporary, unregistered installation path and fixture sale. Never changes
firewall rules, opens the real eTIMS database or submits an invoice job.
"""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

def verify(executable):
    if os.name!='nt':raise RuntimeError('Run this frozen-helper smoke test on Windows')
    executable=Path(executable).resolve(strict=True)
    temporary_root=Path(tempfile.gettempdir()).resolve()
    with tempfile.TemporaryDirectory(prefix='oraforge-offline-smoke-',dir=temporary_root) as folder:
        home=Path(folder).resolve()
        assert home.is_relative_to(temporary_root) and home.name.startswith('oraforge-offline-smoke-')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        config=dict(taxpayer_pin='A123456789B',branch_id='01',port=port,
                    installation_dir=str(home/'unregistered-fixture-client'))
        (home/'config.json').write_text(json.dumps(config),encoding='utf-8')
        process=subprocess.Popen([str(executable)],env={**os.environ,'ORAFORGE_ETIMS_HOME':str(home)},
                                 stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        url=f'http://127.0.0.1:{port}'
        try:
            deadline=time.monotonic()+30
            while True:
                if process.poll() is not None:raise RuntimeError('Frozen helper exited during smoke test')
                try:
                    with urllib.request.urlopen(url+'/health',timeout=1) as response:
                        health=json.load(response)
                        assert health['app']=='oraforge-etims-helper'
                        assert health['runtime_mode']=='frozen' and health['build']
                        assert Path(health['runtime_executable']).resolve()==executable
                        assert Path(health['runtime_entry']).resolve()==executable
                    break
                except OSError:
                    if time.monotonic()>=deadline:raise RuntimeError('Frozen helper health timed out') from None
                    time.sleep(.2)
            token=(home/'helper.token').read_text(encoding='ascii').strip()
            sale=dict(version=2,currency='KES',shop_id='offline-fixture',sale_id=1,receipt_no='FIXTURE-1',
                      customer={'pin':'A987654321Z','name':'Fixture Buyer'},payment_method='cash',
                      subtotal_cents=10000,total_cents=10000,tax_cents=0,discount={'amount_cents':0},
                      items=[dict(product_key='fixture:1',name='Fixture product',quantity=1,
                                  unit_price_cents=10000,line_total_cents=10000)])
            request=urllib.request.Request(url+'/preflight',data=json.dumps({'sale':sale}).encode(),
                        headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
            try:
                urllib.request.urlopen(request,timeout=30).close()
            except urllib.error.HTTPError as error:
                result=json.load(error)
                assert error.code==400 and 'Internet blocking could not be verified' in result.get('error',''), 'Unexpected preflight error'
            else:raise AssertionError('Unblocked fixture unexpectedly passed preflight')
            print('PASS: frozen helper refuses unblocked installation before database or UI access; live firewall unchanged.')
        finally:
            if process.poll() is None:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--executable',required=True)
    verify(parser.parse_args().executable)
