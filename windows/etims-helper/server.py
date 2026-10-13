"""Authenticated loopback IPC. Only a normal interactive Windows session issues."""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import sys
from urllib.parse import urlparse
from engine import Engine
from settings import HOME, settings

def serve():
    HOME.mkdir(parents=True,exist_ok=True)
    token_path=HOME/'helper.token'
    try:
        with token_path.open('x',encoding='ascii') as stream:stream.write(secrets.token_urlsafe(48))
    except FileExistsError:pass
    token=token_path.read_text(encoding='ascii').strip()
    if len(token)<40:raise ValueError('Invalid local helper authorization token')
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass # Never log payloads, authentication or customer fields.
        def send(self,status,value):
            raw=json.dumps(value,ensure_ascii=False).encode('utf-8')
            self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)))
            self.end_headers();self.wfile.write(raw)
        def handle_request(self):
            if self.headers.get('Origin') or self.headers.get('Host','').split(':')[0]!='127.0.0.1':
                return self.send(403,{'error':'Local POS backchannel required'})
            route=urlparse(self.path).path
            if route=='/health' and self.command=='GET':
                return self.send(200,{'app':'oraforge-etims-helper','version':2,'platform':sys.platform})
            if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):
                return self.send(403,{'error':'Companion authorization required'})
            try:
                body={}
                if self.command=='POST':
                    if self.headers.get_content_type()!='application/json':raise ValueError('JSON required')
                    length=int(self.headers.get('Content-Length','0'))
                    if not 0<length<=1_000_000:raise ValueError('Invalid request size')
                    body=json.loads(self.rfile.read(length))
                    if not isinstance(body,dict):raise ValueError('JSON object required')
                if route=='/preflight' and self.command=='POST':
                    return self.send(200,engine.preflight(body['sale'],body.get('details')))
                if route=='/jobs' and self.command=='POST':
                    if body.get('confirmed_new_sale') is not True:raise ValueError('A confirmed new POS sale is required')
                    return self.send(202,engine.submit(body['sale'],body.get('details')))
                import re
                match=re.fullmatch(r'/jobs/([0-9a-f]{64})(/recover|/details)?',route)
                if match:
                    key,action=match.groups();job=engine.store.get(key)
                    if not job:return self.send(404,{'error':'Unknown POS invoice request'})
                    if self.command=='GET' and not action:return self.send(200,engine.public(job))
                    if self.command=='POST' and action=='/recover':return self.send(202,engine.recover(key))
                    if self.command=='POST' and action=='/details':
                        if job['state']!='needs_details':raise ValueError('Registration details can only complete a blocked preflight')
                        return self.send(202,engine.submit(job['payload'],body.get('details',{})))
                self.send(404,{'error':'Unknown companion operation'})
            except (ValueError,KeyError,TypeError) as error:
                self.send(400,{'error':Engine.safe_error(error)})
            except Exception as error:
                self.send(503,{'error':Engine.safe_error(error)})
        do_GET=handle_request
        do_POST=handle_request
        def do_OPTIONS(self):self.send(403,{'error':'Use the local POS proxy'})
    # Binding before entering the queue prevents parallel helper processes.
    server=ThreadingHTTPServer(('127.0.0.1',settings()['port']),Handler)
    engine=Engine()
    server.daemon_threads=True
    server.serve_forever()

if __name__=='__main__':
    try:
        if '--configure' in sys.argv:
            from configure import configure
            configure()
        else:serve()
    except Exception as error:
        # No traceback: provider errors can contain encrypted connection options.
        print(Engine.safe_error(error),file=sys.stderr)
        raise SystemExit(1)
