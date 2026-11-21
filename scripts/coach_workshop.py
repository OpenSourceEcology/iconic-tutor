#!/usr/bin/env python3
"""Serve the tutor to invited contributors through a same-origin HTTPS reverse proxy."""
import argparse
from contextlib import closing
from datetime import timezone, datetime
from functools import partial
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
from uuid import uuid4
from urllib.parse import urlsplit

import studio_authoring as author
import studio_credits as credits
from studio_contributions import handle_contribution
from studio_server import Handler, WEB, model_json
from studio_coach import handle_coach

PROJECT = re.compile(r"/api/(authoring|coach)/projects/([0-9a-f]{32})(?:/[A-Za-z0-9_./-]+)?\Z")
BOARD = re.compile(r"/api/contributions/tasks(?:/[a-z0-9-]+(?:/(?:claim|save|release|submit))?)?\Z")
SLOTS = threading.BoundedSemaphore(4)
SCHEMA = """
CREATE TABLE IF NOT EXISTS workshop_projects(
 project TEXT PRIMARY KEY REFERENCES projects(id), account TEXT NOT NULL REFERENCES credit_accounts(id));
CREATE TABLE IF NOT EXISTS workshop_usage(
 account TEXT NOT NULL, day TEXT NOT NULL, category TEXT NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(account,day,category));
"""


def owner(db, account, project):
    return db.execute("SELECT 1 FROM workshop_projects WHERE account=? AND project=?", (account,project)).fetchone()


def allowance(db, account, category, limit):
    today = datetime.now(timezone.utc).date().isoformat()
    with db:
        used = db.execute("""INSERT INTO workshop_usage VALUES(?,?,?,1)
            ON CONFLICT(account,day,category) DO UPDATE SET count=count+1 WHERE count<?
            RETURNING count""", (account,today,category,limit)).fetchone()
    if not used:
        raise author.RequestError(f"Daily workshop limit reached for {category}. Try again tomorrow (UTC).",429)


class Workshop(Handler):
    def same_origin(self):
        origin = self.server.public_origin
        return self.headers.get("Host") == urlsplit(origin).netloc and self.headers.get("Origin") in (None, origin)

    def list_directory(self, path):
        self.send_error(404)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/deployment.json":
            return self.json_response(200, {"backend":"same-origin", "workshop":True})
        if path.startswith("/api/"):
            return self.service("GET")
        if path == "/":
            self.path = "/coach.html"
        return super().do_GET()

    def do_POST(self):
        return self.service("POST")

    def service(self, method):
        if not self.same_origin():
            return self.json_response(403, {"error":"Use the workshop address supplied by your organizer."})
        path = urlsplit(self.path).path
        if method == "POST" and path == "/api/credits/webhook":
            return credits.handle_webhook(self)
        try:
            body = None
            if method == "POST":
                size = int(self.headers.get("Content-Length","0"))
                if not 0 < size <= 160000 or self.headers.get_content_type() != "application/json":
                    raise author.RequestError("Expected a bounded JSON request.")
                body = json.loads(self.rfile.read(size))
                if not isinstance(body,dict):
                    raise author.RequestError("Expected a JSON object.")
            if path in {"/api/credits/status","/api/credits/login","/api/credits/logout","/api/credits/checkout"}:
                return credits.handle_credits(self,method,body)
            with credits.database() as db:
                account = credits.identity(db,self.headers.get("Cookie",""))["id"]
            with closing(author.connect()) as db:
                return self.participant(db, account, method, path, body)
        except author.RequestError as exc:
            return self.json_response(exc.status, {"error":str(exc)})
        except (TypeError,ValueError):
            return self.json_response(400, {"error":"Could not read that request."})
        except (OSError,RuntimeError,sqlite3.Error):
            return self.json_response(503, {"error":"Workshop storage or generation is temporarily unavailable."})

    def participant(self, db, account, method, path, body):
        if method == "POST":
            allowance(db,account,"saved requests",500)
        if path == "/api/authoring/modules" and method == "GET":
            return author.handle_authoring(self,method,body,model_json)
        if path == "/api/authoring/projects":
            if method == "GET":
                rows = db.execute("""SELECT p.* FROM projects p JOIN workshop_projects w ON p.id=w.project
                                  WHERE w.account=? ORDER BY p.updated_at DESC,p.id""",(account,))
                return self.json_response(200,{"projects":[dict(r) for r in rows]})
            allowance(db,account,"new projects",12)
            project_id = uuid4().hex
            with db:
                # Creation records the initial revision and ownership in one transaction.
                db.execute("PRAGMA defer_foreign_keys=ON")
                db.execute("INSERT INTO workshop_projects VALUES(?,?)",(project_id,account))
                project = author.create(db,body,project_id)
            return self.json_response(200,project)
        if BOARD.fullmatch(path):
            if body and body.get("project_id") is not None and not owner(db,account,body["project_id"]):
                raise author.RequestError("Unknown workshop project.",404)
            return handle_contribution(self,method,body)
        match = PROJECT.fullmatch(path)
        if not match or not owner(db,account,match[2]):
            raise author.RequestError("Unknown workshop project or route.",404)
        costly = path.endswith(("/message","/confirm","/propose","/generate","/refresh-evidence")) or (
            path.endswith("/wiki") and urlsplit(self.path).query)
        if costly and (path.endswith("/propose") or (path.endswith("/message") and body and body.get("mode") == "free")):
            allowance(db,account,"included AI questions",40)
        if costly and not SLOTS.acquire(blocking=False):
            raise author.RequestError("The workshop is busy. Retry in a moment.",429)
        try:
            if match[1] == "coach":
                return handle_coach(self,method,body,model_json)
            return author.handle_authoring(self,method,body,model_json)
        finally:
            if costly:
                SLOTS.release()


def configure(root):
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    os.environ["STUDIO_AUTHORING_DB"] = str(root.resolve() / "workshop.sqlite3")
    with credits.database() as db:
        db.executescript(SCHEMA)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data",type=Path,required=True,help="Dedicated workshop directory (shared by serve and invite).")
    cmds = parser.add_subparsers(dest="action",required=True)
    cmds.add_parser("invite").add_argument("name")
    serve = cmds.add_parser("serve")
    serve.add_argument("--port",type=int,default=8770)
    serve.add_argument("--origin",help="Public HTTPS origin, or omit for local review.")
    args = parser.parse_args()
    os.umask(0o077)
    configure(args.data)
    if args.action == "invite":
        account,code = credits.create_account(args.name)
        print(f"Account {account}\nPrivate invitation {code}")
        return
    origin = args.origin or f"http://127.0.0.1:{args.port}"
    url = urlsplit(origin)
    if origin != f"{url.scheme}://{url.netloc}" or not url.hostname or url.username or url.password or (
        url.scheme != "https" and origin != f"http://127.0.0.1:{args.port}"):
        parser.error("Supply an HTTPS origin with no path, or omit --origin for local review.")
    os.environ["STUDIO_PUBLIC_ORIGIN"] = origin
    server = ThreadingHTTPServer(("127.0.0.1",args.port),partial(Workshop,directory=str(WEB)))
    server.public_origin = origin
    print(f"Participant tutor at {origin}/coach.html",flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
