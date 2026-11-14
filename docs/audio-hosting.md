# Audio hosting: recommendation and setup

Status on November 14, 2026: the voice-over MP3s for the October and November 2026 editions are committed under `audio/` (137 MB) and served by GitHub Pages. That works today. It will not last through mid-2028.

## Recommendation

Move the audio to Cloudflare R2 behind `audio.sbmadhav.com`, and move the DNS for `sbmadhav.com` to Cloudflare to make that possible.

Why:

- **Size.** A monthly update adds about 50 MB of MP3s. GitHub Pages sites are limited to about 1 GB, so the repository would hit the limit in under two years.
- **Cost.** R2's free tier covers 10 GB of storage and does not charge for downloads.
- **No re-recording.** `tools/voiceover.py` moves MP3s that are already in the repository to R2 on the next run and records nothing again, so the move costs no ElevenLabs credits.
- **Own domain.** R2 only attaches custom domains whose DNS Cloudflare manages. `sbmadhav.com` uses Google Cloud DNS nameservers (`ns-cloud-b*.googledomains.com`), so `audio.sbmadhav.com` cannot be attached until the DNS moves.

Alternatives considered:

| Option | Good for | Drawback |
|---|---|---|
| Bucket's `r2.dev` public URL | Works in minutes, no DNS change | Rate-limited by Cloudflare and meant for development; an address that is not yours |
| Subdomain of `learnvedicmath.com` (already on Cloudflare) | Works at once | Off-brand address for this report |
| Keep the MP3s in the repository | Nothing to set up | Reaches the Pages size limit; every clone downloads all audio |

## What is already done

- R2 bucket `state-of-voice-agents-audio` exists in the Cloudflare account (created November 14, 2026). It is private and empty.
- The Voice-over workflow and `tools/voiceover.py` support R2: with the settings below they upload each MP3 and record its URL in `audio/<edition>/manifest.json`. The page plays `https` URLs from the manifest.
- Audio is generated only by a manual run of the workflow, and anything recorded is saved even if a run stops partway.

## Steps that need the site owner

1. **Add `sbmadhav.com` to Cloudflare** (Free plan). Check the imported records against this list, taken from public DNS on November 14, 2026, and set the A, AAAA and `www` records to DNS only (not proxied), because GitHub Pages issues the site's certificate:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` |
   | AAAA | `@` | `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153` |
   | CNAME | `www` | `sbmadhav.github.io` |
   | MX | `@` | `mxa.mailgun.org`, `mxb.mailgun.org` (priority 10) |
   | TXT | `@` | `v=spf1 include:mailgun.org ~all` |
   | TXT | `_github-pages-challenge-sbmadhav` | copy the current value from the registrar |

2. **Check email first.** The MX records point at Mailgun, which looks like the registrar's email forwarding. Copy any DKIM records (names ending in `._domainkey`) from the registrar's DNS page, and confirm with the registrar that forwarding keeps working after the nameservers change.
3. **Switch the nameservers** at the registrar to the two Cloudflare gives you. Allow up to a day. The site stays up because the records are the same.
4. **Attach the domain**: R2 > `state-of-voice-agents-audio` > Settings > Custom Domains > `audio.sbmadhav.com`.
5. **Create an R2 API token** with Object Read & Write on that bucket.
6. **Add to GitHub** (Settings > Secrets and variables > Actions):
   - Secrets: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - Variables: `R2_BUCKET` = `state-of-voice-agents-audio`, `AUDIO_BASE_URL` = `https://audio.sbmadhav.com`
7. **Run Actions > Voice-over once.** It uploads the existing MP3s, removes them from the repository and opens a pull request with the updated manifests. Merge it, then check that a Listen button plays from `audio.sbmadhav.com`.

To start sooner, do steps 5 to 7 with the bucket's `r2.dev` URL as `AUDIO_BASE_URL`, and change the variable to the custom domain later. The object paths are the same, but the manifests store full URLs, so also edit the URLs' host in `audio/*/manifest.json` (a find and replace) and commit.

## After the move

- The MP3s stay in the repository's git history (137 MB). That does not count against the published site. Leave it, unless clone size becomes a problem.
- If a Content-Security-Policy is added to the pages (pull request #5 proposes one), it must allow the audio host: `media-src 'self' https://audio.sbmadhav.com`.
- ElevenLabs cost: a monthly update is about 40,000 characters; the first recording of both editions was 108,789.
