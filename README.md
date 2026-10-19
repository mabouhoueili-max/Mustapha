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

## Academic Humanizer

[AIScientists-Dev/academic-humanizer](https://github.com/AIScientists-Dev/academic-humanizer)
(MIT, v0.3.3, upstream commit `94b88b23703bed7df507acae7d6d5876209a0cdf`) is installed in
`.claude/skills/academic-humanizer/` (`SKILL.md`, examples, license). It is an editing pass for
AI-assisted papers and NSF/NIH proposals: it trims generic AI phrasing and matches claims to evidence
without changing numbers or citations. Run `/academic-humanizer` and paste a section or point it at a
file. It does not replace the venue's AI-use disclosure requirements.

## Harvey (autonomous sales agent)

`harvey/` is a copy of [ethanplusai/harvey](https://github.com/ethanplusai/harvey)
(MIT, upstream commit `e114e95471b1bf155454fca108f0730b66a47a01`). It is a Python app, not a
Claude skill: it finds businesses, writes and sends cold email, and handles replies in a loop.
It is meant to run on your own computer with your own mailbox and Claude login. Nothing is
configured here (no `.env`, no mailbox, no LinkedIn).

```bash
cd harvey
python3 -m venv .venv && source .venv/bin/activate && pip install -e .
claude   # then say "set up Harvey for me"
```

Keep the defaults: `require_approval: true` (every email waits for you in the outbox) and
LinkedIn automation off (it breaks LinkedIn's terms and can get the account restricted). Read
`harvey/README.md` § "Legal and deliverability" before sending anything.
