"""Import the explicit registry-to-gallery mapping and retain local thumbnails.

Uses only the Python standard library. Names/IDs/wiki targets are preserved;
palette tags are local navigation aids, not authoritative OSE classifications.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
HOST = "https://wiki.opensourceecology.org"
REGISTRY = HOST + "/wiki/Registry_for_the_301_ICHL_Icons"
GALLERY = HOST + "/wiki/301_ICHL_Icons"
TARGET = ROOT / "web/data/village"

def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": "IconicTutor/0.1 source-library-import"}), timeout=40) as response:
        return response.read()

def normalized(name):
    return " ".join(unescape(name).replace("_", " ").casefold().split())

class Gallery(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "img" and re.match(r"^\d{3}[ _].*\.webp$", attrs.get("alt", ""), re.I):
            self.images[normalized(attrs["alt"])] = urljoin(HOST, attrs["src"])

def tags(label):
    s=label.lower()
    result=["ichl"]
    rules={
        "site": r"site|grading|trench|foundation|sewer|mailbox|driveway|landscap|subgrade",
        "framing": r"fram|truss|joist|rafter|beam|stud|plate|blocking|structur|floor platform|quad module",
        "envelope": r"roof|insulat|housewrap|siding|flashing|envelope|membrane|exterior|gutter|weather|seal|window",
        "water": r"water|plumb|sewer|drain|toilet|faucet|shower|bath|sink|septic|gutter|hose|pex|fertigat",
        "energy": r"electri|\bpv\b|solar|power|wire|wiring|panel|breaker|ground|outlet|switch|lighting|conduit|battery|meter|inverter",
        "climate": r"hvac|heat|vent|duct|air condition|thermostat|cooling|erv|hrv",
        "interiors": r"interior|cabinet|kitchen|counter|trim|drywall|paint|flooring|tile|finish|door|hinge|shelf|shelv",
        "tools": r"tool|jig|lift|crane|marking|cutting|workflow|technique|handling|ergonom|scaffold|fastener|screw|nail|saw|drill|inspection",
        "landscape": r"landscap|garden|grow|tree|bamboo|living roof|planter",
    }
    for key, pattern in rules.items():
        if re.search(pattern,s): result.append(key)
    if len(result)==1 or any(t in result for t in ("framing","envelope","interiors")):
        result.append("housing")
    return result

def main():
    registry_raw=fetch(HOST+"/index.php?title=Registry_for_the_301_ICHL_Icons&action=raw")
    gallery_html=fetch(GALLERY)
    gallery=Gallery();gallery.feed(gallery_html.decode())
    icons=[]
    for line in registry_raw.decode().splitlines():
        if not re.match(r"^\| ICHL-\d{3} \|\|",line): continue
        cells=line[1:].split("||",4)
        identity=cells[0].strip()
        filename=re.search(r"\[\[File:([^|]+)",cells[1]).group(1)
        link=re.search(r"\[\[([^\]]+)\]\]",cells[2]).group(1).split("|",1)
        label=unescape(link[-1])
        target=unescape(re.search(r"<code[^>]*>(.*?)</code>",cells[3]).group(1))
        key=normalized(filename)
        if key not in gallery.images: raise ValueError(f"No gallery image for {identity}: {filename}")
        icons.append({"id":identity,"name":label,"available":False,"sets":tags(label),
                      "wiki_target":target,"source_url":HOST+"/wiki/"+quote(target.replace(" ","_"),safe=""),
                      "image_file":filename,"image_url":gallery.images[key],
                      "image":f"data/village/ichl/{identity}.png"})
    assert len(icons)==301 and len({i["id"] for i in icons})==301
    assert {i["id"] for i in icons}=={f"ICHL-{n:03d}" for n in range(1,302)}
    folder=TARGET/"ichl";folder.mkdir(parents=True,exist_ok=True)
    def download(icon):
        path=folder/(icon["id"]+".png")
        image=path.read_bytes() if path.exists() else fetch(icon["image_url"])
        if not image.startswith(b"\x89PNG\r\n\x1a\n"): raise ValueError("Expected PNG thumbnail: "+icon["id"])
        if not path.exists(): path.write_bytes(image)
        icon["image_sha256"]=hashlib.sha256(image).hexdigest()
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(download,icons))
    manifest={"version":1,"title":"301 ICHL icon registry","registry_url":REGISTRY,"gallery_url":GALLERY,
              "retrieved_at":datetime.now(timezone.utc).isoformat(),
              "registry_sha256":hashlib.sha256(registry_raw).hexdigest(),
              "gallery_sha256":hashlib.sha256(gallery_html).hexdigest(),
              "registry_count":len(icons),"gallery_image_count":len(gallery.images),
              "note":"Registry IDs do not always equal image filename numbers. Explicit mappings and duplicate wiki targets are retained. Registry scope notes are draft hypotheses, not specifications; they are not imported as engineering facts. Filter tags are local navigation aids.",
              "icons":icons}
    (TARGET/"ichl-registry.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps({"registry_count":len(icons),"gallery_image_count":len(gallery.images),"unmapped_gallery_images":sorted(set(gallery.images)-{normalized(i['image_file']) for i in icons}),"local_thumbnails":len(list(folder.glob('*.png')))},indent=2))

if __name__ == "__main__": main()
