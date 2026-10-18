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

## Academic Research Skills (ARS)

The five skills from
[Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills)
(v3.23.1, upstream commit `cfd081d8f309ec65254d9f9f04c845ee78b1ec1d`) are installed as
project skills, following upstream's "Method 1":

- `.claude/skills/deep-research`, `academic-paper`, `academic-paper-reviewer`,
  `academic-pipeline`, `sr-screener`
- `.claude/skills/shared/` — shared protocols and schemas the skills reference
- `.claude/agents/screening_reviewer_agent.md` — subagent used by `sr-screener`
- `.claude/CLAUDE.md` — upstream's project instructions (routing rules)

License: CC BY-NC 4.0 (non-commercial use only) — see `.claude/skills/ARS-LICENSE`.

Try it: ask Claude to plan a paper ("help me plan a paper on …") or start a
literature review. The `/ars-*` slash commands ship only with the plugin install
(`/plugin marketplace add Imbad0202/academic-research-skills`).
