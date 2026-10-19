---
"yellow-research": minor
"yellow-core": patch
---

Use Ceramic the way its docs recommend: research agents now send 2–3 short keyword variants per lookup with `maxDescriptionLength: 1000`, and fall back to other providers based on how many results contain the query's distinctive terms instead of `result.totalResults`, which Ceramic sets to the number of results returned.
