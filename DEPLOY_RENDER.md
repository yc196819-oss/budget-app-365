# Deploy To Render (Cloud)

## 1. Push project to GitHub
Upload this folder as a repository.

## 2. Create services from render.yaml
In Render dashboard, choose "Blueprint" and point to your repo.
It will create two web services:
- `budget-web`
- `budget-ai`

## 3. Set environment variables
After first sync, set these values:

### On `budget-ai`
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_URL` = public URL of `budget-web` (for example `https://budget-web.onrender.com`)
- Optional SMTP vars if you want email reset flow

### On `budget-web`
- `AI_BASE_URL` = public URL of `budget-ai` (for example `https://budget-ai.onrender.com`)

## 4. Redeploy both services
Trigger manual deploy for both services after env vars are set.

## 5. Validate
- Open `budget-web` URL
- In browser, open `/api/health` on both services:
  - `https://budget-web.onrender.com/api/health`
  - `https://budget-ai.onrender.com/api/health`
- In app, go to AI import and run one test file.

## Notes
- App UI runs on `budget-web`.
- AI parsing/reset endpoints run on `budget-ai`.
- Data is still stored in Supabase cloud.
