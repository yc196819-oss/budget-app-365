# ניקוי קבצים ישנים — הוראות לביצוע בריפו

> להעביר לצ'אט/כלי שמעלה לגיטהאב. **רק מחיקת קבצים מהריפו + push.** לא לגעת ב-Supabase.
> אף אחד מהקבצים האלה לא רץ בפרודקשן: Render מריץ `node budget-ai-server.js`, והאפליקציה טוענת רק את `public/index.html`.
> הכול נשאר בהיסטוריה של git ואפשר להחזיר כל קובץ.

## למחוק

### שרת ישן (MongoDB, לא בשימוש)
- `server.js`
- `server/` (כל התיקייה)
- `setup_routes.js`
- `rebuild_routes.js`
- `fix_routes_dir.js`
- `cleanup_and_setup.js`

### קוד ועיצוב ישנים (index.html לא טוען אותם)
- `public/app.js`
- `public/style.css`

### קבצי טקסט ריקים (מילה אחת בכל אחד)
- `DOIT.txt`, `GO.txt`, `LAST.txt`, `NOW.txt`, `OK.txt`, `READY.txt`
- `execute.txt`, `marker2.txt`, `meta.txt`, `temp-delete-list.txt`, `why.txt`

### פרויקט backoffice (שייך לפרויקט אחר במחשב, לא לאפליקציית התקציב)
- `backoffice-cloud-saas/` (כל התיקייה)
- `backend-start.ps1`, `backoffice-start-all.ps1`, `check-backoffice-health.ps1`, `check-docker.ps1`
- `docker-api-probe.ps1`, `docker-ready-check.ps1`, `docker-version-check.ps1`, `frontend-start.ps1`
- `load-backoffice-db.ps1`, `run-backoffice-infra.ps1`, `run-backoffice.ps1`, `wait-docker.ps1`
- `health-check-backoffice.cmd`, `run-backoffice-all.cmd`, `run-docker-check.cmd`

## לעדכן (הגרסאות המעודכנות נמצאות ב-ZIP)
- `package.json` — `main` ו-`npm start` מצביעים עכשיו על `budget-ai-server.js` (לא משפיע על Render).
- `public/index.html` — הוסר קוד של תפריט "עוד" שלא בשימוש מאז המעבר ל-5 טאבים.

## לא לגעת
- `budget-ai-server.js`, `public/` (חוץ מ-app.js ו-style.css), `render.yaml`, `package-lock.json`
- כל קבצי `supabase_*.sql` (תיעוד), `PENDING.md`, `DEPLOY_RENDER.md`, `.env.example`, `.gitignore`
- התיקייה `sql-already-applied/` ב-ZIP — **לא להריץ**, כבר הופעלה ב-Supabase.

## פקודה אחת (אם עובדים עם git בטרמינל)
```
git rm -r server.js server setup_routes.js rebuild_routes.js fix_routes_dir.js cleanup_and_setup.js public/app.js public/style.css DOIT.txt GO.txt LAST.txt NOW.txt OK.txt READY.txt execute.txt marker2.txt meta.txt temp-delete-list.txt why.txt backoffice-cloud-saas backend-start.ps1 backoffice-start-all.ps1 check-backoffice-health.ps1 check-docker.ps1 docker-api-probe.ps1 docker-ready-check.ps1 docker-version-check.ps1 frontend-start.ps1 load-backoffice-db.ps1 run-backoffice-infra.ps1 run-backoffice.ps1 wait-docker.ps1 health-check-backoffice.cmd run-backoffice-all.cmd run-docker-check.cmd
git commit -m "Remove legacy MongoDB server, unused assets, marker files and backoffice scripts"
git push
```
