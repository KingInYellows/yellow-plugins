# Audit contract

P1: missing critical documentation (README, public API or architecture). P2:
evidence-backed stale claims, broken references or source/doc contradictions.
P3: structural improvements (navigation, sections, cross-links). Report direct
file/line evidence; lack of history does not prove staleness.

Map code artifacts to relevant docs. Measure coverage only for an enumerated
set. Unavailable files/language support are limitations, not undocumented
artifacts. Do not estimate a percentage.

Score = max(0, 100 - (P1_count _ 15 + P2_count _ 5 + P3_count)). Findings are
primary; score is a summary. Cap 50 per severity and state truncation.

Read-only history can prove code behavior changed after its documentation.
Ninety days is a review hint from the existing conventions, not proof of stale
text. Check actual behavior before making a finding.

Output: status, scope, findings [{severity, file, line, explanation}], coverage
{documented, total, percent} or {status: unknown, reason}, healthScore,
nextSteps (at most three), limitations.
