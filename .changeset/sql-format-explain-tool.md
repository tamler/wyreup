---
'@wyreup/core': minor
---

Add `sql-format-explain` — pretty-print SQL and annotate each clause
with a plain-English meaning.

Walks the formatted SQL clause by clause (SELECT, FROM, JOIN /
LEFT / RIGHT / FULL / CROSS, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT,
OFFSET, UNION / INTERSECT / EXCEPT, INSERT / UPDATE / DELETE,
RETURNING, WITH / CTEs) and emits structured annotations: the clause
keyword, its body, and an explanation.

Detects the statement type, flags aggregate functions in SELECT, and
builds a one-line summary (e.g. "Read query, with joins, with grouping,
with filtering, with sorting, with row limit.").

Supports dialects: standard SQL, PostgreSQL, MySQL, SQLite, BigQuery.
Free permanent — no LLM. Composes the existing `sql-formatter` library.

Public exports: `sqlFormatExplain`, `explainSql`, types, defaults.
