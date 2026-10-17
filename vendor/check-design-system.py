#!/usr/bin/env python3
"""Check that every report page loads the pinned design system, with Subresource Integrity. Standard library only.

    python3 vendor/check-design-system.py             offline: the pages' <link>/<script> tags (CI fails on a problem)
    python3 vendor/check-design-system.py --upstream  the vendored copies against the published release

Offline, for each page: exactly one <link rel="stylesheet"> for tokens.css and for components.css and one
<script src defer> for header.js, each at /design-system/v/<VERSION>/, each with crossorigin="anonymous" and an
integrity="sha384-..." that matches the vendored copy in vendor/design-system-<VERSION>/; no other design-system
version, no unversioned /design-system/*.css or header.js, and no Google Fonts. The tags are read with an HTML
parser, so a comment or text that mentions a URL does not count.

--upstream compares each vendored file with https://sbmadhav.com/design-system/v/<VERSION>/<file>. The versioned
files never change, so a difference is an error (exit 1). A fetch that fails is reported separately (exit 3),
so CI can warn on a network problem and fail on a real difference.
"""
import base64, glob, hashlib, html.parser, pathlib, subprocess, sys, urllib.error, urllib.request

VERSION = "2.1.0"
ROOT = pathlib.Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor" / f"design-system-{VERSION}"
BASE = f"/design-system/v/{VERSION}/"
PUBLISHED = f"https://sbmadhav.com{BASE}"
RUNTIME = {"tokens.css": "link", "components.css": "link", "header.js": "script"}
VENDORED = ["header.html", "compose.py", *RUNTIME]


def sri(data):
    return "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode()


class Tags(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []

    def handle_starttag(self, tag, attrs):
        if tag in ("link", "script"):
            self.tags.append((tag, dict(attrs), self.getpos()[0]))

    handle_startendtag = handle_starttag


def check_page(page):
    errors = []
    parser = Tags()
    parser.feed(page.read_text())
    found = {}
    for tag, a, line in parser.tags:
        url = a.get("href") if tag == "link" else a.get("src")
        if not url:
            continue
        where = f"{page.relative_to(ROOT)}:{line}"
        if "fonts.googleapis.com" in url or "fonts.gstatic.com" in url:
            errors.append(f"{where}: loads Google Fonts ({url}); tokens.css declares the self-hosted fonts")
        if not url.startswith("/design-system/") or url.startswith("/design-system/icons/"):
            continue
        name = url.rsplit("/", 1)[-1]
        if not url.startswith(BASE) or name not in RUNTIME:
            errors.append(f"{where}: loads {url}; pages load only tokens.css, components.css and header.js from {BASE}")
            continue
        if RUNTIME[name] != tag or (tag == "link" and a.get("rel") != "stylesheet") or (tag == "script" and "defer" not in a):
            shape = '<link rel="stylesheet">' if RUNTIME[name] == "link" else "<script defer>"
            errors.append(f"{where}: {name} must be a {shape}")
        want = sri((VENDOR / name).read_bytes())
        if a.get("integrity") != want:
            errors.append(f"{where}: {name} integrity is {a.get('integrity')!r}, the pinned file is {want}")
        if a.get("crossorigin") != "anonymous":
            errors.append(f"{where}: {name} needs crossorigin=\"anonymous\" next to its integrity")
        found[name] = found.get(name, 0) + 1
    for name in RUNTIME:
        if found.get(name, 0) != 1:
            errors.append(f"{page.relative_to(ROOT)}: loads {BASE}{name} {found.get(name, 0)} times; it must load it once")
    return errors


def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.read()
    except urllib.error.HTTPError:
        raise  # the server answered (404, 410...): the caller reports it as a real problem
    except urllib.error.URLError:
        # python.org builds on macOS often lack CA certificates; curl uses the system store
        import tempfile
        with tempfile.NamedTemporaryFile() as out:
            r = subprocess.run(["curl", "-sSL", "--max-time", "20", "-o", out.name, "-w", "%{http_code}", url],
                               capture_output=True, text=True)
            if r.returncode != 0:
                raise urllib.error.URLError(r.stderr.strip() or f"curl exit {r.returncode}")
            code = int(r.stdout or 0)
            if code >= 400:
                raise urllib.error.HTTPError(url, code, "HTTP error", None, None)
            return pathlib.Path(out.name).read_bytes()


def upstream():
    diff, unfetched = [], []
    for name in VENDORED:
        try:
            live = fetch(PUBLISHED + name)
        except urllib.error.HTTPError as e:
            # The server answered: a missing versioned file is a real problem, not a network failure
            diff.append(f"{PUBLISHED}{name} returned HTTP {e.code} (is {VERSION} published, with {name}?)")
            continue
        except Exception as e:
            unfetched.append(f"{PUBLISHED}{name}: {e}")
            continue
        if live != (VENDOR / name).read_bytes():
            diff.append(f"vendor/design-system-{VERSION}/{name} differs from {PUBLISHED}{name}")
    for line in diff:
        print(f"::error::{line}")
    for line in unfetched:
        print(f"::warning::could not fetch {line}")
    if diff:
        sys.exit(1)
    if unfetched:
        sys.exit(3)
    print(f"check-design-system: the vendored files match {PUBLISHED}")


if __name__ == "__main__":
    if "--upstream" in sys.argv:
        upstream()
        sys.exit(0)
    pages = [ROOT / "index.html", *map(pathlib.Path, sorted(glob.glob(str(ROOT / "editions" / "*" / "index.html"))))]
    errors = [e for p in pages for e in check_page(p)]
    for e in errors:
        print(f"::error::{e}")
    if errors:
        sys.exit(1)
    print(f"check-design-system: {len(pages)} pages load design system {VERSION} with matching integrity hashes")
