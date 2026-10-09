---
"yellow-review": patch
---

Stop flagging capitalised non-English prose in the resolve text scan, flag short Basic credentials and the tvly-, pplx- and sgp_ prefixes, and let an oos reply upgrade to fixed or addressed. A leading non-ASCII quote, bullet, dash or no-break space no longer exempts the ASCII words after it, and a short Basic credential followed by punctuation or without padding is decoded. A bare `Basic` word is judged on a stricter rule (an interior colon), so prose such as `Basic Only` stays clean, and a 3-character padded Basic credential such as `a:` is decoded.
