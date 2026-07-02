# Failure modes — per-failure recovery actions

Loaded by `optimize` SKILL.md when any phase fails. Content moved
verbatim from SKILL.md (C6 progressive-disclosure split).

- **Spec validation fails.** Abort with a field-level error. The user
  re-authors the spec. Do not infer missing fields.
- **All candidate generators time out.** Surface the spec back to the user
  with: "[optimize] Generators failed — likely the prompt is too narrow
  or the target ambiguous. Edit `candidate_generation_prompt` in the spec
  and retry."
- **Judge produces malformed YAML.** Single retry with a sharpened prompt
  ("Return ONLY valid YAML matching the schema; no commentary"). On
  second failure, abort and surface raw judge output to the user.
- **Style bias > 50%.** The skill ranks candidates but warns above the
  list. Picking a winner is still the user's call — the rubric may be
  fine and the judge oversensitive, or the rubric may genuinely be
  style-coupled.
- **Inter-run variance > 2 points.** Same — warn but rank. Sharpening the
  rubric definition before reranking is the typical recovery.
- **knowledge-compounder spawn fails.** Surface the winner and full
  judge_telemetry to the user in markdown so they can compound it
  manually via `/workflows:compound`.
