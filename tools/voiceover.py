#!/usr/bin/env python3
"""Generate the voice-overs for an edition with ElevenLabs text to speech. Standard library only.

    ELEVENLABS_API_KEY=... python3 tools/voiceover.py audio/2026-11
    python3 tools/voiceover.py audio/2026-11 --dry-run      what would be generated, and its size; no API calls

Reads every <section-id>.txt in the folder (written by tools/narration.py) and regenerates only the sections whose
text changed: manifest.json keeps each section's SHA-256 next to its MP3's file name, duration in seconds and byte
size. Long scripts are split at paragraph and sentence boundaries under the model's character limit, generated in
order with request stitching (the previous request IDs, plus the start of the next chunk as next_text) so the
voice keeps its prosody across chunks, and joined into one MP3 (44.1 kHz, 128 kbps).

Settings, from the environment:
    ELEVENLABS_API_KEY    required, unless --dry-run; never printed or written anywhere
    ELEVENLABS_VOICE_ID   default WQP7cQUF5aAS6Axh5yaa ("Elara - Crisp Pro Narrator", an ElevenLabs default voice)
    ELEVENLABS_MODEL_ID   default eleven_v4 (ElevenLabs' highest-quality model; 10,000 characters a request)

Hosting. By default each MP3 is written beside its script, to be committed. When Cloudflare R2 is configured, the
MP3 is uploaded there instead (S3 API, SigV4, standard library only) and the manifest records its public URL, so
the repository holds no audio. An MP3 is recorded once: it is regenerated only when its section's text, the voice
or the model changes.
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   all four, or none
    AUDIO_BASE_URL        the bucket's public address, e.g. https://audio.sbmadhav.com
"""
import argparse, datetime, hashlib, hmac, json, os, pathlib, re, sys, time
import urllib.error, urllib.parse, urllib.request

API = "https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128"
DEFAULT_VOICE = "WQP7cQUF5aAS6Axh5yaa"
DEFAULT_MODEL = "eleven_v4"
# Per-request character limits from https://elevenlabs.io/docs/overview/models; chunks stay well under them,
# because shorter requests keep long-form delivery steady
LIMITS = {"eleven_v4": 10_000, "eleven_multilingual_v2": 10_000, "eleven_v3": 5_000,
          "eleven_flash_v2_5": 40_000, "eleven_flash_v2": 30_000}
CHUNK = 2_500
NEXT_TEXT = 100  # characters of the following chunk sent as context
SEED = 2026      # same text, same settings: as close to the same audio as the API allows


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def chunks(text, limit):
    """Split at paragraphs, then sentences, then words, keeping each chunk at or under `limit` characters."""
    out, cur = [], ""
    pieces = []
    for para in text.strip().split("\n\n"):
        if len(para) <= limit:
            pieces.append(para)
            continue
        for sent in re.split(r"(?<=[.?!])\s+", para):
            while len(sent) > limit:
                cut = sent.rfind(" ", 0, limit)
                cut = cut if cut > 0 else limit
                pieces.append(sent[:cut])
                sent = sent[cut:].lstrip()
            pieces.append(sent)
    for piece in pieces:
        sep = "\n\n" if cur else ""
        if len(cur) + len(sep) + len(piece) <= limit:
            cur += sep + piece
        else:
            out.append(cur)
            cur = piece
    if cur:
        out.append(cur)
    return out


# MPEG audio frames: enough of the format to drop tags and VBR header frames when joining chunks, and to time them
BITRATES = {1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],      # MPEG-1 Layer III
            2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]}          # MPEG-2/2.5 Layer III
RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def frames(data):
    """Yield (offset, length, samples, sample_rate) for each MPEG Layer III frame, skipping ID3 tags."""
    i, n = 0, len(data)
    while i + 4 <= n:
        if data[i:i + 3] == b"ID3" and i + 10 <= n:
            size = (data[i + 6] << 21) | (data[i + 7] << 14) | (data[i + 8] << 7) | data[i + 9]
            i += 10 + size + (10 if data[i + 5] & 0x10 else 0)
            continue
        if data[i:i + 3] == b"TAG" and n - i == 128:
            break
        h = int.from_bytes(data[i:i + 4], "big")
        version, layer = (h >> 19) & 3, (h >> 17) & 3
        br_i, sr_i, pad = (h >> 12) & 15, (h >> 10) & 3, (h >> 9) & 1
        if (h >> 21) & 0x7FF != 0x7FF or version == 1 or layer != 1 or br_i in (0, 15) or sr_i == 3:
            i += 1
            continue
        rate = RATES[version][sr_i]
        kbps = BITRATES[1 if version == 3 else 2][br_i]
        samples = 1152 if version == 3 else 576
        length = (samples // 8 * kbps * 1000) // rate + pad
        if length < 4:
            i += 1
            continue
        yield i, length, samples, rate
        i += length


def is_vbr_header(frame):
    return any(tag in frame[:64] for tag in (b"Xing", b"Info", b"VBRI"))


def join_mp3(parts):
    """Concatenate MP3 chunks frame by frame, dropping ID3 tags and Xing/Info headers (their counts would be wrong)."""
    out = bytearray()
    for part in parts:
        for off, length, _, _ in frames(part):
            frame = part[off:off + length]
            if not is_vbr_header(frame):
                out += frame
    return bytes(out)


def duration(data):
    return sum(s / r for off, length, s, r in frames(data) if not is_vbr_header(data[off:off + length]))


def tts(key, voice, model, text, previous_ids, next_text):
    body = {"text": text, "model_id": model, "seed": SEED, "apply_text_normalization": "auto"}
    if previous_ids:
        body["previous_request_ids"] = previous_ids[-3:]
    if next_text:
        body["next_text"] = next_text
    req = urllib.request.Request(API.format(voice=voice), data=json.dumps(body).encode(), method="POST",
                                 headers={"xi-api-key": key, "Content-Type": "application/json",
                                          "Accept": "audio/mpeg"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read(), r.headers.get("request-id")
        except urllib.error.HTTPError as e:
            detail = e.read()[:500].decode("utf-8", "replace")
            if e.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(5 * 2 ** attempt)
                continue
            raise SystemExit(f"ElevenLabs returned HTTP {e.code}: {detail}") from None
        except urllib.error.URLError as e:
            if attempt < 4:
                time.sleep(5 * 2 ** attempt)
                continue
            raise SystemExit(f"Could not reach ElevenLabs: {e.reason}") from None


def _hmac(key, msg):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def signing_key(secret, date, region, service):
    """AWS Signature Version 4 signing key (R2 speaks the S3 API; its region is "auto")."""
    k = _hmac(("AWS4" + secret).encode("utf-8"), date)
    for part in (region, service, "aws4_request"):
        k = _hmac(k, part)
    return k


def r2_settings():
    """Cloudflare R2 settings from the environment, or None when R2 is not configured (MP3s then stay in the repo)."""
    names = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "AUDIO_BASE_URL")
    vals = {n: os.environ.get(n, "").strip() for n in names}
    if not any(vals.values()):
        return None
    missing = [n for n, v in vals.items() if not v]
    if missing:
        sys.exit("Cloudflare R2 is partly configured; missing " + ", ".join(missing))
    if not re.fullmatch(r"[0-9a-f]{32}", vals["R2_ACCOUNT_ID"]):
        sys.exit("R2_ACCOUNT_ID does not look like a Cloudflare account ID")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", vals["R2_BUCKET"]):
        sys.exit("R2_BUCKET does not look like a bucket name")
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/-]*)?", vals["AUDIO_BASE_URL"]):
        sys.exit("AUDIO_BASE_URL must be an https URL, for example https://audio.example.com")
    vals["AUDIO_BASE_URL"] = vals["AUDIO_BASE_URL"].rstrip("/")
    return vals


def r2_put(cfg, key, data, now=None):
    """Upload one object to R2 with a SigV4-signed PUT. `key` is the object path, e.g. 2026-11/fs-1a2b3c4d.mp3."""
    host = f"{cfg['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    path = "/" + urllib.parse.quote(f"{cfg['R2_BUCKET']}/{key}", safe="/-_.~")
    now = now or datetime.datetime.now(datetime.timezone.utc)
    amz, date = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload = hashlib.sha256(data).hexdigest()
    headers = {"cache-control": "public, max-age=31536000, immutable", "content-type": "audio/mpeg",
               "host": host, "x-amz-content-sha256": payload, "x-amz-date": amz}
    signed = ";".join(sorted(headers))
    canonical = "\n".join(["PUT", path, "", *[f"{k}:{headers[k]}" for k in sorted(headers)], "", signed, payload])
    scope = f"{date}/auto/s3/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    sig = hmac.new(signing_key(cfg["R2_SECRET_ACCESS_KEY"], date, "auto", "s3"), to_sign.encode(),
                   hashlib.sha256).hexdigest()
    headers["authorization"] = (f"AWS4-HMAC-SHA256 Credential={cfg['R2_ACCESS_KEY_ID']}/{scope}, "
                                f"SignedHeaders={signed}, Signature={sig}")
    req = urllib.request.Request(f"https://{host}{path}", data=data, method="PUT", headers=headers)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300):
                return f"{cfg['AUDIO_BASE_URL']}/{key}"
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode("utf-8", "replace")
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(3 * 2 ** attempt)
                continue
            raise SystemExit(f"Cloudflare R2 returned HTTP {e.code} for {key}: {detail}") from None
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(3 * 2 ** attempt)
                continue
            raise SystemExit(f"Could not reach Cloudflare R2: {e.reason}") from None


def next_context(text):
    """The start of the next chunk, cut at a word boundary."""
    if len(text) <= NEXT_TEXT:
        return text
    cut = text.rfind(" ", 0, NEXT_TEXT)
    return text[:cut if cut > 0 else NEXT_TEXT]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("folder", help="the edition's audio folder, e.g. audio/2026-11")
    ap.add_argument("--dry-run", action="store_true", help="list what would be generated; no API calls")
    a = ap.parse_args()
    folder = pathlib.Path(a.folder)
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "").strip() or DEFAULT_VOICE
    model = os.environ.get("ELEVENLABS_MODEL_ID", "").strip() or DEFAULT_MODEL
    if not re.fullmatch(r"[A-Za-z0-9]{8,64}", voice):
        sys.exit("ELEVENLABS_VOICE_ID does not look like a voice ID")
    limit = min(CHUNK, LIMITS.get(model, 5_000))
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key and not a.dry_run:
        sys.exit("ELEVENLABS_API_KEY is not set")

    mpath = folder / "manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
    manifest.setdefault("edition", folder.name)
    entries = manifest.setdefault("sections", {})
    scripts = {p.stem: p.read_text(encoding="utf-8") for p in sorted(folder.glob("*.txt"))}

    changed = False
    for sid in sorted(set(entries) - set(scripts)):   # a section that no longer exists
        print(f"{sid}: removed")
        if entries[sid].get("file"):
            (folder / entries[sid]["file"]).unlink(missing_ok=True)
        del entries[sid]
        changed = True

    r2 = None if a.dry_run else r2_settings()

    def have_audio(e):   # hosted on R2 (a URL in the manifest), or an MP3 file in the folder
        return bool(e.get("url")) or ("file" in e and (folder / e["file"]).exists())

    todo = [sid for sid, text in scripts.items()
            if entries.get(sid, {}).get("sha256") != sha256(text)
            or entries.get(sid, {}).get("voice_id") != voice or entries.get(sid, {}).get("model_id") != model
            or not have_audio(entries.get(sid, {}))]

    # MP3s generated before R2 was configured move there without being regenerated (no ElevenLabs cost)
    if r2:
        for sid, e in entries.items():
            if sid in todo or e.get("url") or not (folder / e.get("file", "")).is_file():
                continue
            local = folder / e["file"]
            e["url"] = r2_put(r2, f"{folder.name}/{sid}-{e['sha256'][:8]}.mp3", local.read_bytes())
            local.unlink()
            del e["file"]
            print(f"{sid}: moved to Cloudflare R2")
            changed = True
    chars = sum(len(scripts[s]) for s in todo)
    print(f"Voice {voice}, model {model}; {len(scripts)} sections, {len(todo)} to generate, "
          f"{chars:,} characters to send")
    if a.dry_run:
        for sid in todo:
            print(f"  {sid}: {len(scripts[sid]):,} characters in {len(chunks(scripts[sid], limit))} request(s)")
        return

    sent = 0
    for sid in todo:
        text = scripts[sid]
        parts, ids = [], []
        pieces = chunks(text, limit)
        for k, piece in enumerate(pieces):
            nxt = next_context(pieces[k + 1]) if k + 1 < len(pieces) else ""
            audio, rid = tts(key, voice, model, piece, ids, nxt)
            if not audio:
                sys.exit(f"{sid}: empty audio from ElevenLabs")
            parts.append(audio)
            if rid:
                ids.append(rid)
            sent += len(piece)
        mp3 = join_mp3(parts)
        if not mp3:
            sys.exit(f"{sid}: the response was not MP3 audio")
        digest = sha256(text)
        old = entries.get(sid, {})
        if old.get("file") and old["file"] != f"{sid}.mp3":
            (folder / old["file"]).unlink(missing_ok=True)
        if r2:   # the object name carries the text's hash, so a new recording never hits a cached old one
            where = {"url": r2_put(r2, f"{folder.name}/{sid}-{digest[:8]}.mp3", mp3)}
            (folder / f"{sid}.mp3").unlink(missing_ok=True)
        else:
            (folder / f"{sid}.mp3").write_bytes(mp3)
            where = {"file": f"{sid}.mp3"}
        entries[sid] = {**where, "sha256": digest, "duration": round(duration(mp3), 2),
                        "bytes": len(mp3), "characters": len(text), "voice_id": voice, "model_id": model}
        print(f"{sid}: {len(pieces)} request(s), {len(text):,} characters, {entries[sid]['duration']:.1f} s, "
              f"{len(mp3):,} bytes")
        changed = True
        # Save as we go, so a failure later keeps what was already paid for
        manifest["sections"] = dict(sorted(entries.items()))
        mpath.write_text(json.dumps(manifest, indent=2) + "\n")

    total = sum(e.get("duration", 0) for e in entries.values())
    print(f"Characters sent to ElevenLabs: {sent:,}. Total narration: {total / 60:.1f} min.")
    if changed:
        manifest["sections"] = dict(sorted(entries.items()))
        manifest["total_duration"] = round(total, 2)
        mpath.write_text(json.dumps(manifest, indent=2) + "\n")
    gh = os.environ.get("GITHUB_STEP_SUMMARY")
    if gh:
        with open(gh, "a") as f:
            f.write(f"### Voice-over\n\n{len(todo)} section(s) generated, {sent:,} characters sent to ElevenLabs "
                    f"(voice `{voice}`, model `{model}`). Total narration {total / 60:.1f} min.\n")


if __name__ == "__main__":
    main()
