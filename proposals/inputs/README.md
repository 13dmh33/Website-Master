# Proposal inputs

One JSON file per lead, named `<leadId>.json`, matching `state.json`'s `queue[].lead_id`.

No automated call-notes source exists yet (Nora isn't merged onto this branch — see
`/STATE-AUDIT.md`). Until it is, create this file by hand right after a call.

## Shape

```json
{
  "leadId": "ChIJPWkzbT-AbIcRx8WRyaQ--Gw",
  "trade": "plumber",
  "offering": "plumbing",
  "painPoint": "Missing 2-3 calls a week after hours, no way to capture them",
  "package": "growth",
  "customLineItems": [
    { "label": "Rush setup (live in 3 days)", "amountUsd": 50 }
  ],
  "personalNote": "Really appreciated you walking me through the after-hours numbers on the call."
}
```

- `leadId` — required, must match the filename.
- `trade` — required.
- `offering` — optional, defaults to `trade` in the rendered proposal.
- `painPoint` — required. Their words, from the call, not yours.
- `package` — required. One of `starter`, `growth`, `pro` (see `scripts/lib/proposal/packages.js`).
- `customLineItems` — optional array of `{ label, amountUsd }`.
- `personalNote` — optional, shown near the sign-off.

Run `node scripts/generate-proposal.js <leadId>` once the file exists.
