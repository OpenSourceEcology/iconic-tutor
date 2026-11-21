"""Create a verified SQLite snapshot and retain the latest seven daily snapshots."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
from tempfile import NamedTemporaryFile


def backup(source, directory):
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    destination = directory / f"workshop-{day}.sqlite3"
    with NamedTemporaryFile(dir=directory, delete=False) as temp:
        staged = Path(temp.name)
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as live:
            with closing(sqlite3.connect(staged)) as snapshot:
                live.backup(snapshot)
                if snapshot.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                    raise ValueError("Backup failed its integrity check.")
        os.replace(staged, destination)
    finally:
        staged.unlink(missing_ok=True)
    for old in sorted(directory.glob("workshop-[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9].sqlite3"))[:-7]:
        old.unlink()
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    print(backup(args.source, args.directory))
