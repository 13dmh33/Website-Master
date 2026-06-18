# Milly setup (under 20 minutes)

Milly posts to Instagram via Buffer. Everything else (research, content
generation, image rendering) already works without extra setup. This is
the remaining piece before the weekly pipeline can post live.

## 1. Get a Buffer classic access token (5 min)

1. Go to `buffer.com/developers`
2. Click "Create App" (any name, e.g. "Milly")
3. On the app page, click "Generate Access Token"
4. Copy the token — this is a classic OAuth token, NOT the OIDC token from
   the Buffer MCP integration page. OIDC tokens return 401 and will not work.

## 2. Get the Instagram profile ID (2 min)

With the token from step 1:

```
curl "https://api.bufferapp.com/1/profiles.json?access_token=YOUR_TOKEN"
```

Find the entry where `"service": "instagram"` and the connected account is
`@reeve.agency`. Copy its `id` field.

## 3. Add both values to `milly/.env` (2 min)

Copy `milly/.env.example` to `milly/.env` if you haven't already, then add:

```
BUFFER_ACCESS_TOKEN=<token from step 1>
BUFFER_INSTAGRAM_PROFILE_ID=<id from step 2>
ANTHROPIC_API_KEY=<already required for content generation>
```

## 4. Test without posting (5 min)

```bash
cd milly
node scripts/setup.js          # validates all env vars are present
node scripts/test-pipeline.js  # full dry run: research → generate → render → queue (never posts)
```

Check `milly/output/queue/preview-<date>.html` in a browser — this shows
exactly what the 4 weekly posts will look like.

To check only the scheduling step without touching Buffer or the queue:

```bash
node agents/scheduler.js --dry-run
```

## 5. First manual post (5 min)

Once the preview looks right:

```bash
node scripts/push-queue.js
```

This posts whatever is sitting in `output/queue/` to Buffer for real. Run
it on Mac — Buffer's API is blocked from the container.

## Notes

- GitHub Actions cron is already active on `main` (Mon 6am MT pipeline,
  Sun 10pm analytics) — once the env vars above are set as repo secrets
  (Settings → Secrets and variables → Actions), the weekly run is fully
  automated and this manual step is no longer needed.
- `SERPAPI_KEY` and `UNSPLASH_ACCESS_KEY` are optional. Without them,
  researcher falls back to evergreen content and designer falls back to
  gradient backgrounds instead of stock photos — both fallbacks are
  confirmed working.
