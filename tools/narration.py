#!/usr/bin/env python3
"""Narration scripts and read time for the report page. Standard library only, deterministic.

    python3 tools/narration.py            write audio/<edition>/<section-id>.txt and update the read time in index.html
    python3 tools/narration.py --check    exit 1 if a script or the read time is out of date (changes nothing)
    python3 tools/narration.py --stdout   print the scripts instead of writing them

The edition comes from <main data-audio-base="/state-of-voice-agents/audio/YYYY-MM/">. One script is written for
the hero (#brief) and for each top-level <section id> in <main>, except the comments widget. Scripts carry the
full visible text, written for the ear: tables become sentences (a <table data-narrate="{0}: {1}..."> template
names the row pattern; otherwise "Column: value" pairs), citation markers, interactive controls and anything
marked data-narrate-skip are left out, evidence labels are read as short phrases, and symbols are expanded
(%, $, ms, pass^3, WER). The Sources list becomes one sentence. The .txt files double as transcripts.

The read time is the visible text of <main>, without the Sources list, at 230 words a minute, rounded up. It is
pre-rendered into <span id="read-min">About N min read</span> so readers without JavaScript see it too.
"""
import argparse, html, html.parser, math, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "index.html"
WPM = 230
SKIP_SECTIONS = {"comments"}  # the utterances widget: control labels, not report text
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
BLOCK = {"p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "div", "tr", "summary", "section", "header", "footer",
         "ul", "ol", "table", "details", "dd", "dt", "blockquote", "figcaption", "fieldset"}
BLOCK_CLASSES = {"eyebrow", "lbl", "was", "edition"}
NEVER = {"script", "style", "svg", "template", "button", "audio", "noscript", "textarea", "select", "input"}
ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"]


class Node:
    __slots__ = ("tag", "attrs", "children", "parent")

    def __init__(self, tag, attrs=None, parent=None):
        self.tag, self.attrs, self.children, self.parent = tag, dict(attrs or {}), [], parent

    @property
    def classes(self):
        return set((self.attrs.get("class") or "").split())

    def find_all(self, pred):
        for c in self.children:
            if isinstance(c, Node):
                if pred(c):
                    yield c
                yield from c.find_all(pred)

    def find(self, pred):
        return next(self.find_all(pred), None)


class Tree(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = self.cur = Node("#root")

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs, self.cur)
        self.cur.children.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse(text):
    t = Tree()
    t.feed(text)
    t.close()
    return t.root


def raw_text(node):
    """Text content, like the DOM's textContent, without scripts and styles."""
    if isinstance(node, str):
        return node
    if node.tag in ("script", "style", "template"):
        return ""
    return "".join(raw_text(c) for c in node.children)


BR = "\x03"  # a block break, kept through whitespace squashing


def squash(s):
    return re.sub(r"\s+", " ", s).strip()


def squash_blocks(s):
    """Collapse whitespace inside each block, keeping the breaks between blocks."""
    parts = [squash(x) for x in s.split(BR)]
    return BR.join(x for x in parts if x)


def skipped(n):
    c = n.classes
    return (n.tag in NEVER or "data-narrate-skip" in n.attrs or "hidden" in n.attrs
            or n.attrs.get("aria-hidden") == "true"
            or (n.tag == "a" and "c" in c)          # citation markers like [12]
            or c & {"hash", "seg", "ix", "btn", "md-btn", "about-links", "listen", "listen-all", "src"})


# Evidence labels and recency tags become markers, resolved once the surrounding text is known
LABEL = "\x01{}\x02"


def label_phrase(n):
    t = squash(raw_text(n))
    if "vd" in n.classes and t == "new":
        return LABEL.format("new this month")
    if "chip" in n.classes and n.parent is not None and n.parent.tag == "td" and squash(raw_text(n.parent)) == t:
        return t  # a table cell whose whole value is the label, such as a claim's verdict
    return LABEL.format(t)


def end(s):
    s = s.strip()
    if not s:
        return ""
    return s if s[-1] in ".?!:;" else s + "."


def render(node):
    if isinstance(node, str):
        return node
    if skipped(node):
        return ""
    c = node.classes
    if "data-say" in node.attrs:
        return node.attrs["data-say"]
    if node.attrs.get("role") == "img" and node.attrs.get("aria-label"):
        return BR + end(node.attrs["aria-label"]) + BR
    if node.tag == "br":
        return " "
    if "chip" in c or ("vd" in c and squash(raw_text(node)) == "new"):
        return label_phrase(node)
    if node.tag == "table":
        return render_table(node)
    if "stat" in c:
        return render_stat(node)
    if "eyebrow" in c:
        t = squash(raw_text(node))
        head = node.parent.find(lambda n: n.tag in ("h1", "h2")) if node.parent is not None else None
        if head is not None and squash(raw_text(head)).startswith(t):
            return ""  # "About" above "About this report"
        return BR + end(eyebrow(t)) + BR
    if node.tag == "ol":
        items = [x for x in node.children if isinstance(x, Node) and x.tag == "li" and not skipped(x)]
        out = []
        for i, li in enumerate(items):
            body = squash(render_children(li).replace(BR, " "))
            lead = ORDINALS[i] if i < len(ORDINALS) else f"Number {i + 1}"
            if len(body) > 1 and body[0].isupper() and body[1].islower():
                body = body[0].lower() + body[1:]
            out.append(end(f"{lead}, {body}"))
        return BR + BR.join(out) + BR
    inner = render_children(node)
    if node.tag in BLOCK or c & BLOCK_CLASSES:
        parts = squash_blocks(inner).split(BR)
        return BR + BR.join(end(x) for x in parts if x) + BR if any(parts) else ""
    return inner


def render_children(node):
    return "".join(render(x) for x in node.children)


def eyebrow(t):
    m = re.match(r"^(\d+) · (.*)$", t)
    if m:
        return f"Section {m.group(1)}: {m.group(2)}"
    return t.replace(" · ", ". ")


def cell(td):
    return squash(render_children(td).replace(BR, " ")).rstrip(".")


def render_table(t):
    heads = [squash(raw_text(th)) for th in t.find_all(lambda n: n.tag == "th")]
    body = t.find(lambda n: n.tag == "tbody") or t
    rows = [r for r in body.children if isinstance(r, Node) and r.tag == "tr" and not skipped(r)]
    tpl = t.attrs.get("data-narrate")
    out = []
    for r in rows:
        cells = [cell(td) for td in r.children if isinstance(td, Node) and td.tag in ("td", "th")]
        if tpl:
            line = re.sub(r"\{(\d+)\}", lambda m: cells[int(m.group(1))] if int(m.group(1)) < len(cells) else "", tpl)
        else:
            parts = [end(cells[0])] if cells else []
            parts += [end(f"{h}: {v}") for h, v in zip(heads[1:], cells[1:]) if v]
            line = " ".join(parts)
        out.append(end(line))
    return BR + BR.join(out) + BR


def render_stat(n):
    def part(cls):
        x = n.find(lambda k: cls in k.classes)
        return squash(render_children(x).replace(BR, " ")) if x is not None else ""
    label, was, value = part("eyebrow"), part("was"), part("v")
    rest = "".join(render(x) for x in n.children
                   if isinstance(x, Node) and not x.classes & {"eyebrow", "was", "v"})
    rest = squash(rest.replace(BR, " "))
    return BR + " ".join(s for s in (end(f"{label}: {value}"), end(was), end(rest)) if s) + BR


def resolve_labels(text):
    """A label after a full stop reads as its own short sentence; inside a sentence it follows a comma."""
    pat = re.compile(LABEL.format("(.*?)"))
    while True:
        m = pat.search(text)
        if not m:
            return text
        before = text[:m.start()].rstrip(" ")
        after = text[m.end():].lstrip(" ")
        phrase = m.group(1)
        if not before or before[-1] in ".?!:" + BR:
            rep, lead = phrase[0].upper() + phrase[1:], " "
        else:
            rep, lead = phrase, ", "
        if not after or after[0] in ",;:)" + BR:
            tail = ""          # the sentence carries on, or the block ends here
        elif after[0].islower():
            tail = ","         # "Credit Union (Australia), new this month, with ..."
        else:
            tail = "."
        text = before + lead + rep + tail + " " + after


MONTHS = {"Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April", "Jun": "June", "Jul": "July",
          "Aug": "August", "Sep": "September", "Sept": "September", "Oct": "October", "Nov": "November",
          "Dec": "December"}
SCALE = {"K": "thousand", "M": "million", "B": "billion"}


def dollars(m):
    num, scale = m.group(1), m.group(2)
    if scale:
        return f"{num} {SCALE[scale]} dollars"
    if num.startswith("0."):
        cents = f"{float(num) * 100:.4f}".rstrip("0").rstrip(".")
        return f"{cents} cents"
    return f"{num} dollars"


def speak(s):
    """Expand symbols and abbreviations that a voice would misread."""
    s = s.replace("&", " and ")
    s = re.sub(r"\bpass\^(\d)\b", lambda m: "pass " + ["zero", "one", "two", "three", "four", "five"][int(m.group(1))], s)
    s = re.sub(r"\bpass\^k\b", "pass k", s)
    s = re.sub(r"\bpass@1\b", "pass at one", s)
    s = re.sub(r"\bError rate \(WER\)", "Word error rate", s)
    s = re.sub(r"\bWER\b", "word error rate", s)
    s = re.sub(r"\$(\d[\d,]*(?:\.\d+)?)([KMB])?\b", dollars, s)
    s = re.sub(r"\b(\d+)M (English|and) ", r"\1-million-parameter \2 ", s)
    s = re.sub(r"\b(\d+(?:\.\d+)?)([MB])\b", lambda m: f"{m.group(1)} {SCALE[m.group(2)]}", s)
    s = re.sub(r"(\d)%", r"\1 percent", s)
    s = re.sub(r"\b(\d[\d,]*)\+ ", r"more than \1 ", s)
    s = re.sub(r"\b(\d+(?:\.\d+)?) ?ms\b", r"\1 milliseconds", s)
    s = re.sub(r"\b(\d+(?:\.\d+)?) s\b", r"\1 seconds", s)
    s = re.sub(r"\b1 GB\b", "1 gigabyte", s)
    s = re.sub(r"\b(\d+(?:\.\d+)?) GB\b", r"\1 gigabytes", s)
    s = re.sub(r"\b(\d+(?:\.\d+)?) MB\b", r"\1 megabytes", s)
    s = re.sub(r"\b(\d+)x\b", r"\1 times", s)
    s = re.sub(r"\bp50 ", "median ", s)
    s = re.sub(r"\bp95 ", "95th percentile ", s)
    s = re.sub(r"\bvs\b\.?", "versus", s)
    s = re.sub(r"\b(" + "|".join(MONTHS) + r")\b(?= \d)", lambda m: MONTHS[m.group(1)], s)
    s = re.sub(r"\bGA\b", "generally available", s)
    s = re.sub(r"\bfp16\b", "16-bit", s)
    return s


def tidy(s):
    s = s.replace("\u00a0", " ")
    lines = []
    for line in s.split(BR):
        line = re.sub(r"[ \t]+", " ", line).strip()
        line = re.sub(r" +([.,;:!?)])", r"\1", line)
        line = re.sub(r"\( +", "(", line)
        line = re.sub(r"([.;:!?]),", r"\1", line)
        line = re.sub(r",\.", ".", line)
        line = re.sub(r"\.;", ";", line)
        line = re.sub(r"([.?!] )([a-z])", lambda m: m.group(1) + m.group(2).upper(), line)
        line = line[:1].upper() + line[1:]
        line = re.sub(r"\.\s*\.", ".", line)
        line = re.sub(r":\.", ".", line)
        line = re.sub(r"\s{2,}", " ", line)
        if line:
            lines.append(line)
    return "\n\n".join(lines) + "\n"


def main_node(root):
    return root.find(lambda n: n.tag == "main")


def narration(main):
    """Ordered (section id, script) pairs."""
    out = []
    targets = [n for n in main.children if isinstance(n, Node) and n.attrs.get("id")
               and (n.tag == "section" or "hero" in n.classes) and n.attrs["id"] not in SKIP_SECTIONS]
    for sec in targets:
        sid = sec.attrs["id"]
        if sid == "sources":
            h2 = squash(raw_text(sec.find(lambda n: n.tag == "h2")))
            count = len(list(sec.find_all(lambda n: n.tag == "li" and (n.attrs.get("id") or "").startswith("src-"))))
            text = (f"{end(h2)}{BR}The {count} sources for this update are listed on the page, numbered in order of "
                    f"first use, each with a link. October's sources are in the October baseline.")
        else:
            text = resolve_labels(render(sec))
        out.append((sid, tidy(speak(text))))
    return out


def read_minutes(main):
    """Visible words in <main>, without the Sources list, scripts or anything marked data-narrate-skip."""
    def words(n):
        if isinstance(n, str):
            return n
        if n.tag in ("script", "style", "svg", "template") or "data-narrate-skip" in n.attrs \
                or n.attrs.get("id") == "src" or "hidden" in n.attrs:
            return " "
        return " ".join(words(c) for c in n.children)
    count = len(words(main).split())
    return count, max(1, math.ceil(count / WPM))


READ_RE = re.compile(r'(<span id="read-min">)About \d+ min read(</span>)')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="exit 1 if anything is out of date")
    ap.add_argument("--stdout", action="store_true", help="print the scripts")
    ap.add_argument("--page", default=str(PAGE), help="the page to read (default index.html)")
    a = ap.parse_args()
    page = pathlib.Path(a.page)
    source = page.read_text(encoding="utf-8")
    m = main_node(parse(source))
    base = m.attrs.get("data-audio-base", "")
    ed = re.search(r"/audio/(\d{4}-\d{2})/$", base)
    if not ed:
        sys.exit('narration: <main> needs data-audio-base="/state-of-voice-agents/audio/YYYY-MM/"')
    out_dir = ROOT / "audio" / ed.group(1)
    scripts = narration(m)
    count, minutes = read_minutes(m)
    if not READ_RE.search(source):
        sys.exit('narration: the page needs <span id="read-min">About N min read</span> in the hero')
    new_source = READ_RE.sub(lambda x: f"{x.group(1)}About {minutes} min read{x.group(2)}", source)

    if a.stdout:
        for sid, text in scripts:
            print(f"=== {sid} ({len(text)} characters)\n{text}")
        return
    stale = []
    for sid, text in scripts:
        f = out_dir / f"{sid}.txt"
        if not f.exists() or f.read_text(encoding="utf-8") != text:
            stale.append(str(f.relative_to(ROOT)))
            if not a.check:
                out_dir.mkdir(parents=True, exist_ok=True)
                f.write_text(text, encoding="utf-8")
    known = {f"{sid}.txt" for sid, _ in scripts}
    extra = sorted(p for p in out_dir.glob("*.txt") if p.name not in known) if out_dir.exists() else []
    for p in extra:
        stale.append(f"{p.relative_to(ROOT)} (no longer a section)")
        if not a.check:
            p.unlink()
    if new_source != source:
        stale.append(f"{page.name} read time (now {minutes} min)")
        if not a.check:
            page.write_text(new_source, encoding="utf-8")

    total = sum(len(t) for _, t in scripts)
    print(f"narration: edition {ed.group(1)}, {len(scripts)} scripts, {total:,} characters; "
          f"{count:,} words, about {minutes} min read at {WPM} wpm")
    if stale:
        print(("Out of date: " if a.check else "Updated: ") + ", ".join(stale))
        if a.check:
            print("Run python3 tools/narration.py and commit the result.")
            sys.exit(1)


if __name__ == "__main__":
    main()
