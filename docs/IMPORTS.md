# Importing from other apps

Mosaic reads the CSV exports of three common apps. Every importer:

- **is idempotent.** Each row gets a stable id derived from its content, so importing the same file twice adds nothing the second time.
- **has a dry run.** It parses and counts everything but writes nothing.
- **reports, never guesses.** Rows it cannot read are counted in `skipped` or listed in `errors` with the line number. Valid rows still import.

| Source | Lands in | API | CLI |
|---|---|---|---|
| Todoist (project template CSV) | Tasks | `POST /api/v2/tasks/import/todoist?project=&dry=1` | `import-todoist --project=Home file.csv` |
| YNAB (register export) | Money records + accounts | `POST /api/v2/money/import/ynab?currency=USD&dry=1` | `import-ynab --currency=USD file.csv` |
| MyFitnessPal (nutrition summary) | Food log | `POST /api/v2/food/import/mfp?dry=1` | `import-mfp file.csv` |

The API takes the CSV as the raw request body (`content-type: text/csv`). In chat, the `import_csv` tool takes `source` (`todoist`, `ynab` or `mfp`), the CSV text, and `dry_run`. You can paste a file and say "import this".

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: text/csv' \
  --data-binary @todoist.csv 'https://your-host/api/v2/tasks/import/todoist?project=Home&dry=1'
# {"created":12,"skipped":0,"errors":[],"dryRun":true}
```

## Todoist

Export: Project → ⋯ → *Export as a template* → CSV.

| Todoist | Mosaic |
|---|---|
| `TYPE=section` row | `section` of the tasks that follow it |
| `TYPE=task`, `CONTENT` | Task title. `@labels` are removed from the title and become tags. |
| `DESCRIPTION` and any following `TYPE=note` rows | Task notes |
| `PRIORITY` 1 (Todoist's p1, highest) … 4 | Priority 3 … 0 |
| `INDENT` 2+ | Subtask of the nearest task above with a smaller indent |
| `DATE` as ISO `YYYY-MM-DD` | Due date |
| `DATE` in natural language (`every monday`) | Kept in the notes. Recurrence is not guessed. |

`--project` names the target project and creates it if it does not exist. The default is `Inbox`. A task row with no title is reported in `errors`.

## YNAB

Export: Budget → *Export budget data* → use `Register.csv`.

| YNAB | Mosaic |
|---|---|
| `Account` | Account. Created on first sight. |
| `Date` | Day. The importer detects day-first or month-first for the whole file. ISO dates pass through. |
| `Outflow` / `Inflow` | An expense or income record. US (`$1,234.56`), European (`1.234,56 €`) and bracketed negatives `(12.00)` are all read. |
| `Category` | Category, matched by name |
| `Inflow: Ready to Assign` | Income with no category |
| `Payee` = `Transfer : …` | Skipped and counted in `transfers`. Both sides of a transfer are skipped, so totals stay correct. |

Two identical rows (same day, payee and amount) are both kept: the second gets an occurrence number in its import key. Zero-amount rows are skipped. Semicolon-separated files work too.

`--currency` is the ISO code for every row (default `USD`). YNAB exports carry no currency.

## MyFitnessPal

Export: *Reports* → *Export Data* (Premium) → the **Nutrition Summary** CSV.

Each row (`Date`, `Meal`, `Calories`, `Protein (g)`, `Carbohydrates (g)`, `Fat (g)`) becomes one food-log entry in the matching meal slot (breakfast, lunch, dinner or snacks). Days that have imported entries are marked complete, so the trends do not treat them as half-logged.

## What is not imported

- Todoist completed tasks, comments' attachments, and recurrence rules (kept as text)
- YNAB budgets and goals (only transactions)
- MyFitnessPal individual foods (only per-meal totals are in that export)
