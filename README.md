# Mustapha

## watermarks-remover

`watermarks-remover/` is a vendored copy of
[guillaumemeyer/watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover)
(MIT, upstream commit `980c0b4c5786ca710ed77276b6e55b622f340d4c`, v0.7.0).

Its two skills are installed for this project in `.claude/skills/`:

- `remove-ai-marks` — talks to the local HTTP service (below).
- `clean-user-facing-text` — self-contained, text only.

Start the service (Python 3.10+, stdlib only; binds to 127.0.0.1:8765):

```bash
python3 watermarks-remover/service/scripts/server.py
curl -s http://127.0.0.1:8765/health
```

Set `WATERMARKS_SERVICE_URL` if you run it elsewhere. See
`watermarks-remover/README.md` for the full documentation.
