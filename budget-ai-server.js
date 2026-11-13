require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');
const { claudeRequest, isRetryable } = require('./server/claude');
const learn = require('./server/learn');
const decisionsPush = require('./server/decisions');
const fx = require('./server/fx');
const account = require('./server/account');
const cleanup = require('./server/cleanup');
const receipts = require('./server/receipts');
const twa = require('./server/twa');
const tripsAi = require('./server/trips');
const legal = require('./server/legal');
const news = require('./server/news');
const limits = require('./server/limits');
const ops = require('./server/ops');
const insights = require('./server/insights');
const { AsyncLocalStorage } = require('node:async_hooks');

const app = express();
app.disable('x-powered-by');
// Money moved between the household's own accounts (marked so by them) is
// neither an expense nor income: the summaries and the advisor skip it.
const COUNTED = ['expense', 'income'];
app.set('trust proxy', 1);
// The app's files go out compressed (about a third of the size). The API is
// left as is: the advisor's answer streams word by word.
app.use(require('compression')({ filter: (req, res) => !req.path.startsWith('/api/') && require('compression').filter(req, res) }));
const PUBLIC_DIR = path.join(__dirname, 'public');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
// Reading statements and sorting merchants: structured work, many tokens,
// done well by the small model at a fraction of the price.
const ANTHROPIC_FILES_MODEL = process.env.ANTHROPIC_FILES_MODEL || 'claude-haiku-5-5';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GROK_KEY = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-2-latest';
const GROK_BASE_URL = process.env.GROK_BASE_URL || 'https://api.x.ai/v1';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || '';
const PORT = process.env.PORT || 8787;
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5500/budget-final%20(2).html';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/rest\/v1\/?$/i, '')
  .replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// Frontend and API are served from the same Render service (see the
// express.static registration near the bottom), so real browser traffic is
// same-origin and doesn't need CORS at all. This allowlist only matters for
// the handful of cases where it isn't (local dev on a different port/host).
// Requests with no Origin header (curl, server-to-server) are left to the
// route-level auth checks below, not CORS.
function originHost(u) {
  try { return new URL(u).host; } catch (_err) { return null; }
}
const ALLOWED_CORS_HOSTS = new Set([
  '127.0.0.1:8787', 'localhost:8787',
  '127.0.0.1:5500', 'localhost:5500',
  originHost(process.env.RENDER_EXTERNAL_URL || ''),
  originHost(APP_URL)
].filter(Boolean));
app.use(cors((req, callback) => {
  const origin = req.header('Origin');
  let allow = true;
  if (origin) {
    const host = originHost(origin);
    allow = host === req.headers.host || ALLOWED_CORS_HOSTS.has(host);
  }
  callback(null, { origin: allow });
}));
app.use(express.json({ limit: '2mb' }));

// AI requests: long text is cut before any prompt is built, and past a daily
// cap for the whole service the AI is not called until tomorrow (server/limits.js).
const aiDay = limits.dailyCap();
// Every AI call is counted per person (tokens and model, never what was
// said): the request it came from is kept for the calls it makes.
const aiCtx = new AsyncLocalStorage();
app.use('/api', (req, _res, next) => aiCtx.run({ req }, next));
function recordAi(provider, model, inputTokens, outputTokens) {
  if (!supabaseAdmin) return;
  const store = aiCtx.getStore();
  const req = store && store.req;
  const row = ops.aiCallRow({ userId: req && req.authUserId, route: req ? req.method + ' ' + String(req.originalUrl || req.url).split('?')[0] : 'system', provider, model, inputTokens, outputTokens });
  supabaseAdmin.from('ai_calls').insert(row).then(() => {}, () => {});
}
app.use('/api/ai', (req, res, next) => {
  if (req.method !== 'POST') return next();
  req.body = limits.clipBody(req.body, { statement: req.path === '/import' });
  if (!aiDay.take(israelToday())) {
    console.error('AI daily cap reached:', aiDay.used);
    return res.status(429).json({ error: 'היועץ עמוס היום. נסו שוב מחר בבוקר.' });
  }
  return next();
});

// ═══ security headers ═══
// Applied to every response. The app under /app and its pages get the
// strict Content-Security-Policy.
const NEW_APP_DIR = path.join(PUBLIC_DIR, 'app');
function inlineScriptHash(file, type) {
  try {
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(new RegExp('<script type="' + type + '">([\\s\\S]*?)</script>'));
    return m ? "'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'" : '';
  } catch (_err) {
    return '';
  }
}
const NEW_APP_CSP = [
  "default-src 'self'",
  ("script-src 'self' " + inlineScriptHash(path.join(NEW_APP_DIR, 'index.html'), 'importmap')).trim(),
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob: https://images.openfoodfacts.org",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), payment=(), usb=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  if (req.path === '/app' || req.path.startsWith('/app/')) {
    res.setHeader('Content-Security-Policy', NEW_APP_CSP);
  }
  next();
});

// ═══ auth: every route that touches a user's or household's data must
// verify the caller's Supabase session token server-side instead of
// trusting a userId/householdId sent in the request body — otherwise
// anyone who finds this server's URL can act as any user. ═══
const sessions = ops.sessionCache();
async function requireAuth(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase server credentials are not configured' });
  }
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }
  // A session verified in the last few minutes is not asked about again
  // (the auth server is far away; see ops.sessionCache).
  req.authToken = token;
  const known = sessions.get(token);
  if (known) { req.authUserId = known; return mfaGate(req, res, next); }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    req.authUserId = data.user.id;
    req.authEmail = data.user.email || '';
    sessions.set(token, data.user.id, ops.tokenExp(token));
    return mfaGate(req, res, next);
  } catch (_err) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// Two-step login: whoever turned it on is let through only once this
// session passed it (the data rules in the database say the same). The
// two-step routes themselves are how a session passes, so they are open.
const mfaCache = new Map(); // token -> { state, until }
async function mfaStateOf(req) {
  const hit = mfaCache.get(req.authToken);
  if (hit && hit.until > Date.now()) return hit.state;
  const c = ops.tokenClaims(req.authToken);
  const { data, error } = await supabaseAdmin.rpc('mfa_state_for', { p_user: req.authUserId, p_aal: c.aal, p_session: c.sessionId });
  if (error) throw error;
  if (mfaCache.size > 5000) mfaCache.clear();
  mfaCache.set(req.authToken, { state: data, until: Date.now() + 30 * 1000 });
  return data;
}
async function mfaGate(req, res, next) {
  if (req.path.startsWith('/api/2fa/')) return next();
  try {
    const st = await mfaStateOf(req);
    if (st && st.required && !st.ok) return res.status(403).json({ error: 'צריך לאשר את הכניסה בקוד', mfa: true });
  } catch (err) {
    // The database rules still hold; a failed check must not lock everyone out.
    console.error('mfa check failed:', err.message);
  }
  return next();
}

async function isHouseholdMember(userId, householdId) {
  if (!supabaseAdmin || !userId || !householdId) return false;
  const { data, error } = await supabaseAdmin
    .from('memberships')
    .select('user_id')
    .eq('user_id', userId)
    .eq('household_id', householdId)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return !!data?.user_id;
}

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.authUserId || req.ip,
  message: { error: 'יותר מדי בקשות AI, נסה שוב בעוד דקה' }
});

// ═══ stage 3: monthly AI quota per household (friends use the owner's AI keys) ═══
// households.ai_monthly_limit: null = unlimited (our own household), number = cap.
// Counts one per AI request, per calendar month (Israel time), in ai_usage.
async function aiQuota(req, res, next) {
  try {
    if (!supabaseAdmin || !req.authUserId) return next();
    const { data: m } = await supabaseAdmin.from('memberships').select('household_id').eq('user_id', req.authUserId).maybeSingle();
    if (!m) return next();
    const { data: hh, error: hhErr } = await supabaseAdmin.from('households').select('ai_monthly_limit').eq('id', m.household_id).maybeSingle();
    if (hhErr) return next();                       // column not there yet (DB not migrated) → don't block
    const month = israelToday().slice(0, 7);
    const { data: used } = await supabaseAdmin.rpc('bump_ai_usage', { p_household: m.household_id, p_month: month });
    const limit = ops.aiMonthlyLimit(hh && hh.ai_monthly_limit, process.env.AI_MONTHLY_DEFAULT);
    if (Number(used) > limit) {
      return res.status(429).json({ error: `הגעתם למכסת ה-AI החודשית (${limit} פעולות). היא מתאפסת בתחילת החודש הבא.`, quota: { used: Number(used) - 1, limit } });
    }
    return next();
  } catch (err) {
    // Never block a person on a quota bug; the daily cap for the whole app
    // (aiDay) still holds, so a bug cannot run up the bill.
    console.error('ai quota check failed:', err.message);
    return next();
  }
}
const notifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.authUserId || req.ip,
  message: { error: 'יותר מדי בקשות, נסה שוב בעוד דקה' }
});

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const PUSH_CONFIGURED = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (PUSH_CONFIGURED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function sendPushToUser(userId, { title, body, url }) {
  if (!PUSH_CONFIGURED) throw new Error('Push notifications not configured (missing VAPID keys)');
  if (!supabaseAdmin) throw new Error('Supabase admin client not configured');

  const { data: subs, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id,endpoint,p256dh,auth')
    .eq('user_id', String(userId));
  if (error) throw new Error(error.message);
  if (!subs || !subs.length) {
    const err = new Error('No push subscriptions found for this user');
    err.statusCode = 404;
    throw err;
  }

  // url: where a tap on the notification opens the app (a path under /app/).
  const payload = JSON.stringify({ title: title || 'ניהול תקציב', body: body || '', url: url || '/app/' });
  const results = await Promise.allSettled(subs.map((s) => webpush.sendNotification(
    { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
    payload
  )));

  const expiredIds = [];
  let sent = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { sent += 1; return; }
    const statusCode = r.reason && r.reason.statusCode;
    if (statusCode === 404 || statusCode === 410) expiredIds.push(subs[i].id);
  });
  if (expiredIds.length) {
    await supabaseAdmin.from('push_subscriptions').delete().in('id', expiredIds);
  }
  return { sent, total: subs.length, removedExpired: expiredIds.length };
}

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false') === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || '';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
// Brevo: sends over HTTPS (Render's free plan blocks SMTP), free up to 300 a
// day, from a single verified address (no domain of our own needed).
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_FROM = process.env.BREVO_FROM || '';
const BREVO_NAME = process.env.BREVO_NAME || 'התקציב שלנו';
// resend.dev works immediately with no domain setup -- fine for a personal
// app. Once/if a real domain is verified on the Resend account, set
// RESEND_FROM to an address on that domain instead.
const RESEND_FROM = process.env.RESEND_FROM || 'Budget App <onboarding@resend.dev>';

const mailer = SMTP_HOST && SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      // Some hosts (e.g. Render's free tier) silently drop outbound SMTP
      // connections instead of refusing them -- without explicit timeouts
      // nodemailer's defaults leave the request hanging for minutes with
      // no error surfaced to the caller. Fail fast instead.
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000
    })
  : null;

function extractJsonText(rawText) {
  const txt = String(rawText || '').trim();
  return txt.replace(/^```json\n?/i, '').replace(/```$/i, '').trim();
}

function toDataUrl(fileData, mimeType) {
  return `data:${mimeType};base64,${String(fileData || '')}`;
}

function getAvailableAiProviders() {
  const providers = [];
  if (ANTHROPIC_KEY) providers.push('claude');
  if (GEMINI_KEY) providers.push('gemini');
  if (GROK_KEY) providers.push('grok');
  return providers;
}

async function callClaude({ prompt, text, fileData, mimeType, effort = 'medium', maxTokens = 4096, model = ANTHROPIC_MODEL }) {
  const content = [
    { type: 'text', text: `${prompt}\n\n${String(text || '').slice(0, 12000)}` }
  ];

  if (fileData) {
    const normalizedMime = String(mimeType || '').toLowerCase().trim().replace('image/jpg', 'image/jpeg');
    const supportedImage = /^(image\/png|image\/jpeg|image\/webp)$/.test(normalizedMime);
    if (!supportedImage) {
      const err = new Error('Unsupported image mimeType. Use PNG/JPEG/WEBP.');
      err.statusCode = 400;
      throw err;
    }
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: normalizedMime, data: String(fileData) }
    });
  }

  const req = claudeRequest({ key: ANTHROPIC_KEY, model, maxTokens, content, effort });
  const response = await fetch(req.url, req.init);

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.type === 'error') {
    const err = new Error(data.error?.message || 'Claude provider error');
    err.status = response.status;
    throw err;
  }

  // A cut-off answer is broken JSON: say so, so the next provider is tried.
  if (data.stop_reason === 'max_tokens') {
    const err = new Error('Claude answer was cut off (max_tokens)');
    err.status = 500;
    throw err;
  }
  recordAi('claude', model, data.usage && data.usage.input_tokens, data.usage && data.usage.output_tokens);
  return {
    provider: 'claude',
    model,
    output: (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  };
}

async function callGemini({ prompt, text, fileData, mimeType, json = false }) {
  const parts = [{ text: `${prompt}\n\n${String(text || '').slice(0, 12000)}` }];
  if (fileData) {
    const normalizedMime = String(mimeType || '').toLowerCase().trim().replace('image/jpg', 'image/jpeg');
    const supportedImage = /^(image\/png|image\/jpeg|image\/webp)$/.test(normalizedMime);
    if (!supportedImage) {
      const err = new Error('Unsupported image mimeType. Use PNG/JPEG/WEBP.');
      err.statusCode = 400;
      throw err;
    }
    parts.push({ inline_data: { mime_type: normalizedMime, data: String(fileData) } });
  }

  const payload = {
    contents: [{ parts }],
    // A statement is structured work: no long thinking (it was 50k tokens a part).
    generationConfig: { temperature: 0.1, ...(json ? { responseMimeType: 'application/json', ...(/flash/.test(GEMINI_MODEL) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } : {}) }
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || 'Gemini provider error');
  }

  const um = data.usageMetadata || {};
  recordAi('gemini', GEMINI_MODEL, um.promptTokenCount, (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0));
  return {
    provider: 'gemini',
    model: GEMINI_MODEL,
    // The answer can come in several parts; thoughts are not part of it.
    output: (data?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('')
  };
}

async function callGrok({ prompt, text, fileData, mimeType }) {
  const content = [
    { type: 'text', text: `${prompt}\n\n${String(text || '').slice(0, 12000)}` }
  ];

  if (fileData) {
    const normalizedMime = String(mimeType || '').toLowerCase().trim().replace('image/jpg', 'image/jpeg');
    const supportedImage = /^(image\/png|image\/jpeg|image\/webp)$/.test(normalizedMime);
    if (!supportedImage) {
      const err = new Error('Unsupported image mimeType. Use PNG/JPEG/WEBP.');
      err.statusCode = 400;
      throw err;
    }

    content.push({
      type: 'image_url',
      image_url: { url: toDataUrl(fileData, normalizedMime) }
    });
  }

  const response = await fetch(`${GROK_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROK_KEY}`
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      temperature: 0.1,
      messages: [{ role: 'user', content }]
    })
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || 'Grok provider error');
  }

  recordAi('grok', GROK_MODEL, data.usage && data.usage.prompt_tokens, data.usage && data.usage.completion_tokens);
  return {
    provider: 'grok',
    model: GROK_MODEL,
    output: data?.choices?.[0]?.message?.content || ''
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(payload, { skipClaude = false } = {}) {
  const attempted = [];
  // Every advisor answer stays general information, not licensed advice (server/legal.js).
  if (payload && payload.prompt) payload = { ...payload, prompt: legal.withAdviceRule(payload.prompt) };

  if (ANTHROPIC_KEY && !skipClaude) {
    try {
      const result = await callClaude(payload);
      return { ...result, attempted };
    } catch (err) {
      attempted.push({ provider: 'claude', error: err.message || 'Unknown Claude error' });
      console.error('Claude failed:', err.status || '', err.message);
      // one retry after a short delay, same reasoning as the Gemini retry below --
      // most failures at this stage are transient (rate limit, momentary 5xx).
      // A request Claude rejects as wrong (4xx) fails the same way again.
      if (isRetryable(err.status)) try {
        await delay(1200);
        const retryResult = await callClaude(payload);
        return { ...retryResult, attempted };
      } catch (retryErr) {
        attempted.push({ provider: 'claude (retry)', error: retryErr.message || 'Unknown Claude error' });
      }
    }
  }

  if (GEMINI_KEY) {
    try {
      const result = await callGemini(payload);
      return { ...result, attempted };
    } catch (err) {
      attempted.push({ provider: 'gemini', error: err.message || 'Unknown Gemini error' });
      // one retry after a short delay — most Gemini failures are transient
      // (rate limit blips, momentary 5xx), and the Grok fallback below may
      // not always be available, so it's worth not giving up on Gemini too fast.
      try {
        await delay(1200);
        const retryResult = await callGemini(payload);
        return { ...retryResult, attempted };
      } catch (retryErr) {
        attempted.push({ provider: 'gemini (retry)', error: retryErr.message || 'Unknown Gemini error' });
      }
    }
  }

  if (GROK_KEY) {
    try {
      const result = await callGrok(payload);
      return { ...result, attempted };
    } catch (err) {
      attempted.push({ provider: 'grok', error: err.message || 'Unknown Grok error' });
    }
  }

  const err = new Error(
    attempted.length
      ? `All AI providers failed. ${attempted.map((x) => `${x.provider}: ${x.error}`).join(' | ')}`
      : 'No AI providers configured'
  );
  err.attempted = attempted;
  throw err;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isGoogleOAuthConfigured() {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_OAUTH_REDIRECT_URI);
}

function getGoogleOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI
  );
}

function encodeMimeHeader(value) {
  return `=?UTF-8?B?${Buffer.from(String(value || ''), 'utf8').toString('base64')}?=`;
}

function toBase64Url(input) {
  return Buffer.from(String(input || ''), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function isGoogleChatWebhookUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' && /(^|\.)chat\.googleapis\.com$/i.test(url.hostname);
  } catch (_err) {
    return false;
  }
}

function normalizeWhatsappPhone(value) {
  let v = String(value || '').trim().replace(/\s+/g, '');
  if (!v) return '';
  v = v.replace(/^\+/, '');
  v = v.replace(/^00/, '');
  v = v.replace(/[^\d]/g, '');
  return v;
}

async function sendGoogleChatMessage({ webhookUrl, text }) {
  const url = String(webhookUrl || '').trim();
  if (!isGoogleChatWebhookUrl(url)) {
    throw new Error('Invalid Google Chat webhook URL');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ text: String(text || '').slice(0, 3500) }),
      signal: controller.signal
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`Google Chat webhook failed (${response.status}): ${details || 'Unknown error'}`);
    }

    return { provider: 'google-chat', status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

async function sendWhatsAppCallMeBot({ phone, apiKey, text }) {
  const normalizedPhone = normalizeWhatsappPhone(phone);
  const key = String(apiKey || '').trim();
  if (!normalizedPhone || !key) {
    throw new Error('WhatsApp phone or ApiKey is missing');
  }

  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', normalizedPhone);
  url.searchParams.set('text', String(text || '').slice(0, 2000));
  url.searchParams.set('apikey', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: controller.signal
    });
    const details = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(`WhatsApp send failed (${response.status}): ${details || 'Unknown error'}`);
    }
    return { provider: 'whatsapp-callmebot', status: response.status, details };
  } finally {
    clearTimeout(timer);
  }
}

async function resolveIntegrationsForChannelTest({ userId, householdId, integrations }) {
  const fromPayload = integrations && typeof integrations === 'object' ? integrations : {};
  let fromSettings = {};

  if (userId) {
    try {
      const settings = await getUserSettings(userId);
      fromSettings = settings?.integrations && typeof settings.integrations === 'object' ? settings.integrations : {};
    } catch (_err) {
      fromSettings = {};
    }
  } else if (supabaseAdmin && householdId) {
    try {
      const { data } = await supabaseAdmin
        .from('user_settings')
        .select('integrations')
        .eq('household_id', String(householdId))
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      fromSettings = data?.integrations && typeof data.integrations === 'object' ? data.integrations : {};
    } catch (_err) {
      fromSettings = {};
    }
  }

  return {
    ...fromSettings,
    ...fromPayload
  };
}

async function getUserSettings(userId) {
  if (!supabaseAdmin) return null;
  const id = String(userId || '').trim();
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from('user_settings')
    .select('*')
    .eq('user_id', id)
    .maybeSingle();
  if (error) throw new Error(error.message || 'Failed to read user settings');
  return data || null;
}

async function sendViaGoogleMail({ userId, to, subject, html, text }) {
  if (!isGoogleOAuthConfigured()) {
    throw new Error('Google OAuth is not configured');
  }

  const settings = await getUserSettings(userId);
  const googleMail = settings?.integrations?.googleMail;
  if (!googleMail?.connected || !googleMail?.refreshToken || !googleMail?.email) {
    throw new Error('Google Mail is not connected for this user');
  }

  const oauthClient = getGoogleOAuthClient();
  oauthClient.setCredentials({
    refresh_token: googleMail.refreshToken,
    access_token: googleMail.accessToken || undefined,
    expiry_date: googleMail.expiryDate || undefined
  });

  const contentType = html ? 'text/html; charset="UTF-8"' : 'text/plain; charset="UTF-8"';
  const body = html || text || '';

  const raw = [
    `From: ${googleMail.email}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}`,
    '',
    body
  ].join('\r\n');

  const gmail = google.gmail({ version: 'v1', auth: oauthClient });
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: toBase64Url(raw)
    }
  });

  return { provider: 'google-gmail', from: googleMail.email };
}

async function sendViaBrevo({ to, subject, html, text, headers }) {
  if (!BREVO_API_KEY || !BREVO_FROM) throw new Error('Brevo is not configured');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20000);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      signal: ac.signal,
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: BREVO_NAME, email: BREVO_FROM },
        replyTo: { email: BREVO_FROM },
        to: String(to).split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email })),
        subject,
        htmlContent: html || undefined,
        textContent: text || undefined,
        headers: headers || undefined
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('brevo: ' + (data.message || data.code || 'request failed (' + res.status + ')'));
    return { provider: 'brevo', from: BREVO_FROM };
  } finally { clearTimeout(t); }
}

async function sendViaResend({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    throw new Error('Resend is not configured');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [to],
      subject,
      html: html || undefined,
      text: text || (html ? undefined : ' ')
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || `Resend request failed (${res.status})`);
  }
  return { provider: 'resend', from: RESEND_FROM };
}

async function sendMailWithFallback({ userId, to, subject, html, text, headers }) {
  const errors = [];

  if (BREVO_API_KEY && BREVO_FROM) {
    try {
      return await sendViaBrevo({ to, subject, html, text, headers });
    } catch (err) {
      errors.push(err.message || String(err));
    }
  }

  if (RESEND_API_KEY) {
    try {
      return await sendViaResend({ to, subject, html, text });
    } catch (err) {
      errors.push(`resend: ${err.message || err}`);
    }
  }

  if (userId && isGoogleOAuthConfigured()) {
    try {
      return await sendViaGoogleMail({ userId, to, subject, html, text });
    } catch (err) {
      errors.push(`google-gmail: ${err.message || err}`);
    }
  }

  if (mailer) {
    try {
      await mailer.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text,
        html
      });
      return { provider: 'smtp', from: SMTP_FROM };
    } catch (err) {
      errors.push(`smtp: ${err.message || err}`);
    }
  }

  throw new Error(errors.length ? errors.join(' | ') : 'No email provider is configured');
}

// Which version of the code is running, and since when (Render names the
// commit it deployed): to tell whether an update really went up.
const STARTED_AT = new Date().toISOString();
// Public: only that the server is up. The details are for the owner.
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/admin/health', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  const availableAiProviders = getAvailableAiProviders();
  return res.json({
    ok: true,
    version: String(process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null,
    startedAt: STARTED_AT,
    aiConfigured: availableAiProviders.length > 0,
    aiProviders: availableAiProviders,
    claudeModel: ANTHROPIC_MODEL,
    claudeFilesModel: ANTHROPIC_FILES_MODEL,
    geminiModel: GEMINI_MODEL,
    grokModel: GROK_MODEL,
    googleOAuthConfigured: isGoogleOAuthConfigured(),
    supabaseConfigured: !!supabaseAdmin,
    smtpConfigured: !!mailer,
    resendConfigured: !!RESEND_API_KEY,
    brevoConfigured: !!(BREVO_API_KEY && BREVO_FROM),
    pushConfigured: PUSH_CONFIGURED
  });
});

app.post('/api/ai/import', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) {
      return res.status(503).json({ error: 'No AI key configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY and/or GROK_API_KEY' });
    }

    const { prompt, text, fileData, mimeType } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (!text && !fileData) {
      return res.status(400).json({ error: 'text or fileData is required' });
    }

    // Reading a statement is structured work: little thinking, room for a
    // long JSON answer (a part of the statement is ~40 lines; a cut-off
    // answer would fall through to the next provider).
    const aiResult = await generateWithFallback({ prompt, text, fileData, mimeType, effort: 'low', maxTokens: 32000, json: true, model: ANTHROPIC_FILES_MODEL });
    const output = aiResult.output || '[]';
    let parsed = null;
    try {
      parsed = JSON.parse(extractJsonText(output));
    } catch (_err) {
      const candidate = String(output).match(/\[[\s\S]*\]/);
      if (candidate && candidate[0]) {
        try {
          parsed = JSON.parse(candidate[0]);
        } catch (_err2) {
          parsed = null;
        }
      }
    }

    // {"transactions":[...]} is the same answer in a wrapper.
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') parsed = Object.values(parsed).find(Array.isArray) || null;
    if (!Array.isArray(parsed)) {
      // An answer we cannot read is a failure, not "no transactions".
      reportServerError(new Error('import: unreadable AI answer (' + aiResult.provider + ')'), 'POST /api/ai/import');
      return res.status(502).json({ error: 'ה-AI החזיר תשובה לא קריאה. נסו שוב.', aiProvider: aiResult.provider });
    }

    return res.json({
      transactions: parsed,
      output: JSON.stringify(parsed),
      rawOutput: output,
      aiProvider: aiResult.provider,
      aiModel: aiResult.model,
      attemptedProviders: aiResult.attempted
    });
  } catch (err) {
    const statusCode = err.statusCode || 502;
    reportServerError(err, 'POST /api/ai/import');
    return res.status(statusCode).json({
      error: statusCode === 502 ? 'ה-AI לא זמין כרגע. נסו שוב בעוד דקה.' : err.message || 'Unexpected error',
      attemptedProviders: (err.attempted || []).map((a) => a.provider)
    });
  }
});




app.post('/api/chat/parse', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });

    if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) {
      const amountMatch = String(text).match(/(\d+[\.,]?\d*)/);
      const amount = amountMatch ? Number(amountMatch[1].replace(',', '.')) : 0;
      const isIncome = /משכורת|הכנסה|נכנס|קיבלתי/i.test(String(text));
      return res.json({
        type: isIncome ? 'income' : 'expense',
        amount,
        description: text,
        date: new Date().toISOString().slice(0, 10)
      });
    }

    const prompt = [
      'Extract one budget transaction from this chat message.',
      'Return JSON only:',
      '{"type":"expense|income","amount":number,"description":"text","date":"YYYY-MM-DD"}',
      `Message: ${text}`
    ].join('\n');

    const aiResult = await generateWithFallback({ prompt, text });
    const output = aiResult.output || '{}';
    return res.json({
      ...JSON.parse(extractJsonText(output)),
      _ai: {
        provider: aiResult.provider,
        model: aiResult.model,
        attemptedProviders: aiResult.attempted
      }
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Unexpected error', attemptedProviders: err.attempted || [] });
  }
});

let marketQuoteCache = null; // { data, fetchedAt } -- refreshed at most every 5 min
let boiCache = null; // { rate, at, fetchedAt }
async function fetchBoiUsd() {
  if (boiCache && Date.now() - boiCache.fetchedAt < 30 * 60 * 1000) return boiCache;
  const res = await fetch('https://boi.org.il/PublicApi/GetExchangeRates');
  const xml = await res.text();
  const block = (xml.split('</ExchangeRateResponseDTO>').find((b) => /<Key>USD<\/Key>/.test(b))) || '';
  const rate = Number((block.match(/<CurrentExchangeRate>([\d.]+)<\/CurrentExchangeRate>/) || [])[1]);
  const at = (block.match(/<LastUpdate>([^<]+)<\/LastUpdate>/) || [])[1] || null;
  if (!res.ok || !rate) throw new Error('BOI rate unavailable');
  boiCache = { rate, at, fetchedAt: Date.now() };
  return boiCache;
}
// Live rate for valuation; the official BOI representative rate is shown next to it.
async function fetchUsdIlsDetailed() {
  try {
    const q = await fetchYahooQuote('ILS=X');
    if (q && q.price) return { rate: q.price, at: q.at, source: 'live' };
  } catch (_e) { /* fall through */ }
  try {
    const b = await fetchBoiUsd();
    return { rate: b.rate, at: b.at, source: 'boi' };
  } catch (_e) { /* fall through */ }
  const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=ILS');
  const data = await res.json();
  const rate = data?.rates?.ILS;
  if (!res.ok || !rate) throw new Error('USD/ILS rate unavailable');
  return { rate: Number(rate), at: data.date || null, source: 'ecb' };
}
async function fetchUsdIls() { return (await fetchUsdIlsDetailed()).rate; }
const quoteCache = new Map(); // symbol -> { data, fetchedAt }
async function fetchYahooQuote(symbol) {
  const hit = quoteCache.get(symbol);
  if (hit && Date.now() - hit.fetchedAt < 5 * 60 * 1000) return hit.data;
  const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=1d&range=1mo', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const m = r?.meta;
  if (!res.ok || !m || !m.regularMarketPrice) throw new Error('no quote for ' + symbol);
  const closes = (r.indicators?.quote?.[0]?.close || []).filter((x) => x != null);
  const prev = m.previousClose ?? m.chartPreviousClose;
  const weekAgo = closes.length > 5 ? closes[closes.length - 6] : null;
  const data = {
    symbol,
    price: Number(m.regularMarketPrice),
    currency: m.currency || 'USD',
    changePct: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : null,
    weekChangePct: weekAgo ? ((m.regularMarketPrice - weekAgo) / weekAgo) * 100 : null,
    at: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
    name: m.shortName || m.longName || symbol
  };
  quoteCache.set(symbol, { data, fetchedAt: Date.now() });
  return data;
}
async function fetchSpyQuote() {
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=5d', {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice;
    const prevClose = result?.meta?.previousClose ?? result?.meta?.chartPreviousClose;
    if (!res.ok || !price) throw new Error('no price');
    return { price: Number(price), changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : null };
  } catch (_err) {
    // fallback: Stooq CSV, no API key needed either -- "s,d,t,o,h,l,c,v" header row + one data row
    const res = await fetch('https://stooq.com/q/l/?s=spy.us&f=sd2t2ohlcv&h&e=csv');
    const csv = await res.text();
    const lines = csv.trim().split('\n');
    if (lines.length < 2) throw new Error('SPY price unavailable');
    const cols = lines[1].split(',');
    const close = Number(cols[6]);
    const open = Number(cols[3]);
    if (!close) throw new Error('SPY price unavailable');
    return { price: close, changePct: open ? ((close - open) / open) * 100 : null };
  }
}
// ═══ dates in Israel ═══
function israelToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()); // YYYY-MM-DD
}
function addDaysIso(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}


// ═══ advisor chat v2: streaming (SSE), shared conversations, follow-up chips ═══
const SUGG_MARK = '@@הצעות:';
const FIX_MARK = '@@שינויים:';
function buildFixContext(candidates, categories) {
  if (!Array.isArray(candidates) || !candidates.length) return '';
  const rows = candidates.slice(0, 60).map((t) => [t.id, t.date, t.type === 'income' ? '+' : '-', t.amount, String(t.description || '').slice(0, 60), t.category || '', t.subcategory || ''].join(' | ')).join('\n');
  const cats = (Array.isArray(categories) ? categories : []).slice(0, 120).map((c) => c.parent ? `${c.parent} > ${c.name}` : c.name).join(', ');
  return `
מצב סוכן: אם המשתמש מבקש לתקן, למחוק, להעביר קטגוריה או לשנות תנועות — אל תשנה בעצמך. הצע שינויים והמשתמש יאשר.
כתוב משפט או שניים שמסבירים מה מצאת, ואז בשורה נפרדת: ${FIX_MARK} ואחריו JSON בשורה אחת:
{"ops":[{"op":"update","id":"<id מהרשימה>","set":{"category":"<שם קטגוריה ראשית קיים>","subcategory":"<שם תת-קטגוריה קיים או null>","amount":0,"tx_date":"YYYY-MM-DD","description":"..."},"reason":"קצר"},{"op":"delete","id":"<id>","reason":"קצר"}]}
ב-set כלול רק את השדות שמשתנים. השתמש רק ב-id מהרשימה ורק בשמות קטגוריות מהרשימה. עד 20 פעולות. אם לא בטוח איזו תנועה — שאל במקום להציע. מחיקה רק לכפילות ברורה או כשהמשתמש ביקש.
שורת ${FIX_MARK} באה לפני שורת ${SUGG_MARK}. אם אין בקשת תיקון — אל תכתוב ${FIX_MARK} בכלל.
תנועות רלוונטיות (id | תאריך | כיוון | סכום | תיאור | קטגוריה | תת-קטגוריה):
${rows}
קטגוריות קיימות: ${cats}`;
}
// How the advisor writes, everywhere: the screen's numbers exactly, short,
// the number first, no chatbot filler.
const ADVISOR_STYLE = `מספרים: העתק כל סכום בדיוק כמו שהוא מופיע בנתונים (יתרה, תחזית, נשאר להוציא, סכום קנייה). אל תחשב בעצמך סכומים, הפרשים או ממוצעים שלא מופיעים בנתונים. אם חייבים הערכה, כתוב "בערך" ועגל למאות. אם מספר לא מופיע בנתונים, אמור שאין לך אותו.
סגנון: תשובה רגילה עד 4 משפטים. קודם המספר שעונה על השאלה, אחר כך המלצה אחת ברורה. בלי פתיחות כמו "אני מבין ש...", "שאלה מצוינת" או "חשוב לך מאוד", ובלי לחזור על מה שנכתב לך.
פנייה: אל תפנה בשם משתמש או בכתובת מייל. פנה בשם רק אם זה שם פרטי, ורק כשזה טבעי.
מספרים שהמשתמש כתב בשיחה: העתק אותם בדיוק (סכום, סימן פלוס או מינוס, ולמי הם שייכים). כשהוא מתקן אותך, השתמש מעכשיו בתיקון, אמור במשפט אחד מה תיקנת, ואל תחבר שוב סכום שכבר נספר.
חשבון: כשמבקשים ממך לחשב, כתוב את החישוב בשורות קצרות, כל שורה בצורה "א + ב − ג = תוצאה", עם כל המספרים, ובדוק כל תוצאה לפני שאתה כותב אותה.
אל תחזור על עצה שכבר נתת בשיחה, אלא אם יש בה משהו חדש. אם ההודעה לא ברורה (מילה משובשת, מספרים שסותרים זה את זה), שאל שאלה אחת קצרה במקום לנחש.
התחזית (comingMonths) היא אותו חישוב שמופיע באפליקציה בתוכניות ← "החודשים הקרובים". על חודשים קדימה ועל כמה יישאר, השתמש רק במספרים ממנה (net, endBalance) ואל תבנה תחזית משלך. כשאתה מזכיר מספר ממנה, אמור ממה הוא מורכב לפי השורות (lines). אם המשתמש סיפר משהו שעוד לא מופיע בה, אמור שהמספר יתעדכן אחרי שהאפליקציה תשמור את מה שסיפר, ותן את ההשפעה כחישוב שורה לשורה.
עדכונים: האפליקציה מעדכנת לבד את היתרות בחשבונות, ההכנסה הצפויה של כל אחד, יעדים, תקציבים, הלוואות, תשלומים קבועים או בתשלומים למספר ידוע של חודשים (הם נכנסים לתחזית), וגם רושמת לבד הכנסה שכבר נכנסה או הוצאה שכבר ירדה ("המשכורת נכנסה", "הלימודים ירדו"), מתוך מה שמספרים לך, אלא אם ביקשו לא לעדכן. במקרה כזה כתוב בקצרה שזה נרשם (יופיע מתחת לתשובה עם אפשרות ביטול). אל תבקש להזין ביד או "דרך ה-+" משהו שכבר סיפרו לך, ואל תטען שמשהו מופיע במערכת אם הוא לא בנתונים.
מחיקת תנועות: כשהמשתמש מבקש למחוק תנועה שגויה, אמור שהאפליקציה תציג מתחת לשיחה את התנועות למחיקה לאישור שלו (ומה שנמחק אפשר לשחזר 30 יום). אל תאמר שאינך יכול.
טעויות בנתונים: אל תטען שיש טעות, כפילות או חיוב כפול בלי לראות אותו בתנועות עצמן. ב-topMerchants, total3Months הוא סך כל החיובים ב-3 החודשים (charges חיובים, ואם eachCharge מופיע כל חיוב הוא בסכום הזה), לא סכום של חיוב אחד.`;
// How the app works (screens, buttons, what can and cannot be done), from
// the same guide the app uses for its instant answers.
let APP_GUIDE = '';
import(require('url').pathToFileURL(path.join(__dirname, 'public/app/src/content/howto.js')).href)
  .then((m) => { APP_GUIDE = m.guideText(); })
  .catch((err) => console.error('App guide not loaded:', err.message));
function appGuidePart() {
  return APP_GUIDE ? `\nהמדריך של האפליקציה (מה יש בכל מסך ואיך עושים כל פעולה):\n${APP_GUIDE}\nכשהשאלה היא איך עושים משהו באפליקציה, איפה משהו נמצא או מה אפשר לעשות בה: ענה לפי המדריך בלבד, בצעדים קצרים עם השמות המדויקים של הכפתורים והחצים (←). אל תמציא כפתור, מסך או אפשרות שלא כתובים במדריך. אם משהו לא קיים, אמור זאת בפשטות והצע דרך אחרת מהמדריך, או לכתוב לנו בפרופיל ← "תקלות ורעיונות לשיפור". כשמתאים, גם בתשובה על הכסף, הפנה למסך שבו רואים או עושים את זה.\n` : '';
}
// Where the person is using the app: the same screens, laid out differently.
function devicePart(device) {
  if (device === 'desktop') return '\nהמשתמש כותב ממחשב (מסך רחב): המסכים בתפריט בצד ימין, והפרופיל וההגדרות בכפתור עם השם בתחתית התפריט הזה. כשאתה מסביר איך מגיעים למשהו, תאר את זה כך.\n';
  if (device === 'mobile') return '\nהמשתמש כותב מטלפון: המסכים בסרגל בתחתית, והפרופיל וההגדרות בכפתור העגול עם האותיות בפינה העליונה. כשאתה מסביר איך מגיעים למשהו, תאר את זה כך.\n';
  return '';
}
function buildChatPrompt(summary, history, message, authorName, fixContext, authorGender) {
  // The last 12 messages; the 4 newest in full, older ones shortened (tokens).
  const recent = Array.isArray(history) ? history.slice(-12) : [];
  const historyText = recent.map((h, i) => `${h.role === 'user' ? (h.author || 'משתמש') : 'יועץ'}: ${String(h.text || '').slice(0, i >= recent.length - 4 ? 2000 : 400)}`).join('\n');
  return `אתה יועץ פיננסי חם, ענייני ומקצועי למשק בית בישראל. עונים בעברית פשוטה.
בשיחה יכולים להשתתף שני בני הזוג; ההודעה הנוכחית נכתבה על ידי ${authorName || 'אחד מבני הבית'}.${authorGender === 'f' ? ' פנה אליה בלשון נקבה.' : authorGender === 'm' ? ' פנה אליו בלשון זכר.' : ' אם צריך לפנות אליו או אליה, נסח בלי מגדר (למשל "כדאי", "אפשר").'}
הנתונים (JSON) כוללים categorySpendingHistory ברמת משק הבית, personalCategoryBreakdown של המשתמש, תקציבים, יעדים ומשימות. ענה על סמך המספרים בפועל, בלי markdown ובלי כותרות.
${ADVISOR_STYLE}${appGuidePart()}
בהחלטות גדולות (משכנתא, השקעות) תן מידע, חישובים ושאלות לבדיקה, וציין שכדאי להתייעץ עם יועץ מורשה; אל תמליץ על נייר ערך או מוצר ספציפי.
אם בנתונים יש memories (החלטות והעדפות שבני הזוג קבעו בעבר): התחשב בהן כעובדה, אל תציע משהו שסותר אותן אלא אם שואלים, ואם משהו השתנה — שאל.
בנתונים יש גם את פירוט ההוצאה: topMerchants (בתי העסק שהכי הרבה כסף הלך אליהם ב-3 החודשים האחרונים), recurring (חיובים שחוזרים כל חודש בסכום דומה: מנויים וחשבונות קבועים), recentTransactions (התנועות האחרונות), וגם accounts, cards, loans, installments. כשהשאלה נוגעת להם, ענה לפי השורות האמיתיות ושמות בתי העסק (למשל איזה מנוי לבטל, לאן הלך הכסף באוכל), ולא בהכללות.
אם בנתונים יש sharedDecisions (קניות שבני הזוג מחליטים עליהן יחד, עם הסטטוס): כשזה רלוונטי, עזור להחליט לפי המספרים, הצג את השיקולים של שני הצדדים ואל תיקח צד.
אם בנתונים יש feelings (איך בני הזוג מרגישים השבוע עם הכסף): כשמישהו "stressed" — טון רגוע, צעד אחד קטן בכל פעם, הזכר מה כבר הולך טוב; כשכולם "calm" — אפשר להציע יעד גדול יותר. אל תכתוב "ראיתי שאתה לחוץ" אלא אם שאלו.
בסוף התשובה, בשורה נפרדת, כתוב בדיוק: ${SUGG_MARK} ואחריו 2-3 שאלות המשך קצרות (עד 5 מילים כל אחת) מופרדות ב-|.
${fixContext || ''}
${historyText ? '\nהשיחה עד עכשיו:\n' + historyText + '\n' : ''}
ההודעה הנוכחית (${authorName || 'משתמש'}): ${message}`;
}

app.post('/api/ai/advice-chat-stream', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  const { summary, history, message, authorName, authorGender, candidates, categories, device } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) return res.status(503).json({ error: 'No AI key configured' });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const prompt = legal.withAdviceRule(buildChatPrompt(summary, history, message, String(authorName || '').slice(0, 40), buildFixContext(candidates, categories), authorGender) + devicePart(device));
  // The household's numbers and lines (about 6-8k tokens at most).
  const text = JSON.stringify(summary || {}).slice(0, 24000);
  try {
    if (ANTHROPIC_KEY) {
      const cr = claudeRequest({ key: ANTHROPIC_KEY, model: ANTHROPIC_MODEL, maxTokens: 3000, stream: true, content: `${prompt}\n\n${text}`, effort: 'medium' });
      const r = await fetch(cr.url, cr.init);
      if (!r.ok) console.error('Claude stream failed:', r.status, (await r.text().catch(() => '')).slice(0, 300));
      if (r.ok && r.body) {
        const decoder = new TextDecoder();
        let buf = '';
        let tokensIn = 0, tokensOut = 0;
        for await (const chunk of r.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const evt = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = evt.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
              const d = JSON.parse(line.slice(6));
              if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') send({ delta: d.delta.text });
              else if (d.type === 'message_start' && d.message && d.message.usage) tokensIn = d.message.usage.input_tokens || 0;
              else if (d.type === 'message_delta' && d.usage) tokensOut = d.usage.output_tokens || 0;
            } catch (_e) { /* ignore keep-alives */ }
          }
        }
        recordAi('claude', ANTHROPIC_MODEL, tokensIn, tokensOut);
        send({ done: true, provider: 'claude' });
        return res.end();
      }
    }
    // fallback: no streaming — whole answer as one chunk. Claude was just
    // tried, so go straight to the other providers.
    const ai = await generateWithFallback({ prompt, text }, { skipClaude: !!ANTHROPIC_KEY });
    send({ delta: String(ai.output || '').trim() });
    send({ done: true, provider: ai.provider });
    return res.end();
  } catch (err) {
    console.error('advice-chat-stream failed:', err.message);
    send({ error: 'היועץ לא הצליח לענות כרגע. נסו שוב בעוד דקה.' });
    return res.end();
  }
});

// Called once a day by Supabase pg_cron (job "advisor-task-reminders").
// Auth: X-Cron-Secret must equal app_secrets.cron_secret (service-role only table).
app.post('/api/tasks/remind-due', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
    const given = String(req.headers['x-cron-secret'] || '');
    const { data: sec } = await supabaseAdmin.from('app_secrets').select('value').eq('key', 'cron_secret').maybeSingle();
    const expected = sec && sec.value ? String(sec.value) : '';
    const a = Buffer.from(given), b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const today = israelToday();
    const { data: tasks, error } = await supabaseAdmin
      .from('advisor_tasks')
      .select('id,user_id,title,due_date,last_reminded_on')
      .eq('status', 'open').eq('remind', true).lte('due_date', today);
    if (error) throw new Error(error.message);

    // due today → every day; overdue → every 3 days (nudge, not nag)
    const daysBetween = (x, y) => Math.round((new Date(y) - new Date(x)) / 864e5);
    const due = (tasks || []).filter((t) => t.last_reminded_on !== today && (
      t.due_date === today || !t.last_reminded_on || daysBetween(t.last_reminded_on, today) >= 3));

    const byUser = new Map();
    due.forEach((t) => { if (!byUser.has(t.user_id)) byUser.set(t.user_id, []); byUser.get(t.user_id).push(t); });

    let sentUsers = 0;
    for (const [userId, list] of byUser) {
      const overdue = list.filter((t) => t.due_date < today).length;
      const title = list.length === 1 ? '📋 משימה מהיועץ מחכה לך' : `📋 ${list.length} משימות מהיועץ מחכות לך`;
      const body = list[0].title + (list.length > 1 ? ` ועוד ${list.length - 1}` : '') + (overdue ? ` (${overdue} באיחור)` : '');
      try {
        await sendPushToUser(userId, { title, body, url: '/app/?action=ask' });
        sentUsers += 1;
      } catch (_e) { /* no subscription for this user – the in-app list still shows it */ }
      await supabaseAdmin.from('advisor_tasks').update({ last_reminded_on: today }).in('id', list.map((t) => t.id));
    }
    let decisionReminders = 0;
    try { decisionReminders = await remindDecisions(); } catch (e) { console.warn('decision reminders', e.message); }
    return res.json({ ok: true, today, dueTasks: due.length, usersNotified: sentUsers, decisionReminders });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══ "מחליטים ביחד": tell the partners about a card or an answer ═══
const decisionLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.authUserId || req.ip });
// Deleting my account: the person's own login, and every household they are
// alone in. A shared household stays with the partner. The word "מחיקה" must
// be sent, so a stray request cannot do it.
app.post('/api/account/delete', requireAuth, notifyLimiter, async (req, res) => {
  if (String((req.body || {}).confirm || '').trim() !== 'מחיקה') return res.status(400).json({ error: 'נדרש אישור' });
  try {
    const done = await account.deleteAccount(supabaseAdmin, req.authUserId);
    console.log('[account] deleted', req.authUserId, 'households removed:', done.remove.length, 'left:', done.leave.length);
    return res.json({ ok: true, removed: done.remove.length, left: done.leave.length });
  } catch (err) {
    console.error('[account] delete failed', req.authUserId, err.message);
    return res.status(500).json({ error: 'המחיקה לא הושלמה. נסו שוב, ואם זה חוזר פנו אלינו.' });
  }
});

app.post('/api/decisions/notify', requireAuth, decisionLimiter, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Supabase not configured' });
    const { decisionId, event } = req.body || {};
    if (!decisionId || !['opened', 'answered', 'message', 'advisor', 'concluded', 'bought', 'withdrawn'].includes(event)) return res.status(400).json({ error: 'bad request' });
    const { data: decision } = await supabaseAdmin.from('shared_decisions').select('*').eq('id', decisionId).maybeSingle();
    if (!decision || !(await isHouseholdMember(req.authUserId, decision.household_id))) return res.status(404).json({ error: 'not found' });
    const [{ data: members }, { data: vote }, { data: last }] = await Promise.all([
      supabaseAdmin.from('memberships').select('user_id,display_name').eq('household_id', decision.household_id),
      supabaseAdmin.from('decision_votes').select('vote,note').eq('decision_id', decisionId).eq('user_id', req.authUserId).maybeSingle(),
      // The newest message the caller wrote (or asked the advisor for) in the card's conversation.
      supabaseAdmin.from('decision_messages').select('role,text').eq('decision_id', decisionId).eq('author_id', req.authUserId).eq('role', event === 'advisor' ? 'ai' : 'user').order('created_at', { ascending: false }).limit(1)
    ]);
    const message = (event === 'message' || event === 'advisor') && last && last[0] ? last[0] : null;
    let sent = 0;
    for (const m of decisionsPush.messagesFor(event, { decision, actorId: req.authUserId, members: members || [], vote, message })) {
      try { await sendPushToUser(m.to, m); sent += 1; } catch (_e) { /* no subscription on that phone: the badge in the app still shows it */ }
    }
    return res.json({ ok: true, sent });
  } catch (err) {
    console.error('decisions/notify failed:', err.message);
    return res.status(500).json({ ok: false });
  }
});

// Once a day (with the task reminders): cards nobody answered for a day.
async function remindDecisions() {
  const { data: decisions, error } = await supabaseAdmin.from('shared_decisions').select('id,household_id,created_by,title,amount,status,created_at,reminded_at').eq('status', 'open').is('reminded_at', null);
  if (error || !decisions || !decisions.length) return 0;
  const hids = [...new Set(decisions.map((d) => d.household_id))];
  const [{ data: votes }, { data: members }] = await Promise.all([
    supabaseAdmin.from('decision_votes').select('decision_id,user_id').in('decision_id', decisions.map((d) => d.id)),
    supabaseAdmin.from('memberships').select('household_id,user_id').in('household_id', hids)
  ]);
  const list = decisionsPush.reminders({ decisions, votes: votes || [], members: members || [] });
  for (const m of list) { try { await sendPushToUser(m.to, m); } catch (_e) { /* no subscription */ } }
  const ids = [...new Set(list.map((m) => m.decisionId))];
  if (ids.length) await supabaseAdmin.from('shared_decisions').update({ reminded_at: new Date().toISOString() }).in('id', ids);
  return list.length;
}

// Prices and rates come from outside services: a cap per person, so no one
// can make the server hammer them.
const marketLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.authUserId || req.ip, message: { error: 'יותר מדי בקשות, נסו שוב בעוד דקה' } });
app.get('/api/market/quote', requireAuth, marketLimiter, async (req, res) => {
  try {
    const force = req.query.force === '1';
    if (!force && marketQuoteCache && Date.now() - marketQuoteCache.fetchedAt < 5 * 60 * 1000) {
      return res.json(marketQuoteCache.data);
    }
    const [fx, spy, boi] = await Promise.all([fetchUsdIlsDetailed(), fetchSpyQuote(), fetchBoiUsd().catch(() => null)]);
    const usdIls = fx.rate;
    const data = {
      usdIls,
      usdIlsAt: fx.at,
      usdIlsSource: fx.source,
      boi: boi ? { rate: boi.rate, at: boi.at } : null,
      spy: { priceUsd: spy.price, priceIls: spy.price * usdIls, changePct: spy.changePct },
      fetchedAt: new Date().toISOString()
    };
    marketQuoteCache = { data, fetchedAt: Date.now() };
    return res.json(data);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Market data unavailable' });
  }
});

// ═══ stage 2: market quotes for any holdings ═══
// ═══ exchange rate for a date (adding an expense in dollars, euros, pounds) ═══
const fxCache = new Map(); // "USD:2026-09-15" -> { rate, date, source }
app.get('/api/fx/rate', requireAuth, marketLimiter, async (req, res) => {
  const currency = String(req.query.currency || '').toUpperCase();
  const date = String(req.query.date || '');
  if (!fx.validRequest(currency, date, israelToday())) return res.status(400).json({ error: 'bad request' });
  const key = currency + ':' + date;
  if (fxCache.has(key)) return res.json(fxCache.get(key));
  let hit = null;
  try {
    const r = await fetch(fx.boiUrl(currency, date));
    if (r.ok) { const b = fx.parseBoiCsv(await r.text(), date); if (b) hit = { ...b, source: 'boi' }; }
  } catch (_e) { /* next source */ }
  if (!hit) {
    try {
      const r = await fetch(fx.frankfurterUrl(currency, date));
      if (r.ok) { const f = fx.parseFrankfurter(await r.json()); if (f) hit = { ...f, source: 'ecb' }; }
    } catch (_e) { /* next */ }
  }
  if (!hit && currency === 'USD' && date === israelToday()) {
    try { const b = await fetchBoiUsd(); hit = { rate: b.rate, date, source: 'boi' }; } catch (_e) { /* none */ }
  }
  if (!hit) return res.status(502).json({ error: 'לא הצלחנו להביא שער לתאריך הזה. אפשר להקליד את הסכום בשקלים.' });
  // Past days do not change; today's rate may still be published later.
  if (date < israelToday()) fxCache.set(key, hit);
  return res.json(hit);
});

app.get('/api/market/quotes', requireAuth, marketLimiter, async (req, res) => {
  try {
    const symbols = String(req.query.symbols || '').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9.\-=^]{1,15}$/.test(x)).slice(0, 20);
    const [fx, boi] = await Promise.all([fetchUsdIlsDetailed(), fetchBoiUsd().catch(() => null)]);
    const quotes = {};
    await Promise.all(symbols.map(async (sym) => {
      try { quotes[sym] = await fetchYahooQuote(sym); } catch (e) { quotes[sym] = { symbol: sym, error: e.message }; }
    }));
    return res.json({ usdIls: fx.rate, usdIlsAt: fx.at, usdIlsSource: fx.source, boi: boi ? { rate: boi.rate, at: boi.at } : null, quotes, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Market data unavailable' });
  }
});

// ═══ stage 2: cron auth shared by nightly alerts + weekly check-in ═══
async function checkCronSecret(req) {
  if (!supabaseAdmin) return false;
  const given = String(req.headers['x-cron-secret'] || '');
  const { data: sec } = await supabaseAdmin.from('app_secrets').select('value').eq('key', 'cron_secret').maybeSingle();
  const expected = sec && sec.value ? String(sec.value) : '';
  const a = Buffer.from(given), b = Buffer.from(expected);
  return !!expected && a.length === b.length && require('crypto').timingSafeEqual(a, b);
}
async function householdMembers(hid) {
  const { data } = await supabaseAdmin.from('memberships').select('user_id').eq('household_id', hid);
  return (data || []).map((m) => m.user_id);
}
async function pushHousehold(hid, payload) {
  for (const uid of await householdMembers(hid)) {
    try { await sendPushToUser(uid, payload); } catch (_e) { /* no subscription */ }
  }
}
const normDesc = (d) => String(d || '').replace(/\(?\s*תשלום\s*\d+\s*מתוך\s*\d+\s*\)?/g, ' ').replace(/[\d"'׳״().,:\-_/\\*#]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const ilMonth = (iso) => String(iso).slice(0, 7);

// ═══ stage 2: nightly proactive alerts + investment snapshot ═══
async function buildAlertsForHousehold(hid) {
  const today = israelToday();
  const month = ilMonth(today);
  const since = addDaysIso(today, -120);
  const [{ data: tx }, { data: cats }, { data: budgets }, { data: invs }] = await Promise.all([
    supabaseAdmin.from('transactions').select('id,type,amount,description,tx_date,category_id,card_id,created_at').eq('household_id', hid).in('type', COUNTED).gte('tx_date', since),
    supabaseAdmin.from('categories').select('id,name,parent_id').eq('household_id', hid),
    supabaseAdmin.from('category_budgets').select('category_id,monthly_amount').eq('household_id', hid),
    supabaseAdmin.from('investments').select('id,name,symbol,units,currency,current_value').eq('household_id', hid)
  ]);
  const catName = (id) => ((cats || []).find((c) => c.id === id) || {}).name || '';
  const out = [];
  const exp = (tx || []).filter((t) => t.type === 'expense');

  // a) budget pace / over budget
  const dayOfMonth = Number(today.slice(8, 10));
  const daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
  for (const b of budgets || []) {
    const spent = exp.filter((t) => t.category_id === b.category_id && ilMonth(t.tx_date) === month).reduce((s, t) => s + Number(t.amount), 0);
    const budget = Number(b.monthly_amount);
    if (!budget) continue;
    const name = catName(b.category_id);
    if (spent > budget) {
      out.push({ kind: 'budget_over', severity: 'warn', dedupe_key: `over:${b.category_id}:${month}`,
        title: `עברתם את התקציב של ${name}`, body: `הוצאתם ₪${Math.round(spent).toLocaleString('he-IL')} מתוך ₪${Math.round(budget).toLocaleString('he-IL')} החודש.`,
        data: { category_id: b.category_id, spent, budget } });
    } else if (dayOfMonth >= 5) {
      const projected = spent / dayOfMonth * daysInMonth;
      if (projected > budget * 1.1) {
        out.push({ kind: 'budget_pace', severity: 'info', dedupe_key: `pace:${b.category_id}:${month}`,
          title: `נשארו ₪${Math.round(budget - spent).toLocaleString('he-IL')} בתקציב ${name}`,
          body: `בקצב הנוכחי תחרגו בכ-₪${Math.round(projected - budget).toLocaleString('he-IL')} עד סוף החודש.`,
          data: { category_id: b.category_id, spent, budget, projected } });
      }
    }
  }

  // b) recurring charge went up (same merchant, different months, +5% and at least ₪10)
  const byDesc = {};
  exp.forEach((t) => { const k = normDesc(t.description); if (k.length < 3) return; (byDesc[k] = byDesc[k] || []).push(t); });
  Object.values(byDesc).forEach((list) => {
    const months = {};
    list.forEach((t) => { const m = ilMonth(t.tx_date); if (!months[m] || t.tx_date > months[m].tx_date) months[m] = t; });
    const ms = Object.keys(months).sort();
    if (ms.length < 3) return;                     // must look like a subscription
    const last = months[ms[ms.length - 1]], prev = months[ms[ms.length - 2]];
    if (ms[ms.length - 1] !== month && ms[ms.length - 1] !== ilMonth(addDaysIso(today, -28))) return;
    const a = Number(prev.amount), b = Number(last.amount);
    if (b > a * 1.05 && b - a >= 10) {
      out.push({ kind: 'price_increase', severity: 'info', dedupe_key: `rise:${last.id}`,
        title: `${String(last.description).slice(0, 40)} התייקר`,
        body: `מ-₪${a.toLocaleString('he-IL')} ל-₪${b.toLocaleString('he-IL')} (+${Math.round((b - a) / a * 100)}%).`,
        data: { tx_id: last.id, prev_id: prev.id, from: a, to: b } });
    }
  });

  // c) possible duplicates added in the last 3 days
  const recent = exp.filter((t) => t.created_at && t.created_at >= addDaysIso(today, -3));
  recent.forEach((t) => {
    const twin = exp.find((o) => o.id !== t.id && Math.abs(Number(o.amount) - Number(t.amount)) < 0.01
      && Math.abs(new Date(o.tx_date) - new Date(t.tx_date)) <= 864e5
      && normDesc(o.description).split(' ')[0] === normDesc(t.description).split(' ')[0]);
    if (twin) {
      const ids = [t.id, twin.id].sort();
      out.push({ kind: 'duplicate', severity: 'warn', dedupe_key: `dup:${ids[0]}:${ids[1]}`,
        title: `אולי חיוב כפול: ${String(t.description).slice(0, 36)}`,
        body: `שתי תנועות של ₪${Number(t.amount).toLocaleString('he-IL')} בהפרש של עד יום.`,
        data: { tx_ids: ids } });
    }
  });

  // d) market move on a held symbol + portfolio snapshot
  let total = 0; const detail = [];
  let fx = null; try { fx = await fetchUsdIls(); } catch (_e) { fx = null; }
  for (const inv of invs || []) {
    let val = Number(inv.current_value) || 0;
    if (inv.symbol && Number(inv.units) > 0) {
      try {
        const q = await fetchYahooQuote(inv.symbol);
        const rate = q.currency === 'ILS' ? 1 : q.currency === 'ILA' ? 0.01 : (fx || 0);
        if (rate) val = Number(inv.units) * q.price * rate;
        if (q.weekChangePct != null && q.weekChangePct <= -5) {
          const wk = addDaysIso(today, -((new Date(today).getUTCDay() + 7) % 7));
          out.push({ kind: 'market_move', severity: 'info', dedupe_key: `mkt:${inv.symbol}:${wk}`,
            title: `${inv.symbol} ירד ${Math.abs(q.weekChangePct).toFixed(1)}% השבוע`,
            body: 'ירידות קורות. כדאי להיזכר למה השקעתם ולאיזה טווח, לפני שמחליטים משהו.',
            data: { symbol: inv.symbol, weekChangePct: q.weekChangePct } });
        }
      } catch (_e) { /* keep last value */ }
    }
    total += val; detail.push({ id: inv.id, name: inv.name, value: Math.round(val) });
  }
  if ((invs || []).length) {
    await supabaseAdmin.from('investment_snapshots').upsert({ household_id: hid, snap_date: today, total_ils: Math.round(total), detail }, { onConflict: 'household_id,snap_date' });
  }
  return out;
}
app.post('/api/alerts/run', async (req, res) => {
  try {
    if (!(await checkCronSecret(req))) return res.status(401).json({ error: 'unauthorized' });
    // Housekeeping once a day: the recycle bin keeps 30 days, usage events
    // and failure reports 180 days.
    const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
    await supabaseAdmin.from('recycle_bin').delete().lt('removed_at', ago(30)).then(() => {}, () => {});
    await supabaseAdmin.from('app_events').delete().lt('at', ago(180)).then(() => {}, () => {});
    await supabaseAdmin.from('app_errors').delete().lt('at', ago(180)).then(() => {}, () => {});
    await supabaseAdmin.from('ai_calls').delete().lt('at', ago(180)).then(() => {}, () => {});
    const { data: hhs } = await supabaseAdmin.from('memberships').select('household_id');
    const ids = [...new Set((hhs || []).map((m) => m.household_id))];
    let created = 0;
    for (const hid of ids) {
      let alerts = [];
      try { alerts = await buildAlertsForHousehold(hid); } catch (e) { console.warn('alerts', hid, e.message); continue; }
      if (!alerts.length) continue;
      const { data: ins } = await supabaseAdmin.from('advisor_alerts')
        .upsert(alerts.map((a) => ({ ...a, household_id: hid })), { onConflict: 'household_id,dedupe_key', ignoreDuplicates: true }).select('id,title');
      const fresh = ins || [];
      created += fresh.length;
      if (fresh.length) {
        await pushHousehold(hid, { title: fresh.length === 1 ? '💡 היועץ שם לב למשהו' : `💡 היועץ שם לב ל-${fresh.length} דברים`,
          body: fresh[0].title + (fresh.length > 1 ? ` ועוד ${fresh.length - 1}` : ''), url: '/app/#/home' });
      }
    }
    return res.json({ ok: true, households: ids.length, created });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══ stage 2: weekly couple check-in (Sunday evening) ═══
app.post('/api/checkin/run', async (req, res) => {
  try {
    if (!(await checkCronSecret(req))) return res.status(401).json({ error: 'unauthorized' });
    const today = israelToday();
    const weekStart = addDaysIso(today, -new Date(today + 'T12:00:00Z').getUTCDay()); // Sunday
    const { data: hhs } = await supabaseAdmin.from('memberships').select('household_id');
    const ids = [...new Set((hhs || []).map((m) => m.household_id))];
    let made = 0;
    for (const hid of ids) {
      const since = addDaysIso(weekStart, -56);
      const [{ data: tx }, { data: cats }, { data: tasks }, { data: goals }] = await Promise.all([
        supabaseAdmin.from('transactions').select('type,amount,tx_date,category_id').eq('household_id', hid).in('type', COUNTED).gte('tx_date', since),
        supabaseAdmin.from('categories').select('id,name').eq('household_id', hid),
        supabaseAdmin.from('advisor_tasks').select('title,status,done_at,due_date').eq('household_id', hid),
        supabaseAdmin.from('goals').select('name,target_amount,saved_amount').eq('household_id', hid)
      ]);
      const lastWeekStart = addDaysIso(weekStart, -7);
      const exp = (tx || []).filter((t) => t.type === 'expense');
      const thisWeek = exp.filter((t) => t.tx_date >= lastWeekStart && t.tx_date < weekStart);
      const spentWeek = thisWeek.reduce((s, t) => s + Number(t.amount), 0);
      const avgWeek = exp.filter((t) => t.tx_date < lastWeekStart).reduce((s, t) => s + Number(t.amount), 0) / 7;
      const byCat = {};
      thisWeek.forEach((t) => { byCat[t.category_id] = (byCat[t.category_id] || 0) + Number(t.amount); });
      const topId = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a])[0];
      const summary = {
        week: lastWeekStart, spentWeek: Math.round(spentWeek), avgWeek: Math.round(avgWeek),
        topCategory: topId ? { name: ((cats || []).find((c) => c.id === topId) || {}).name || '', amount: Math.round(byCat[topId]) } : null,
        tasksDone: (tasks || []).filter((t) => t.status === 'done' && t.done_at && t.done_at.slice(0, 10) >= lastWeekStart).map((t) => t.title).slice(0, 5),
        tasksOpen: (tasks || []).filter((t) => t.status === 'open').length,
        goals: (goals || []).map((g) => ({ name: g.name, pct: Number(g.target_amount) ? Math.round(Number(g.saved_amount || 0) / Number(g.target_amount) * 100) : 0 })).slice(0, 5)
      };
      let decisions = [];
      try {
        const ai = await generateWithFallback({
          prompt: 'אתה יועץ כלכלי למשק בית בישראל. מתוך סיכום השבוע (JSON) הצע עד 3 החלטות קטנות וקונקרטיות שבני הזוג יכולים לענות עליהן כן/לא בשבוע הקרוב (למשל "להגביל משלוחים לפעם אחת השבוע"). בעברית, עד 70 תווים כל אחת. ענה רק ב-JSON: {"decisions":["..."]}',
          text: JSON.stringify(summary),
          effort: 'low'
        });
        const j = JSON.parse(extractJsonText(ai.output || '{}'));
        decisions = (Array.isArray(j.decisions) ? j.decisions : []).map((d) => ({ text: String(d).slice(0, 90), votes: {} })).slice(0, 3);
      } catch (_e) { decisions = []; }
      const { data: row } = await supabaseAdmin.from('weekly_checkins')
        .upsert({ household_id: hid, week_start: weekStart, summary, decisions }, { onConflict: 'household_id,week_start', ignoreDuplicates: true }).select('id');
      if (row && row.length) {
        made += 1;
        await pushHousehold(hid, { title: '📅 רבע השעה הזוגית שלכם מוכנה', body: `השבוע יצאו ₪${summary.spentWeek.toLocaleString('he-IL')}. ${decisions.length ? decisions.length + ' החלטות קטנות מחכות לכם.' : ''}`.trim(), url: '/app/#/plans/checkin' });
      }
    }
    return res.json({ ok: true, households: ids.length, created: made });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══ stage 2: "what if" — turn a sentence into dated cash-flow events ═══

// ═══ stage 4: advisor memory — pull durable decisions/preferences out of a chat ═══

// ═══ what the advisor learned from a conversation: approvable updates ═══
app.post('/api/ai/learn-from-chat', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    const { messages, context } = req.body || {};
    const convo = learn.convoText(messages);
    if (!convo) return res.json({ items: [] });
    const ai = await generateWithFallback({ prompt: learn.learnPrompt(context, israelToday()), text: convo, effort: 'low' });
    return res.json({ items: learn.pickItems(learn.parseLoose(ai.output)) });
  } catch (err) {
    console.error('learn-from-chat failed:', err.message);
    return res.status(err.statusCode || 502).json({ error: 'לא הצלחנו לקרוא את השיחה כרגע. נסו שוב בעוד דקה.' });
  }
});

// The trip advisor: what a destination will cost next to the family's last
// trip (flights, lodging, cost of living, cheaper months). An estimate from
// the model's knowledge, not live prices; the app says so.
// The same question (destination, month, days, travelers, past trip) is
// answered once a day from memory: no tokens for asking twice.
const tripEstimates = new Map(); // key -> { at, body }
app.post('/api/ai/trip-estimate', requireAuth, aiLimiter, async (req, res, next) => {
  const ask = tripsAi.cleanRequest(req.body);
  if (!ask) return res.status(400).json({ error: 'חסר יעד' });
  const key = israelToday() + ':' + JSON.stringify(ask);
  const hit = tripEstimates.get(key);
  if (hit) return res.json(hit);
  req.tripAsk = ask; req.tripKey = key;
  return next();
}, aiQuota, async (req, res) => {
  const ask = req.tripAsk;
  try {
    const ai = await generateWithFallback({ prompt: tripsAi.estimatePrompt(ask, israelToday()), text: 'החזר את ה-JSON.', effort: 'low' });
    let parsed = null;
    try { parsed = JSON.parse(extractJsonText(ai.output)); } catch (_e) { parsed = null; }
    const estimate = tripsAi.pickEstimate(parsed, israelToday());
    if (!estimate) return res.status(502).json({ error: 'לא הצלחנו להעריך את היעד. נסו שוב או נסחו אחרת.' });
    const body = { estimate, aiProvider: ai.provider };
    if (tripEstimates.size > 500) tripEstimates.clear();
    tripEstimates.set(req.tripKey, body);
    return res.json(body);
  } catch (err) {
    console.error('trip-estimate failed:', err.message);
    return res.status(err.statusCode || 502).json({ error: 'היועץ לא זמין כרגע. נסו שוב בעוד דקה.' });
  }
});

// The trip chat: the family tells what is different for them (no lodging,
// meals paid for, a known fare) and the plan follows. Words plus a bounded
// list of changes; the app applies them.
app.post('/api/ai/trip-chat', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  const ask = tripsAi.cleanChat(req.body);
  if (!ask) return res.status(400).json({ error: 'חסרה הודעה' });
  try {
    const ai = await generateWithFallback({ prompt: tripsAi.chatPrompt(ask, israelToday()), text: 'החזר את ה-JSON.', effort: 'low' });
    let parsed = null;
    try { parsed = JSON.parse(extractJsonText(ai.output)); } catch (_e) { parsed = null; }
    const out = tripsAi.pickChat(parsed, israelToday());
    if (!out) return res.status(502).json({ error: 'לא הבנתי. נסו לנסח אחרת.' });
    return res.json({ ...out, aiProvider: ai.provider });
  } catch (err) {
    console.error('trip-chat failed:', err.message);
    return res.status(err.statusCode || 502).json({ error: 'היועץ לא זמין כרגע. נסו שוב בעוד דקה.' });
  }
});

// Morning news: one digest a day for everyone, made the first time someone
// asks that day and kept in news_digests, so the AI runs once a day (a few
// cents), not once per user. The feeds are free; with too few headlines no
// AI call is made at all.
const newsMemory = new Map(); // day -> digest (when the table is not there)
let newsMaking = null;
async function todaysNews() {
  const day = israelToday();
  if (newsMemory.has(day)) return newsMemory.get(day);
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin.from('news_digests').select('digest').eq('day', day).maybeSingle();
    if (data && data.digest) { newsMemory.set(day, data.digest); return data.digest; }
  }
  if (newsMaking) return newsMaking;
  newsMaking = (async () => {
    const items = news.recentItems(await news.fetchFeeds());
    if (items.length < 5) { const e = new Error('too few headlines'); e.statusCode = 503; throw e; }
    const ai = await generateWithFallback({ prompt: news.newsPrompt(items, day), text: 'החזר את ה-JSON.', effort: 'low' });
    let parsed = null;
    try { parsed = JSON.parse(extractJsonText(ai.output)); } catch (_e) { parsed = null; }
    const digest = news.pickDigest(parsed, items, day);
    if (!digest) { const e = new Error('no digest'); e.statusCode = 502; throw e; }
    newsMemory.clear();
    newsMemory.set(day, digest);
    if (supabaseAdmin) await supabaseAdmin.from('news_digests').upsert({ day, digest }, { onConflict: 'day' }).then(() => {}, () => {});
    return digest;
  })().finally(() => { newsMaking = null; });
  return newsMaking;
}
app.get('/api/news/today', requireAuth, aiLimiter, async (req, res) => {
  try {
    return res.json({ digest: await todaysNews() });
  } catch (err) {
    console.error('news failed:', err.message);
    return res.status(err.statusCode === 503 ? 503 : 502).json({ error: 'החדשות של הבוקר לא זמינות כרגע. נסו שוב מאוחר יותר.' });
  }
});

// ═══ operations: failures, usage, and the owner's numbers ═══
// The app reports its failures (also before signing in) and a few usage
// events (signed in). Nothing the person wrote and no amounts are kept.
const telemetryLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.ip });
async function optionalUser(req) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token || !supabaseAdmin) return null;
  const known = sessions.get(token);
  if (known) return known;
  try { const { data } = await supabaseAdmin.auth.getUser(token); if (data?.user?.id) { sessions.set(token, data.user.id, ops.tokenExp(token)); return data.user.id; } } catch (_e) { /* anonymous */ }
  return null;
}
app.post('/api/telemetry', telemetryLimiter, async (req, res) => {
  if (!supabaseAdmin) return res.status(204).end();
  try {
    const userId = await optionalUser(req);
    const errors = ops.cleanErrors(req.body && req.body.errors, { userId, agent: req.headers['user-agent'] });
    let householdId = null;
    if (userId && Array.isArray(req.body && req.body.events) && req.body.events.length) {
      const { data: m } = await supabaseAdmin.from('memberships').select('household_id').eq('user_id', userId).limit(1);
      householdId = m && m[0] ? m[0].household_id : null;
    }
    const events = ops.cleanEvents(req.body && req.body.events, { userId, householdId });
    if (errors.length) await supabaseAdmin.from('app_errors').insert(errors);
    if (events.length) await supabaseAdmin.from('app_events').insert(events);
  } catch (err) { console.error('telemetry failed:', err.message); }
  return res.status(204).end();
});
// "Still here": once a minute from each open app, for the owner's live count.
const presence = ops.presenceStore();
const presenceLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.ip });
app.post('/api/presence', presenceLimiter, async (req, res) => {
  const b = req.body || {};
  const key = String(b.v || '').slice(0, 40);
  if (/^[\w-]{8,40}$/.test(key)) {
    const userId = await optionalUser(req).catch(() => null);
    presence.beat({ key, userId, screen: String(b.screen || ''), device: b.device, installed: b.installed });
  }
  return res.status(204).end();
});

// Failures on the server are kept too.
async function reportServerError(err, path) {
  try {
    if (supabaseAdmin) await supabaseAdmin.from('app_errors').insert({ source: 'server', message: String((err && err.message) || err).slice(0, 500), detail: String((err && err.stack) || '').slice(0, 4000) || null, path: String(path || '').slice(0, 300) || null });
  } catch (_e) { /* nothing more to do */ }
}
process.on('unhandledRejection', (err) => { console.error('unhandledRejection:', err && err.message); reportServerError(err, 'unhandledRejection'); });

// The owner's numbers (ADMIN_EMAILS): active people, who came back, what is
// used, and the week's failures.
// The app's own public mailbox by address; other owners only by a SHA-256
// fingerprint of their email, so no personal address is in the public code.
// ADMIN_EMAILS in the server's settings can name more.
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || 'budgetapp2852@gmail.com').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const OWNER_HASHES = ['8ff0b3475c30a05f1ea79f5ef44dfb52fc75db4e5f1b3bb09c06111f902bbd33', '1b7e1165d7b1de7d108a92534c4fabc7795d132f0db4c97c8241efd892b39cda'];
const isOwnerEmail = (email) => ops.isOwnerEmail(email, ADMIN_EMAILS, OWNER_HASHES);
// Requests from users are emailed to the app's own mailbox only, not to the
// owner's personal one (FEEDBACK_TO can name another).
const FEEDBACK_TO = String(process.env.FEEDBACK_TO || ADMIN_EMAILS.find((e) => e.startsWith('budgetapp')) || ADMIN_EMAILS[0] || '').toLowerCase().trim();
// The owner's own accounts, by id (asked of the auth server, kept 10 minutes):
// left out of every count on the dashboard.
let ownerIdsCache = { at: 0, ids: [] };
// Whole lists, never cut at 1,000 (see ops.pageAll). Same { data, error }
// shape as a single query, so callers stay as they were.
const allRows = (build) => ops.pageAll(async (from, to) => {
  const { data, error } = await build().range(from, to);
  if (error) throw error;
  return data || [];
}).then((data) => ({ data, error: null }), (error) => ({ data: null, error }));
const listAllUsers = () => ops.pageAll(async (_from, _to, page) => {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  return (data && data.users) || [];
}).then((users) => ({ data: { users }, error: null }), (error) => ({ data: null, error }));
async function ownerIds(allUsers) {
  if (allUsers) {
    ownerIdsCache = { at: Date.now(), ids: allUsers.filter((u) => isOwnerEmail(u.email)).map((u) => u.id) };
  } else if (Date.now() - ownerIdsCache.at > 10 * 60 * 1000 && supabaseAdmin) {
    const { data } = await listAllUsers();
    return ownerIds((data && data.users) || []);
  }
  return ownerIdsCache.ids;
}
// Salt for the per-person labels, so they cannot be matched to ids elsewhere.
const ADMIN_SALT = process.env.ADMIN_SALT || VAPID_PRIVATE_KEY || 'budget';
// Who each person is for the owner: the name they gave in the app (or at
// sign-up), their household and how much data it has. Emails stay here.
async function peopleInfo(all) {
  const [{ data: members }, { data: spans }] = await Promise.all([
    allRows(() => supabaseAdmin.from('memberships').select('user_id,household_id,display_name,created_at').order('created_at', { ascending: true })),
    supabaseAdmin.rpc('ops_tx_span')
  ]);
  const first = new Map();
  for (const m of members || []) if (!first.has(m.user_id)) first.set(m.user_id, m);
  const span = new Map((spans || []).map((x) => [x.household_id, { n: Number(x.n) || 0, months: Number(x.months) || 0 }]));
  const info = new Map();
  for (const u of all) {
    const m = first.get(u.id);
    const meta = u.user_metadata || {};
    const name = String((m && m.display_name) || meta.display_name || meta.full_name || meta.name || '').trim().slice(0, 40);
    const sp = (m && span.get(m.household_id)) || { n: 0, months: 0 };
    info.set(u.id, { name, inHousehold: !!m, txCount: sp.n, months: sp.months, label: ops.alias(u.id, ADMIN_SALT) });
  }
  return info;
}
app.get('/api/admin/stats', requireAuth, async (req, res) => {
  try {
    // Asked of the auth server each time (not the session memory): the
    // official account only, with its email confirmed.
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const month = new Date(Date.now() - 30 * 86400000).toISOString();
    const [ev, er, calls, people] = await Promise.all([
      allRows(() => supabaseAdmin.from('app_events').select('user_id,name,at').gte('at', since).order('at', { ascending: false })),
      supabaseAdmin.from('app_errors').select('message,path,at,source').gte('at', new Date(Date.now() - 7 * 86400000).toISOString()).order('at', { ascending: false }).limit(2000),
      allRows(() => supabaseAdmin.from('ai_calls').select('user_id,provider,model,input_tokens,output_tokens,at').gte('at', month).order('at')),
      // Ids, sign-up dates and names reach the dashboard; an email only on request.
      listAllUsers()
    ]);
    const all = (people.data && people.data.users) || [];
    // The owner's own accounts (by id; the emails stay here) are left out of
    // every number: the dashboard is about the others. AI cost stays whole
    // (it is what is paid), with the owner's part given apart.
    const owners = await ownerIds(all);
    const others = (id) => !owners.includes(id);
    const signedUp = all.filter((u) => others(u.id)).map((u) => ({ id: u.id, created_at: u.created_at }));
    const events = (ev.data || []).filter((e) => others(e.user_id));
    const per = ops.perUser({ users: signedUp, events, calls: calls.data || [], salt: ADMIN_SALT, owners });
    // Each person's name and how they are doing (by their label; no ids or emails leave).
    const info = await peopleInfo(all.filter((u) => others(u.id)));
    // Shares and friends who joined, per person (by label) and in total.
    const { data: refs } = await allRows(() => supabaseAdmin.from('referrals').select('ref_code').order('user_id'));
    const sh = ops.shareStats({ users: all, events: ev.data || [], referrals: refs || [], salt: ADMIN_SALT, owners });
    const shareByLabel = new Map(all.filter((u) => others(u.id)).map((u) => [ops.alias(u.id, ADMIN_SALT), sh.byUser.get(u.id)]));
    const byLabel = new Map([...info.values()].map((x) => [x.label, x]));
    const costs = per.users.map((u) => u.cost).filter((c) => c > 0).sort((a, b) => a - b);
    const medianCost = costs.length ? costs[Math.floor(costs.length / 2)] : 0;
    per.users = per.users.map((u) => {
      const x = byLabel.get(u.who) || {};
      const z = shareByLabel.get(u.who) || { shares: 0, friends: 0 };
      return { ...u, name: x.name || '', shares: z.shares, friends: z.friends, health: ops.healthOf({ ...x, joined: u.joined, lastSeen: u.lastSeen, imports: u.imports, importFails: u.importFails, asked: u.asked, cost: u.cost, medianCost }) };
    });
    let members = supabaseAdmin.from('memberships').select('user_id', { count: 'exact', head: true });
    if (owners.length) members = members.not('user_id', 'in', '(' + owners.join(',') + ')');
    // Before the ops_funnel_exclude migration the function takes only the date.
    const funnelOf = async () => {
      const r = await supabaseAdmin.rpc('ops_funnel', { p_since: month, p_exclude: owners });
      return r.error ? supabaseAdmin.rpc('ops_funnel', { p_since: month }) : r;
    };
    const [{ count: memberCount }, { data: funnel }] = await Promise.all([members, funnelOf()]);
    return res.json({
      ...ops.stats({ events, errors: er.data || [] }), members: memberCount || 0, signedUp: signedUp.length, ...per,
      live: presence.snapshot(Date.now(), owners), funnel: funnel || null, sharing: sh.totals, daily: ops.daily({ events, calls: calls.data || [], days: 30 }),
      cohorts: ops.cohorts({ users: signedUp, info, events }), upload: ops.uploadFunnel(events),
      feed: insights.feed({ events, users: signedUp, nameOf: (id) => String((info.get(id) || {}).name || '').split(' ')[0] })
    });
  } catch (err) {
    console.error('admin stats failed:', err.message);
    return res.status(500).json({ error: 'failed' });
  }
});

// A question about the numbers, answered by the AI. Only totals are sent
// (insights.askFacts keeps counts and drops names, labels and emails).
app.post('/api/admin/ask', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    const prompt = insights.askPrompt(req.body && req.body.q, insights.askFacts(req.body && req.body.stats));
    if (!prompt) return res.status(400).json({ error: 'כתבו שאלה.' });
    const ai = await generateWithFallback({ prompt, text: '', maxTokens: 700, effort: 'low' });
    const answer = String(ai.output || '').trim().slice(0, 2000);
    if (!answer) return res.status(502).json({ error: 'לא התקבלה תשובה. נסו שוב.' });
    return res.json({ answer });
  } catch (err) {
    console.error('admin ask failed:', err.message);
    return res.status(502).json({ error: 'לא התקבלה תשובה. נסו שוב.' });
  }
});

// The owner's accounts only (ADMIN_EMAILS), with the email confirmed; asked
// of the auth server every time, not taken from the session memory.
async function isAdmin(userId) {
  if (!supabaseAdmin || !userId) return false;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const u = data && data.user;
  return !!(u && u.email_confirmed_at && isOwnerEmail(u.email));
}

// Who opened the app today (Israel time), what they did, AI use and errors,
// with each one's name and how they are doing. The owner's accounts are left out.
async function todayItems() {
  const since = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    const [ev, calls, er, people] = await Promise.all([
      allRows(() => supabaseAdmin.from('app_events').select('user_id,name,at').gte('at', since).order('at')),
      allRows(() => supabaseAdmin.from('ai_calls').select('user_id,provider,model,input_tokens,output_tokens,at').gte('at', since).order('at')),
      allRows(() => supabaseAdmin.from('app_errors').select('user_id,at').gte('at', since).order('at')),
      listAllUsers()
    ]);
    const all = (people.data && people.data.users) || [];
    const owners = await ownerIds(all);
    const others = all.filter((u) => !owners.includes(u.id));
    const rows = ops.todayRows({ users: others, events: (ev.data || []).filter((e) => !owners.includes(e.user_id)), calls: calls.data || [], errors: er.data || [] });
    const info = await peopleInfo(others);
    const seen = new Map(others.map((u) => [u.id, u]));
    const items = rows.filter((r) => seen.has(r.id)).map((r) => {
      const x = info.get(r.id) || {};
      return { ...r, id: undefined, who: x.label, name: x.name || '', health: ops.healthOf({ ...x, joined: seen.get(r.id).created_at, lastSeen: new Date().toISOString(), imports: r.imports, importFails: r.importFails, asked: r.asked }) };
    });
    return { day: ops.israelDay(), items };
}
app.get('/api/admin/today', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    return res.json(await todayItems());
  } catch (err) {
    console.error('admin today failed:', err.message);
    return res.status(500).json({ error: 'failed' });
  }
});
// Which supermarket price sites answer this server (some block visitors
// from abroad). Owner only; a few public pages, nothing is stored.
const prices = require('./server/prices');
app.get('/api/admin/prices/reach', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    return res.json({ at: new Date().toISOString(), sites: await prices.probeAll(fetch) });
  } catch (err) {
    console.error('price reach failed:', err.message);
    return res.status(500).json({ error: 'failed' });
  }
});
// The outside price service (Apify): what it asks for and costs, then one
// small run. Owner only; the key never leaves the server; nothing is stored.
const APIFY_TOKEN = process.env.APIFY_TOKEN || '';
app.get('/api/admin/prices/service', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    if (!APIFY_TOKEN) return res.status(503).json({ error: 'המפתח של Apify לא מוגדר בשרת (APIFY_TOKEN).' });
    return res.json(await prices.apifyAbout(fetch, APIFY_TOKEN));
  } catch (err) {
    console.error('price service info failed:', err.message);
    return res.status(502).json({ error: String(err.message).slice(0, 200) });
  }
});
app.post('/api/admin/prices/sample', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    if (!APIFY_TOKEN) return res.status(503).json({ error: 'המפתח של Apify לא מוגדר בשרת (APIFY_TOKEN).' });
    const input = req.body && req.body.input && typeof req.body.input === 'object' && !Array.isArray(req.body.input) ? req.body.input : null;
    if (input && JSON.stringify(input).length > 2000) return res.status(400).json({ error: 'bad request' });
    const used = input || prices.SAMPLE_INPUT;
    return res.json({ input: used, ...(await prices.apifyStart(fetch, APIFY_TOKEN, used)) });
  } catch (err) {
    console.error('price service sample failed:', err.message);
    return res.status(502).json({ error: String(err.message).slice(0, 200) });
  }
});
app.get('/api/admin/prices/sample/:runId', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    if (!APIFY_TOKEN) return res.status(503).json({ error: 'המפתח של Apify לא מוגדר בשרת (APIFY_TOKEN).' });
    return res.json(await prices.apifyCheck(fetch, APIFY_TOKEN, req.params.runId));
  } catch (err) {
    console.error('price service check failed:', err.message);
    return res.status(502).json({ error: String(err.message).slice(0, 200) });
  }
});

// ═══ prices for families: our catalog first, the service only for what is missing ═══
// A search is matched in our own catalog (price_search in the database, from
// the app). Only items with nothing there are asked of the service, at most
// 15 at a time, each at most once a week, a few runs per household a day and
// a cap for the whole app, because every run costs money.
const priceRuns = new Map(); // runId -> { hid, at, queries }
const priceAsked = new Map(); // query -> time asked
const priceDay = { day: '', all: 0, byHid: new Map() };
// Limits, changeable in the server settings (Render) without a code change.
const PRICE_RUNS_PER_HOUSEHOLD = Number(process.env.PRICE_RUNS_PER_HOUSEHOLD) || 6;
const PRICES_OPEN = process.env.PRICES_OPEN === '1';
const PRICE_RUNS_PER_DAY = Number(process.env.PRICE_RUNS_PER_DAY) || 40;
function takePriceRun(hid) {
  const d = israelToday();
  if (priceDay.day !== d) { priceDay.day = d; priceDay.all = 0; priceDay.byHid = new Map(); }
  const mine = priceDay.byHid.get(hid) || 0;
  if (mine >= PRICE_RUNS_PER_HOUSEHOLD || priceDay.all >= PRICE_RUNS_PER_DAY) return false;
  priceDay.byHid.set(hid, mine + 1);
  priceDay.all++;
  return true;
}
// What families looked for and the catalog lacked, counted.
async function wantPrices(queries) {
  if (!queries.length) return;
  const { data } = await supabaseAdmin.from('price_wanted').select('query,asked').in('query', queries);
  const had = new Map((data || []).map((r) => [r.query, r.asked]));
  const at = new Date().toISOString();
  await supabaseAdmin.from('price_wanted').upsert(queries.map((query) => ({ query, asked: (had.get(query) || 0) + 1, last_at: at })), { onConflict: 'query' });
}
async function saveCatalog(items) {
  const { products, offers } = prices.catalogRows(items);
  for (let i = 0; i < products.length; i += 500) {
    const { error } = await supabaseAdmin.from('price_products').upsert(products.slice(i, i + 500), { onConflict: 'barcode' });
    if (error) throw error;
  }
  for (let i = 0; i < offers.length; i += 500) {
    const { error } = await supabaseAdmin.from('price_offers').upsert(offers.slice(i, i + 500), { onConflict: 'barcode,chain' });
    if (error) throw error;
  }
  return { products: products.length, offers: offers.length };
}
app.post('/api/prices/fetch', requireAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    if (!APIFY_TOKEN) return res.status(503).json({ error: 'השוואת המחירים עוד לא פעילה.' });
    const hid = String((req.body && req.body.hid) || '');
    if (!(await isHouseholdMember(req.authUserId, hid))) return res.status(403).json({ error: 'not allowed' });
    // While the catalog grows ("בקרוב" for everyone else), only the owner searches.
    if (!PRICES_OPEN && !(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'השוואת המחירים עוד לא פתוחה. בקרוב!' });
    // Families never wait for the price service: what our catalog does not
    // have yet is written down, and the owner's next load brings it in.
    if (!(await isAdmin(req.authUserId))) {
      const want = prices.fetchInput(req.body.queries, { max: 30 });
      if (want) await wantPrices(want.productQueries).catch((e) => console.error('price wanted failed:', e.message));
      return res.json({ runId: null, asked: 0, queued: want ? want.productQueries.length : 0 });
    }
    const week = Date.now() - 7 * 86400000;
    const fresh = (Array.isArray(req.body.queries) ? req.body.queries : []).filter((q) => !(priceAsked.get(String(q).trim()) > week));
    const input = prices.fetchInput(fresh);
    if (!input) return res.json({ runId: null, asked: 0 });
    if (!takePriceRun(hid)) return res.status(429).json({ error: 'הגעתם למספר החיפושים החדשים להיום. מחר נמשיך, ומה שכבר נמצא זמין.' });
    const run = await prices.apifyStart(fetch, APIFY_TOKEN, input);
    input.productQueries.forEach((q) => priceAsked.set(q, Date.now()));
    priceRuns.set(run.runId, { hid, at: Date.now(), queries: input.productQueries });
    return res.json({ runId: run.runId, asked: input.productQueries.length });
  } catch (err) {
    console.error('price fetch failed:', err.message);
    return res.status(502).json({ error: 'לא הצלחנו לחפש מחירים כרגע. נסו שוב בעוד כמה דקות.' });
  }
});
app.get('/api/prices/fetch/:runId', requireAuth, async (req, res) => {
  try {
    const job = priceRuns.get(String(req.params.runId));
    if (!job || !(await isHouseholdMember(req.authUserId, job.hid))) return res.status(404).json({ error: 'not found' });
    if (job.result) return res.json(job.result);
    const r = await prices.apifyItems(fetch, APIFY_TOKEN, req.params.runId);
    if (!r.done) return res.json({ done: false, status: r.status });
    const saved = r.status === 'SUCCEEDED' ? await saveCatalog(r.items) : { products: 0, offers: 0 };
    job.result = { done: true, status: r.status, ...saved };
    return res.json(job.result);
  } catch (err) {
    console.error('price fetch check failed:', err.message);
    return res.status(502).json({ error: 'לא הצלחנו לבדוק. נסו שוב.' });
  }
});

// The owner: load the catalog on the server, part by part (what most
// families buy, then what families looked for and did not find). It goes on
// when the owner closes the screen; the screen shows where it is.
const seedJob = { running: false, part: 0, parts: 0, added: 0, cost: 0, error: null, startedAt: null, endedAt: null };
// One run of the price service, waited on (up to about 16 minutes).
async function runAndWait(input) {
  if (!input) return { status: 'EMPTY', items: [] };
  const run = await prices.apifyStart(fetch, APIFY_TOKEN, input, { seconds: 900 });
  let r = { done: false };
  for (let t = 0; t < 100 && !r.done; t++) {
    await new Promise((ok) => setTimeout(ok, 10000));
    r = await prices.apifyItems(fetch, APIFY_TOKEN, run.runId).catch(() => ({ done: false }));
  }
  seedJob.cost += Number(r.cost) || 0;
  return r.done ? r : { status: 'TIMED-OUT', items: [] };
}
const pricefiles = require('./server/pricefiles');
// The free load: each chain's own full price file (the transparency law),
// one chain at a time (one file in memory at a time), saved by barcode.
async function runFreeLoad() {
  Object.assign(seedJob, { running: true, part: 0, parts: pricefiles.CHAINS.length, added: 0, cost: 0, error: null, startedAt: new Date().toISOString(), endedAt: null, free: true, chainsDone: [] });
  try {
    const keys = pricefiles.CHAINS.map((c) => c.key);
    // Each chain is saved as soon as it is read, and let go: holding every
    // chain's file until the end ran the server out of memory at night,
    // and then nothing was saved.
    for (const key of keys) {
      seedJob.part++;
      seedJob.current = (pricefiles.CHAINS.find((c) => c.key === key) || {}).name || key;
      let [r] = await pricefiles.allChains(fetch, { only: [key] });
      // A chain that failed (a site busy for a moment) is asked once more.
      if (r.error) { await new Promise((ok) => setTimeout(ok, 5000)); [r] = await pricefiles.allChains(fetch, { only: [key] }); }
      let error = r.error || null;
      if (r.rows.length) await saveCatalog(r.rows).catch((e) => { error = 'save: ' + String(e.message || e).slice(0, 60); });
      seedJob.added += error ? 0 : r.count;
      seedJob.chainsDone.push({ key: r.key, name: r.name, count: r.count, error });
      console.log('prices:', r.key, r.count, error || 'ok');
    }
    // Every chain's branches, then the branches families live near (their
    // chain's prices read back from the catalog).
    await saveStores().catch((e) => console.error('stores failed:', e.message));
    await refreshAreas().catch((e) => console.error('areas refresh failed:', e.message));
    await loadLocal(null).catch((e) => console.error('local prices failed:', e.message));
    // Prices of a chain that left (or a product it stopped selling) older
    // than two weeks are not shown as today's price.
    await supabaseAdmin.from('price_offers').delete().lt('seen_at', new Date(Date.now() - 14 * 86400000).toISOString());
  } catch (err) {
    seedJob.error = String(err.message || err).slice(0, 200);
    console.error('free price load failed:', seedJob.error);
  }
  seedJob.running = false;
  seedJob.current = null;
  seedJob.endedAt = new Date().toISOString();
  // Kept, so how each chain did can be read the next morning (no table: skipped).
  await supabaseAdmin.from('price_load_runs').insert({ started_at: seedJob.startedAt, ended_at: seedJob.endedAt, added: seedJob.added, error: seedJob.error, chains: seedJob.chainsDone }).then(() => {}, () => {});
}
// ── prices by the family's area ──
const area = require('./server/area');
// Every chain's list of branches, kept for finding the branch near a family.
async function saveStores() {
  for (const c of pricefiles.CHAINS) {
    try {
      const list = await pricefiles.chainStores(fetch, c);
      const at = new Date().toISOString();
      // One row per branch number: a chain that lists a number twice made
      // the whole save fail before (and its branches were never kept).
      const rows = area.uniqueStores(list).map((x) => ({ chain: c.key, chain_name: c.name, store_id: x.store_id, name: x.name, address: x.address, city: x.city, seen_at: at }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabaseAdmin.from('price_stores').upsert(rows.slice(i, i + 500), { onConflict: 'chain,store_id' });
        if (error) throw new Error(error.message);
      }
    } catch (e) { console.error('stores of ' + c.key + ':', e.message); }
  }
}
// Every family's nearest branches again, after the branch lists changed: a
// chain that opened a branch near them (or a chain added to the app) shows
// without them saving their area again.
async function refreshAreas() {
  const { data: areas } = await supabaseAdmin.from('household_area').select('household_id,city_code,hood,max_km').limit(5000);
  if (!areas || !areas.length) return 0;
  const { data: stores } = await allRows(() => supabaseAdmin.from('price_stores').select('chain,chain_name,store_id,name,address,city').order('chain').order('store_id'));
  let n = 0;
  for (const a of areas) {
    const near = area.nearestStores(stores || [], { code: a.city_code, hood: a.hood }, { maxKm: a.max_km || 25 });
    if (!near.length) continue;
    await supabaseAdmin.from('household_stores').delete().eq('household_id', a.household_id);
    await supabaseAdmin.from('household_stores').insert(near.map((x) => ({ household_id: a.household_id, chain: x.chain, store_id: x.store_id, chain_name: x.chain_name, name: x.name, address: x.address, city: x.city, km: x.km, kind: x.kind })));
    n++;
  }
  return n;
}
// The prices at the branches families live near: kept only where a branch
// differs from its chain's general price (so the catalog stays small).
// `rows`: the chains' general prices just loaded, or none (then read).
const localJob = { running: false, again: false };
async function loadLocal(rows = null, only = null) {
  // One at a time; a request while one runs is done right after it (all
  // families' branches, so none is missed).
  if (localJob.running) { localJob.again = true; return; }
  localJob.running = true;
  try {
    const { data: wanted } = await supabaseAdmin.from('household_stores').select('chain,store_id').limit(2000);
    const pairs = [...new Map((wanted || []).filter((w) => !only || only.some((o) => o.chain === w.chain && o.store_id === w.store_id)).map((w) => [w.chain + '|' + w.store_id, w])).values()];
    const general = new Map();
    for (const r of rows || []) {
      const m = general.get(r.chainKey) || new Map();
      if (!m.has(r.barcode) || r.price < m.get(r.barcode)) m.set(r.barcode, r.price);
      general.set(r.chainKey, m);
    }
    for (const w of pairs) {
      const chain = pricefiles.CHAINS.find((c) => c.key === w.chain);
      if (!chain) continue;
      try {
        if (!general.has(w.chain)) {
          const { data } = await allRows(() => supabaseAdmin.from('price_offers').select('barcode,price').eq('chain', w.chain).order('barcode'));
          general.set(w.chain, new Map((data || []).map((x) => [x.barcode, Number(x.price)])));
        }
        const base = general.get(w.chain);
        const at = new Date().toISOString();
        const diff = new Map();
        for (const x of await pricefiles.storePrices(fetch, chain, w.store_id)) {
          const g = base.get(x.barcode);
          if (g != null && Math.abs(g - x.price) >= 0.01 && (!diff.has(x.barcode) || x.price < diff.get(x.barcode))) diff.set(x.barcode, x.price);
        }
        await supabaseAdmin.from('price_store_offers').delete().eq('chain', w.chain).eq('store_id', w.store_id);
        const out = [...diff].map(([barcode, price]) => ({ barcode, chain: w.chain, store_id: w.store_id, price: Math.round(price * 100) / 100, seen_at: at }));
        for (let i = 0; i < out.length; i += 1000) await supabaseAdmin.from('price_store_offers').insert(out.slice(i, i + 1000));
      } catch (e) { console.error('branch ' + w.chain + '/' + w.store_id + ':', e.message); }
    }
  } finally {
    localJob.running = false;
    if (localJob.again) { localJob.again = false; loadLocal().catch((e) => console.error('local prices failed:', e.message)); }
  }
}
// Settlements as the family types ("בית ש" → בית שמש, בית שאן…).
app.get('/api/prices/places', requireAuth, (req, res) => res.json({ places: area.suggest(String(req.query.q || '').slice(0, 40)) }));
// Where the family lives: a settlement, and a neighborhood if it wants. The
// branch nearest to it at every chain is found here; their prices come in
// the background (the family sees the general price until then).
app.post('/api/prices/area', requireAuth, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    const hid = String((req.body && req.body.hid) || '');
    if (!(await isHouseholdMember(req.authUserId, hid))) return res.status(403).json({ error: 'not allowed' });
    if (!PRICES_OPEN && !(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'השוואת המחירים עוד לא פתוחה. בקרוב!' });
    const at = area.place(String((req.body && req.body.city_code) || ''));
    if (!at) return res.status(400).json({ error: 'לא מצאנו את היישוב. נסו לבחור מהרשימה.' });
    const hood = String((req.body && req.body.hood) || '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;
    // How far the family goes to shop: 5 to 50 km, in steps of 5.
    const maxKm = Math.min(50, Math.max(5, Math.round((Number(req.body && req.body.max_km) || 25) / 5) * 5));
    const { data: stores } = await allRows(() => supabaseAdmin.from('price_stores').select('chain,chain_name,store_id,name,address,city').order('chain').order('store_id'));
    const near = area.nearestStores(stores || [], { code: at.code, hood }, { maxKm });
    await supabaseAdmin.from('household_area').upsert({ household_id: hid, city_code: at.code, city: at.name, hood, max_km: maxKm, updated_at: new Date().toISOString() }, { onConflict: 'household_id' });
    await supabaseAdmin.from('household_stores').delete().eq('household_id', hid);
    if (near.length) await supabaseAdmin.from('household_stores').insert(near.map((n) => ({ household_id: hid, chain: n.chain, store_id: n.store_id, chain_name: n.chain_name, name: n.name, address: n.address, city: n.city, km: n.km, kind: n.kind })));
    loadLocal(null, near).catch((e) => console.error('local prices failed:', e.message));
    return res.json({ area: { city_code: at.code, city: at.name, hood, max_km: maxKm }, stores: near });
  } catch (err) {
    console.error('price area failed:', err.message);
    return res.status(500).json({ error: 'לא נשמר. נסו שוב.' });
  }
});
async function runSeed() {
  const wanted = await supabaseAdmin.from('price_wanted').select('query').order('asked', { ascending: false }).limit(60).then((r) => (r.data || []).map((x) => x.query), () => []);
  const list = [...new Set([...prices.SEED, ...wanted])];
  const parts = [];
  for (let i = 0; i < list.length; i += 20) parts.push(list.slice(i, i + 20));
  Object.assign(seedJob, { running: true, part: 0, parts: parts.length, added: 0, cost: 0, error: null, startedAt: new Date().toISOString(), endedAt: null });
  try {
    for (let i = 0; i < parts.length; i++) {
      seedJob.part = i + 1;
      // Step 1: the leading products for each name; step 2: those exact
      // barcodes at the main chains, so one product is compared everywhere.
      const foundItems = [];
      const codes = [];
      for (let j = 0; j < parts[i].length; j += 5) {
        const runs = await Promise.all(parts[i].slice(j, j + 5).map((q) => runAndWait(prices.findInput(q)).catch(() => ({ status: 'FAILED', items: [] }))));
        for (const f of runs) if (f.status === 'SUCCEEDED') { foundItems.push(...f.items); codes.push(...prices.leadBarcodes(f.items, 1)); }
      }
      const r = codes.length ? await runAndWait(prices.compareInput(codes)) : { status: 'EMPTY', items: [] };
      if (r.status === 'SUCCEEDED' || foundItems.length) {
        const saved = await saveCatalog([...foundItems, ...(r.items || [])]);
        seedJob.added += saved.products;
        const got = parts[i].filter((q) => wanted.includes(q));
        if (got.length) await supabaseAdmin.from('price_wanted').delete().in('query', got);
      }
    }
  } catch (err) {
    seedJob.error = String(err.message || err).slice(0, 200);
    console.error('price seed job failed:', seedJob.error);
  }
  seedJob.running = false;
  seedJob.endedAt = new Date().toISOString();
}
async function seedState() {
  const [{ count: products }, { count: offers }, { count: wanted }, multi] = await Promise.all([
    supabaseAdmin.from('price_products').select('barcode', { count: 'exact', head: true }),
    supabaseAdmin.from('price_offers').select('barcode', { count: 'exact', head: true }),
    supabaseAdmin.from('price_wanted').select('query', { count: 'exact', head: true }),
    supabaseAdmin.from('price_offers').select('chain').limit(5000)
  ]);
  const done = (seedJob.chainsDone || []).filter((c) => c.count > 0).length;
  const chains = done || new Set(((multi && multi.data) || []).map((r) => r.chain)).size;
  const names = prices.SEED.length + Math.min(60, wanted || 0);
  return { ...seedJob, products: products || 0, offers: offers || 0, chains, wanted: wanted || 0, estimate: prices.loadCost(names), mainChains: prices.MAIN_CHAINS.length };
}
app.post('/api/admin/prices/load', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    // Free by default: the chains' own files. The paid service only when
    // the owner asks for it by name (and its key is set).
    const paid = req.body && req.body.paid === true;
    if (paid && !APIFY_TOKEN) return res.status(503).json({ error: 'המפתח של Apify לא מוגדר בשרת (APIFY_TOKEN).' });
    if (!seedJob.running) (paid ? runSeed() : runFreeLoad());
    return res.json(await seedState());
  } catch (err) {
    console.error('price load failed:', err.message);
    return res.status(502).json({ error: String(err.message).slice(0, 200) });
  }
});
// Product photos from Open Food Facts (an open database, free to use), by
// barcode: asked once a month at most for each product, kept in the
// catalog, with the kashrut certifier its labels name, when they name one.
// Up to 12 new lookups a call; the rest come next time.
// A receipt photo from the shopping tab: read by the AI into the store, the
// date and the lines bought. The photo is not kept; the family checks the
// lines and saves them (to its own list history) from the app.
app.post('/api/receipts/scan', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    const { hid, fileData, mimeType } = req.body || {};
    if (!(await isHouseholdMember(req.authUserId, String(hid || '')))) return res.status(403).json({ error: 'not allowed' });
    if (!PRICES_OPEN && !(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'בקרוב!' });
    if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) return res.status(503).json({ error: 'קריאת קבלות לא זמינה כרגע.' });
    if (!fileData || !/^image\/(png|jpe?g|webp)$/i.test(String(mimeType || ''))) return res.status(400).json({ error: 'צריך תמונה (JPG או PNG).' });
    const ai = await generateWithFallback({ prompt: receipts.PROMPT, text: '', fileData, mimeType, effort: 'low', maxTokens: 8000, json: true, model: ANTHROPIC_FILES_MODEL });
    const r = receipts.parseReceipt(ai.output);
    if (r.error === 'not_receipt') return res.status(422).json({ error: 'זו לא נראית כמו קבלה. נסו לצלם את הקבלה עצמה, ישר ובאור טוב.' });
    if (r.error) return res.status(422).json({ error: 'לא הצלחנו לקרוא את הקבלה. נסו לצלם שוב, קרוב יותר ובאור טוב.' });
    return res.json(r);
  } catch (err) {
    reportServerError(err, 'POST /api/receipts/scan');
    return res.status(err.statusCode || 502).json({ error: 'לא הצלחנו לקרוא את הקבלה כרגע. נסו שוב בעוד דקה.' });
  }
});
app.post('/api/prices/images', requireAuth, async (req, res) => {
  try {
    // Photos are extra: without the database, simply none.
    if (!supabaseAdmin) return res.json({ images: {} });
    const codes = [...new Set((Array.isArray(req.body && req.body.barcodes) ? req.body.barcodes : []).map(String).filter((c) => /^[0-9]{8,14}$/.test(c)))].slice(0, 60);
    if (!codes.length) return res.json({ images: {} });
    const { data } = await supabaseAdmin.from('price_products').select('barcode,image_url,image_checked_at').in('barcode', codes);
    const out = {};
    const month = Date.now() - 30 * 86400000;
    const ask = [];
    for (const p of data || []) {
      if (p.image_url) out[p.barcode] = p.image_url;
      else if (!p.image_checked_at || new Date(p.image_checked_at).getTime() < month) ask.push(p.barcode);
    }
    const found = await Promise.all(ask.slice(0, 12).map(async (code) => {
      try {
        const r = await fetch('https://world.openfoodfacts.org/api/v2/product/' + code + '.json?fields=image_front_small_url,labels,labels_tags', { headers: { 'user-agent': 'BudgetApp/1.0 (household budget app, Israel)' }, signal: AbortSignal.timeout(6000) });
        const j = await r.json().catch(() => ({}));
        const url = String((j.product && j.product.image_front_small_url) || '');
        const labels = [String((j.product && j.product.labels) || ''), ...((j.product && Array.isArray(j.product.labels_tags)) ? j.product.labels_tags : [])].join(' ').slice(0, 2000);
        return { code, url: /^https:\/\/images\.openfoodfacts\.org\//.test(url) ? url : '', cert: (priceDomain && priceDomain.certFromText(labels)) || null };
      } catch (_e) { return null; }
    }));
    const at = new Date().toISOString();
    for (const f of found) {
      if (!f) continue;
      if (f.url) out[f.code] = f.url;
      await supabaseAdmin.from('price_products').update({ image_url: f.url || null, image_checked_at: at, ...(f.cert ? { kosher_cert: f.cert } : {}) }).eq('barcode', f.code);
    }
    return res.json({ images: out });
  } catch (err) {
    console.error('price images failed:', err.message);
    return res.json({ images: {} });
  }
});
// Every morning (pg_cron job "account-cleanup"): empty accounts nobody uses
// (no transactions, nobody else in the household, no sign-in for 3 months)
// are told two weeks before (by email, unless they asked for none), then
// deleted the way "delete my account" deletes them. Never the owner's.
// Without the account_cleanup table nothing is deleted.
app.post('/api/cron/cleanup', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    if (!(await checkCronSecret(req))) return res.status(401).json({ error: 'unauthorized' });
    const { data: marks, error: markErr } = await supabaseAdmin.from('account_cleanup').select('user_id,warned_at,deleted_at');
    if (markErr) return res.status(503).json({ error: 'no account_cleanup table' });
    const users = [];
    for (let page = 1; page < 50; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      users.push(...(data.users || []));
      if ((data.users || []).length < 200) break;
    }
    const { data: mems } = await allRows(() => supabaseAdmin.from('memberships').select('user_id,household_id,display_name').order('user_id'));
    const { data: quiet } = await allRows(() => supabaseAdmin.from('mail_prefs').select('user_id').eq('news', false).order('user_id'));
    const quietIds = new Set((quiet || []).map((q) => q.user_id));
    const byHome = new Map();
    for (const m of mems || []) byHome.set(m.household_id, [...(byHome.get(m.household_id) || []), m.user_id]);
    const txsOf = new Map();
    const homeTxs = async (hid) => {
      if (!txsOf.has(hid)) { const { count } = await supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).eq('household_id', hid); txsOf.set(hid, count || 0); }
      return txsOf.get(hid);
    };
    const rows = [];
    for (const u of users) {
      const homes = (mems || []).filter((m) => m.user_id === u.id).map((m) => m.household_id);
      let txs = 0, partners = 0;
      for (const hid of homes) { txs += await homeTxs(hid); partners += (byHome.get(hid) || []).filter((x) => x !== u.id).length; }
      rows.push({ id: u.id, email: u.email, name: ops.firstName(((mems || []).find((m) => m.user_id === u.id) || {}).display_name || ''), lastSeen: new Date(u.last_sign_in_at || u.created_at).getTime(), txs, partners, quiet: quietIds.has(u.id), keep: isOwnerEmail(u.email) });
    }
    const warned = new Map((marks || []).filter((m) => m.warned_at && !m.deleted_at).map((m) => [m.user_id, new Date(m.warned_at).getTime()]));
    const plan = cleanup.cleanupPlan(rows, warned);
    const dry = !!(req.body && req.body.dry);
    const out = { warn: plan.warn.length, remove: plan.remove.length, warned: 0, removed: 0, errors: [], dry };
    if (dry) return res.json(out);
    for (const u of plan.warn) {
      try {
        if (!u.quiet && u.email && mailStatus().ready) {
          await sendMailWithFallback({ to: u.email, ...cleanup.warningMail({ name: u.name, date: cleanup.deleteDate(), link: appLinkOf(req) }) });
        }
        await supabaseAdmin.from('account_cleanup').upsert({ user_id: u.id, warned_at: new Date().toISOString(), deleted_at: null }, { onConflict: 'user_id' });
        out.warned++;
      } catch (e) { out.errors.push('warn: ' + String(e.message || e).slice(0, 60)); }
    }
    for (const u of plan.remove) {
      try {
        await account.deleteAccount(supabaseAdmin, u.id);
        await supabaseAdmin.from('account_cleanup').upsert({ user_id: u.id, deleted_at: new Date().toISOString() }, { onConflict: 'user_id' });
        out.removed++;
      } catch (e) { out.errors.push('delete: ' + String(e.message || e).slice(0, 60)); }
    }
    console.log('account cleanup:', JSON.stringify(out));
    return res.json(out);
  } catch (err) {
    console.error('account cleanup failed:', err.message);
    return res.status(500).json({ error: 'failed' });
  }
});
// Every night (pg_cron job "prices-nightly"): today's prices from the chains.
app.post('/api/cron/prices', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    const given = String(req.headers['x-cron-secret'] || '');
    const { data: sec } = await supabaseAdmin.from('app_secrets').select('value').eq('key', 'cron_secret').maybeSingle();
    const expected = sec && sec.value ? String(sec.value) : '';
    const a = Buffer.from(given), b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !require('crypto').timingSafeEqual(a, b)) return res.status(401).json({ error: 'unauthorized' });
    if (!seedJob.running) runFreeLoad();
    return res.json({ started: true });
  } catch (err) {
    return res.status(500).json({ error: 'failed' });
  }
});
app.get('/api/admin/prices/load', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    return res.json(await seedState());
  } catch (err) {
    return res.status(500).json({ error: 'failed' });
  }
});
const seedRuns = new Map();
app.post('/api/admin/prices/seed', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    if (!APIFY_TOKEN) return res.status(503).json({ error: 'המפתח של Apify לא מוגדר בשרת (APIFY_TOKEN).' });
    const part = Math.max(0, Math.min(9, Number(req.body && req.body.part) || 0));
    const list = prices.SEED.slice(part * 20, part * 20 + 20);
    if (!list.length) return res.json({ runId: null, done: true });
    const input = prices.fetchInput(list, { max: 20 });
    const run = await prices.apifyStart(fetch, APIFY_TOKEN, input, { seconds: 600 });
    seedRuns.set(run.runId, {});
    return res.json({ runId: run.runId, part, parts: Math.ceil(prices.SEED.length / 20), queries: list });
  } catch (err) {
    console.error('price seed failed:', err.message);
    return res.status(502).json({ error: String(err.message).slice(0, 200) });
  }
});
app.get('/api/admin/prices/seed/:runId', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    const job = seedRuns.get(String(req.params.runId)) || {};
    if (job.result) return res.json(job.result);
    const r = await prices.apifyItems(fetch, APIFY_TOKEN, req.params.runId);
    if (!r.done) return res.json({ done: false, status: r.status, cost: r.cost });
    const saved = r.status === 'SUCCEEDED' ? await saveCatalog(r.items) : { products: 0, offers: 0 };
    job.result = { done: true, status: r.status, cost: r.cost, rows: r.items.length, ...saved };
    seedRuns.set(String(req.params.runId), job);
    return res.json(job.result);
  } catch (err) {
    console.error('price seed check failed:', err.message);
    return res.status(502).json({ error: String(err.message).slice(0, 200) });
  }
});
// The certifiers' list and how to read a label, shared with the app.
let priceDomain = null;
import(require('url').pathToFileURL(path.join(__dirname, 'public/app/src/domain/prices.js')).href)
  .then((m) => { priceDomain = m; })
  .catch((err) => console.error('Price rules not loaded:', err.message));
// Products waiting for the owner's word: what families put on their lists
// first (most families first), then the newest in the catalog.
app.get('/api/admin/kosher', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    const [{ count: products }, { data: owned }] = await Promise.all([
      supabaseAdmin.from('price_products').select('barcode', { count: 'exact', head: true }),
      allRows(() => supabaseAdmin.from('kosher_votes').select('barcode').eq('by_owner', true).order('barcode'))
    ]);
    const done = new Set((owned || []).map((x) => x.barcode));
    const q = String(req.query.q || '').trim().slice(0, 40);
    const fam = new Map();
    if (!q) {
      const { data: picked } = await supabaseAdmin.from('shopping_items').select('barcode,household_id').not('barcode', 'is', null).limit(5000);
      for (const r of picked || []) if (!done.has(r.barcode)) { const s = fam.get(r.barcode) || new Set(); s.add(r.household_id); fam.set(r.barcode, s); }
    }
    const top = [...fam.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 60).map(([c]) => c);
    const { data: bought } = top.length ? await supabaseAdmin.from('price_products').select('barcode,name,maker,qty,unit,kosher_cert').in('barcode', top) : { data: [] };
    let rows = supabaseAdmin.from('price_products').select('barcode,name,maker,qty,unit,kosher_cert').order('seen_at', { ascending: false }).limit(q ? 200 : 400);
    if (q) rows = rows.ilike('names', '%' + q.replace(/[%_,()]/g, ' ') + '%');
    const { data } = await rows;
    const first = (bought || []).map((p) => ({ ...p, fam: fam.get(p.barcode).size })).sort((a, b) => b.fam - a.fam);
    const seen = new Set(first.map((p) => p.barcode));
    const waiting = [...first, ...(data || []).filter((p) => !done.has(p.barcode) && !seen.has(p.barcode))].slice(0, q ? 200 : 60);
    return res.json({ products: products || 0, confirmed: done.size, waiting });
  } catch (err) {
    console.error('kosher list failed:', err.message);
    return res.status(500).json({ error: 'failed' });
  }
});
app.post('/api/admin/kosher', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    const cert = String((req.body && req.body.cert) || '');
    const codes = (Array.isArray(req.body && req.body.barcodes) ? req.body.barcodes : []).map(String).filter((c) => /^[0-9]{4,20}$/.test(c)).slice(0, 200);
    if (!priceDomain || !priceDomain.isCert(cert) || !codes.length) return res.status(400).json({ error: 'bad request' });
    const level = priceDomain.certLevel(cert);
    const { error } = await supabaseAdmin.from('kosher_votes').upsert(codes.map((barcode) => ({ barcode, household_id: prices.OWNER_VOTE, level, cert, by_owner: true })), { onConflict: 'barcode,household_id' });
    if (error) throw error;
    return res.json({ ok: true, count: codes.length });
  } catch (err) {
    console.error('kosher confirm failed:', err.message);
    return res.status(500).json({ error: 'לא נשמר.' });
  }
});
// The owner's evening summary email (pg_cron job "owner-daily-digest").
let todaySummary = null;
import(require('url').pathToFileURL(path.join(__dirname, 'public/app/src/domain/people-health.js')).href)
  .then((m) => { todaySummary = m.todaySummary; })
  .catch((err) => console.error('People summary not loaded:', err.message));
app.post('/api/admin/daily/run', async (req, res) => {
  try {
    if (!(await checkCronSecret(req))) return res.status(401).json({ error: 'unauthorized' });
    if (!FEEDBACK_TO || !mailStatus().ready || !todaySummary) return res.status(503).json({ error: 'not ready' });
    // Two cron runs a day (20:45 and 21:45 UTC); only the one at 23:45 in Israel sends.
    if (ops.israelClock().hour !== 23 && !(req.body && req.body.now)) return res.json({ ok: true, skipped: 'not 23:00 in Israel' });
    const { day, items } = await todayItems();
    const { count } = await supabaseAdmin.from('feedback').select('id', { count: 'exact', head: true }).eq('closed', false).eq('archived', false).eq('last_by', 'user');
    const mail = ops.ownerDigestMail({ day, summary: todaySummary(items), items, waiting: count || 0, link: appLinkOf(req) });
    await sendMailWithFallback({ to: FEEDBACK_TO, ...mail });
    return res.json({ ok: true, people: items.length });
  } catch (err) {
    console.error('owner digest failed:', err.message);
    return res.status(500).json({ error: 'failed' });
  }
});
// "Tell your friends": this person's link code and how many joined with it.
app.get('/api/share', requireAuth, async (req, res) => {
  try {
    const code = ops.refCode(req.authUserId, ADMIN_SALT);
    const { count } = await supabaseAdmin.from('referrals').select('user_id', { count: 'exact', head: true }).eq('ref_code', code);
    return res.json({ code, joined: count || 0 });
  } catch (err) { return res.status(500).json({ error: 'failed' }); }
});
// A thank-you to the person whose link it was: once per friend who joins
// (the referral row is unique per new account), never to the owner, and
// not to someone who turned off emails from us.
async function thankSharer(ref, req) {
  if (!mailStatus().ready) return;
  const { data } = await listAllUsers();
  const u = ((data && data.users) || []).find((x) => ops.refCode(x.id, ADMIN_SALT) === ref);
  if (!u || !u.email || isOwnerEmail(u.email)) return;
  const { data: pref } = await supabaseAdmin.from('mail_prefs').select('news').eq('user_id', u.id).maybeSingle();
  if (pref && pref.news === false) return;
  if (await mailedThisWeek(u.id)) return;
  // Marked first, once per friend who joined: never sent twice.
  const campaign = 'thanks-' + req.authUserId;
  const { error } = await supabaseAdmin.from('mail_sent').insert({ user_id: u.id, campaign });
  if (error) return;
  const { count } = await supabaseAdmin.from('referrals').select('user_id', { count: 'exact', head: true }).eq('ref_code', ref);
  const unsub = unsubLinkFor(u.id, publicOrigin(req), 'news');
  try {
    await sendMailWithFallback({ to: u.email, ...ops.thanksMail({ joined: count || 1, link: appLinkOf(req), unsubLink: unsub }), headers: unsubHeaders(unsub) });
  } catch (err) {
    await supabaseAdmin.from('mail_sent').update({ ok: false }).eq('user_id', u.id).eq('campaign', campaign);
    throw err;
  }
}
// Did we already email this person this week (anything they did not ask for)?
async function mailedThisWeek(userId) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data, error } = await supabaseAdmin.from('mail_sent').select('campaign,sent_at,ok').eq('user_id', userId).gte('sent_at', since);
  if (error) return true; // not sure: better no email than a second one
  return ops.mailedThisWeek(data || []);
}
// A new person who came from a friend's link. Counted once, only for an
// account made in the last 14 days, and never for one's own link.
app.post('/api/share/joined', requireAuth, async (req, res) => {
  try {
    const ref = String((req.body && req.body.ref) || '');
    if (!/^[0-9a-f]{6}$/.test(ref)) return res.status(400).json({ error: 'bad request' });
    if (ref === ops.refCode(req.authUserId, ADMIN_SALT)) return res.json({ ok: false });
    const { data } = await supabaseAdmin.auth.admin.getUserById(req.authUserId);
    const made = data && data.user && new Date(data.user.created_at).getTime();
    if (!made || Date.now() - made > 14 * 86400000) return res.json({ ok: false });
    const { error } = await supabaseAdmin.from('referrals').insert({ user_id: req.authUserId, ref_code: ref });
    if (!error) thankSharer(ref, req).catch((err) => console.error('thanks mail failed:', err.message));
    return res.json({ ok: !error });
  } catch (err) { return res.status(500).json({ error: 'failed' }); }
});
// One person's email, only when the owner asks for it (to write to them).
app.get('/api/admin/email', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  const who = String(req.query.who || '').slice(0, 20);
  if (!/^#[0-9a-f]{6}$/.test(who)) return res.status(400).json({ error: 'bad request' });
  const { data } = await listAllUsers();
  const u = ((data && data.users) || []).find((x) => ops.alias(x.id, ADMIN_SALT) === who);
  if (!u) return res.status(404).json({ error: 'not found' });
  console.log('owner viewed an email:', who);
  return res.json({ email: u.email || '' });
});

// The live count alone, refreshed every few seconds on the dashboard.
app.get('/api/admin/live', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  return res.json(presence.snapshot(Date.now(), await ownerIds().catch(() => [])));
});

// ═══ one-time emails from the dashboard (the owner reads, then sends) ═══
async function campaignData() {
  const [{ data: people }, { data: members }, { data: spans }, { data: sent }, { data: oldSent }, { data: off }, { data: emptyFails }, { data: uploads }] = await Promise.all([
    listAllUsers(),
    allRows(() => supabaseAdmin.from('memberships').select('user_id,household_id,created_at').order('created_at', { ascending: true })),
    supabaseAdmin.rpc('ops_tx_span'),
    allRows(() => supabaseAdmin.from('mail_sent').select('user_id,campaign,sent_at,ok').order('sent_at')),
    allRows(() => supabaseAdmin.from('reengage_sent').select('user_id').order('user_id')),
    allRows(() => supabaseAdmin.from('mail_prefs').select('user_id').eq('news', false).order('user_id')),
    // Excel statements read as empty (a fault of ours, fixed on 11.11), and uploads that went.
    supabaseAdmin.from('app_errors').select('user_id,at').like('message', 'הקובץ ריק%').like('path', 'import:xls%').not('user_id', 'is', null).limit(500),
    supabaseAdmin.from('app_events').select('user_id,at').eq('name', 'import_done').gte('at', new Date(Date.now() - 60 * 86400000).toISOString()).limit(5000)
  ]);
  // Failed that way, and no upload went after it.
  const lastFail = new Map();
  for (const f of emptyFails || []) if (!lastFail.has(f.user_id) || f.at > lastFail.get(f.user_id)) lastFail.set(f.user_id, f.at);
  const failed = [...lastFail].filter(([id, at]) => !(uploads || []).some((u) => u.user_id === id && u.at > at)).map(([id]) => id);
  // A person's first household, as the app opens it.
  const first = new Map();
  for (const m of members || []) if (!first.has(m.user_id)) first.set(m.user_id, m);
  return {
    users: (people && people.users) || [], members: [...first.values()], spans: spans || [],
    sent: [...(sent || []), ...(oldSent || []).map((r) => ({ user_id: r.user_id, campaign: 'start' }))], owners: (people && people.users || []).filter((u) => isOwnerEmail(u.email)).map((u) => String(u.email).toLowerCase()),
    stopped: (off || []).map((r) => r.user_id),
    failed, uploads: uploads || []
  };
}
const appLinkOf = (req) => (process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '') + '/app/';
const mailStatus = () => ops.mailReady({ brevo: !!(BREVO_API_KEY && BREVO_FROM), resendKey: RESEND_API_KEY, resendFrom: RESEND_FROM, smtp: !!mailer });
// How an email looks, with its design, for the dashboard's preview (shown in
// a frame there). The wording is not private: it is the same for everyone.
app.get('/mail-preview/:campaign', (req, res) => {
  const mail = ops.CAMPAIGNS.includes(req.params.campaign) ? ops.campaignMail(req.params.campaign, appLinkOf(req), appLinkOf(req).replace(/\/app\/$/, '') + '/unsubscribe?k=news') : null;
  if (!mail) return res.status(404).end();
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
  res.setHeader('Cache-Control', 'no-cache');
  return res.type('html').send(mail.html);
});
app.get('/api/admin/reengage', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  try {
    const [d, { data: clicks }] = await Promise.all([
      campaignData(),
      allRows(() => supabaseAdmin.from('app_events').select('user_id,name,at').like('name', 'mail_click_%').order('at'))
    ]);
    const link = appLinkOf(req);
    const st = ops.campaignStats(d.sent, d.stopped);
    const out = { sent: d.sent, clicks: clicks || [], uploads: d.uploads, stopped: d.stopped };
    const results = ops.campaignResults(out);
    const campaigns = ops.ON_BOARD.map((id) => ({ id, title: ops.campaignTitle(id), count: ops.campaignList(id, d).length, preview: ops.campaignMail(id, link), image: ops.campaignImage(id), done: { sent: 0, failed: 0, last: null, ...(st.byCampaign[id] || {}), clicked: 0, uploaded: 0, ...(results[id] || {}) } }));
    return res.json({ campaigns, stopped: st.stopped, kpis: ops.mailKpis(out), mail: mailStatus() });
  } catch (err) { return res.status(500).json({ error: 'failed' }); }
});
// The history of our emails, for the owner: who got which, when, whether
// it went, whether they clicked it, and who asked to stop.
app.get('/api/admin/mail/history', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  try {
    const [{ data: people }, { data: sent }, { data: clicks }, { data: stops }, { data: uploads }] = await Promise.all([
      listAllUsers(),
      allRows(() => supabaseAdmin.from('mail_sent').select('user_id,campaign,sent_at,ok').order('sent_at', { ascending: false })),
      allRows(() => supabaseAdmin.from('app_events').select('user_id,name,at').like('name', 'mail_click_%').order('at')),
      allRows(() => supabaseAdmin.from('mail_prefs').select('user_id,updated_at').eq('news', false).order('user_id')),
      allRows(() => supabaseAdmin.from('app_events').select('user_id,at').eq('name', 'import_done').gte('at', new Date(Date.now() - 120 * 86400000).toISOString()).order('at'))
    ]);
    const ids = [...new Set([...(sent || []), ...(stops || [])].map((r) => r.user_id))];
    const names = await feedbackNames(ids);
    return res.json(ops.mailHistory({ sent: sent || [], clicks: clicks || [], uploads: uploads || [], stops: stops || [], users: (people && people.users) || [], names, alias: (id) => ops.alias(id, ADMIN_SALT) }));
  } catch (err) {
    console.error('mail history failed:', err.message);
    return res.status(500).json({ error: 'failed' });
  }
});
app.post('/api/admin/reengage', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  const asked = req.body && req.body.campaign;
  if (asked && !ops.ON_BOARD.includes(asked)) return res.status(400).json({ error: 'המייל הזה כבר לא נשלח.' });
  const campaign = asked || 'start';
  const mail = ops.campaignMail(campaign, appLinkOf(req));
  try {
    // A test goes only to the owner's own address, and marks no one.
    if (req.body && req.body.test) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(req.authUserId);
      const to = data && data.user && data.user.email;
      if (!to) return res.status(400).json({ error: 'no email' });
      const own = unsubLinkFor(req.authUserId, publicOrigin(req), 'news');
      try { const r = await sendMailWithFallback({ to, ...ops.campaignMail(campaign, appLinkOf(req), own), subject: '[ניסיון] ' + mail.subject, headers: unsubHeaders(own) }); return res.json({ test: true, to, provider: r && r.provider }); } catch (err) { console.error('test mail failed:', err.message); return res.status(502).json({ error: ops.mailErrorText(err) }); }
    }
    if (!mailStatus().ready) return res.status(503).json({ error: 'השרת עוד לא מוגדר לשלוח מיילים למשתמשים.' });
    const all = ops.campaignList(campaign, await campaignData());
    // A few at a time, so the dashboard can show the real progress.
    const limit = Math.max(1, Math.min(50, Number(req.body && req.body.limit) || 50));
    const list = all.slice(0, limit);
    let sent = 0, failed = 0, lastError = '';
    for (const u of list) {
      // Checked again right before: something else may have gone out since the list was made.
      if (await mailedThisWeek(u.id)) continue;
      // Marked first: a person never gets the same email twice, even if this is pressed again.
      const { error } = await supabaseAdmin.from('mail_sent').insert({ user_id: u.id, campaign });
      // Not marked, so not sent (it could go twice otherwise); said, not skipped quietly.
      if (error) { failed++; lastError = 'המייל לא נשלח: מסד הנתונים לא קיבל את הרישום (' + String(error.message || '').slice(0, 120) + ')'; console.error('mail_sent insert failed:', error.message); continue; }
      const unsub = unsubLinkFor(u.id, publicOrigin(req), 'news');
      try { await sendMailWithFallback({ to: u.email, ...ops.campaignMail(campaign, appLinkOf(req), unsub), headers: unsubHeaders(unsub) }); sent++; } catch (err) {
        failed++; lastError = ops.mailErrorText(err);
        // Still marked (not sent again by itself), but counted as failed on the dashboard.
        await supabaseAdmin.from('mail_sent').update({ ok: false }).eq('user_id', u.id).eq('campaign', campaign);
      }
      await delay(400);
    }
    return res.json({ sent, failed, left: all.length - list.length, error: lastError || undefined });
  } catch (err) {
    console.error('campaign failed:', err.message);
    return res.status(500).json({ error: 'failed' });
  }
});

// ═══ two-step login: status, and the code by email ═══
const MFA_SALT = process.env.MFA_SALT || process.env.ADMIN_SALT || '';
const mfaMailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.authUserId || req.ip, message: { error: 'שלחנו כבר כמה קודים. נסו שוב בעוד רבע שעה.' } });
const mfaTryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.authUserId || req.ip, message: { error: 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.' } });
async function emailOf(req) {
  if (req.authEmail) return req.authEmail;
  const { data } = await supabaseAdmin.auth.admin.getUserById(req.authUserId);
  return (data && data.user && data.user.email) || '';
}
app.get('/api/2fa/status', requireAuth, async (req, res) => {
  try {
    const st = await mfaStateOf(req);
    return res.json({ ...st, mailReady: mailStatus().ready, email: undefined, emailOn: !!st.email, emailMasked: ops.maskEmail(await emailOf(req)) });
  } catch (err) { return res.status(500).json({ error: 'failed' }); }
});
app.post('/api/2fa/email/send', requireAuth, mfaMailLimiter, async (req, res) => {
  try {
    const purpose = req.body && req.body.purpose === 'enable' ? 'enable' : 'login';
    if (purpose === 'login') {
      const st = await mfaStateOf(req);
      if (!st.email) return res.status(400).json({ error: 'קוד במייל לא מופעל בחשבון הזה.' });
    }
    const to = await emailOf(req);
    if (!to) return res.status(400).json({ error: 'אין כתובת מייל בחשבון.' });
    const code = ops.makeCode();
    const { error } = await supabaseAdmin.from('mfa_email_codes').upsert({ user_id: req.authUserId, code_hash: ops.hashCode(code, req.authUserId, MFA_SALT), purpose, expires_at: new Date(Date.now() + ops.CODE_TTL_MS).toISOString(), attempts: 0, sent_at: new Date().toISOString() });
    if (error) throw error;
    try { await sendMailWithFallback({ to, ...ops.codeMail(code, purpose) }); } catch (err) { return res.status(502).json({ error: ops.mailErrorText(err) }); }
    return res.json({ sent: true, to: ops.maskEmail(to) });
  } catch (err) { console.error('2fa send failed:', err.message); return res.status(500).json({ error: 'לא הצלחנו לשלוח קוד. נסו שוב.' }); }
});
// Checks the code; on success the code is used up and this session passes.
async function useEmailCode(req, purpose) {
  const { data: row } = await supabaseAdmin.from('mfa_email_codes').select('*').eq('user_id', req.authUserId).maybeSingle();
  const result = ops.checkCode(row, req.body && req.body.code, { userId: req.authUserId, salt: MFA_SALT, purpose });
  if (result === 'wrong') await supabaseAdmin.from('mfa_email_codes').update({ attempts: (row.attempts || 0) + 1 }).eq('user_id', req.authUserId);
  if (result !== 'ok') return result;
  await supabaseAdmin.from('mfa_email_codes').delete().eq('user_id', req.authUserId);
  const sid = ops.tokenClaims(req.authToken).sessionId;
  if (sid) await supabaseAdmin.from('mfa_email_sessions').upsert({ session_id: sid, user_id: req.authUserId, verified_at: new Date().toISOString() });
  mfaCache.delete(req.authToken);
  return 'ok';
}
app.post('/api/2fa/email/verify', requireAuth, mfaTryLimiter, async (req, res) => {
  try {
    const r = await useEmailCode(req, 'login');
    return r === 'ok' ? res.json({ ok: true }) : res.status(400).json({ error: ops.CODE_ERRORS[r] });
  } catch (err) { console.error('2fa verify failed:', err.message); return res.status(500).json({ error: 'הבדיקה נכשלה. נסו שוב.' }); }
});
app.post('/api/2fa/email/enable', requireAuth, mfaTryLimiter, async (req, res) => {
  try {
    // Turning it on from a session that has not passed an existing two-step is not allowed.
    const st = await mfaStateOf(req);
    if (st.required && !st.ok) return res.status(403).json({ error: 'צריך לאשר את הכניסה בקוד', mfa: true });
    const r = await useEmailCode(req, 'enable');
    if (r !== 'ok') return res.status(400).json({ error: ops.CODE_ERRORS[r] });
    const { error } = await supabaseAdmin.from('mfa_email').upsert({ user_id: req.authUserId, enabled: true, updated_at: new Date().toISOString() });
    if (error) throw error;
    mfaCache.delete(req.authToken);
    return res.json({ ok: true });
  } catch (err) { console.error('2fa enable failed:', err.message); return res.status(500).json({ error: 'ההפעלה נכשלה. נסו שוב.' }); }
});
app.post('/api/2fa/email/disable', requireAuth, async (req, res) => {
  try {
    const st = await mfaStateOf(req);
    if (st.required && !st.ok) return res.status(403).json({ error: 'צריך לאשר את הכניסה בקוד', mfa: true });
    // For an account with a password it is required, unless an app code protects it instead.
    if (st.mandatory && !st.totp) return res.status(400).json({ error: 'בחשבון עם סיסמה הקוד במייל הוא חובה. אפשר להפעיל קוד מאפליקציה במקומו, ואז לכבות את המייל.' });
    const { error } = await supabaseAdmin.from('mfa_email').upsert({ user_id: req.authUserId, enabled: false, updated_at: new Date().toISOString() });
    if (error) throw error;
    mfaCache.delete(req.authToken);
    return res.json({ ok: true });
  } catch (err) { return res.status(500).json({ error: 'הכיבוי נכשל. נסו שוב.' }); }
});

// ═══ requests from users (a problem or an idea) ═══
// Saved, and the owner gets an email at once. The owner answers from the
// dashboard; the person sees the status and the answer in the app.
const feedbackLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.authUserId || req.ip, message: { error: 'שלחתם הרבה פניות בשעה האחרונה. נסו שוב מאוחר יותר.' } });
app.post('/api/feedback', requireAuth, feedbackLimiter, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    const row = ops.cleanFeedback(req.body, req.authUserId);
    if (!row) return res.status(400).json({ error: 'כתבו לפחות כמה מילים.' });
    const { data, error } = await supabaseAdmin.from('feedback').insert(row).select('id,created_at').single();
    if (error) throw error;
    const who = (await feedbackNames([req.authUserId]))[req.authUserId] || ops.alias(req.authUserId, ADMIN_SALT);
    const label = { bug: 'תקלה', idea: 'הצעה', other: 'פנייה' }[row.kind];
    const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    // The email never holds the person's address: the answer goes through the app.
    sendMailWithFallback({
      to: FEEDBACK_TO, subject: `${label} חדשה מ-${who}`,
      text: `${label} מ-${who} (מסך: ${row.screen || '-'}, ${row.device || '-'})\n\n${row.text}\n\nלענות ולסמן טיפול: לוח הבעלים באפליקציה.`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif"><b>${label}</b> מ-${who} <small>(מסך: ${esc(row.screen || '-')}, ${esc(row.device || '-')})</small><p style="white-space:pre-wrap">${esc(row.text)}</p><p style="color:#777">לענות ולסמן טיפול: לוח הבעלים באפליקציה.</p></div>`
    }).catch((err) => console.error('feedback mail failed:', err.message));
    return res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('feedback failed:', err.message);
    return res.status(500).json({ error: 'הפנייה לא נשלחה. נסו שוב.' });
  }
});
// The owner's inbox: every request as a short conversation. The owner sees
// the person's first name from the app (or a label when there is none),
// never their email.
const FEEDBACK_COLS = 'id,user_id,kind,text,screen,device,status,owner_note,created_at,updated_at,pinned,archived,closed,helped,last_at,last_by,owner_seen_at,user_seen_at';
async function feedbackNames(ids) {
  if (!ids.length) return {};
  const { data } = await supabaseAdmin.from('memberships').select('user_id,display_name').in('user_id', ids);
  const out = {};
  for (const m of data || []) if (!out[m.user_id]) out[m.user_id] = ops.firstName(m.display_name);
  return out;
}
app.get('/api/admin/feedback', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  const { data, error } = await supabaseAdmin.from('feedback').select(FEEDBACK_COLS).order('last_at', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: 'failed' });
  const rows = data || [];
  const ids = rows.map((f) => f.id);
  const { data: msgs } = ids.length ? await supabaseAdmin.from('feedback_messages').select('feedback_id,author,text,created_at,image').in('feedback_id', ids).order('created_at', { ascending: true }) : { data: [] };
  const names = await feedbackNames([...new Set(rows.map((f) => f.user_id))]);
  const by = {};
  for (const m of msgs || []) (by[m.feedback_id] = by[m.feedback_id] || []).push(m);
  return res.json({ items: rows.map((f) => ops.threadView(f, by[f.id] || [], { name: names[f.user_id] || '', label: ops.alias(f.user_id, ADMIN_SALT) })) });
});
// Answer (and close, or ask and keep open), a note only the owner sees,
// status, pin, archive, unread/seen.
app.post('/api/admin/feedback/:id', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  const act = ops.ownerAction(req.body);
  if (!act) return res.status(400).json({ error: 'bad request' });
  const id = String(req.params.id);
  const { data, error } = await supabaseAdmin.from('feedback').update(act.row).eq('id', id).select('id,user_id,text').maybeSingle();
  if (error || !data) return res.status(404).json({ error: 'not found' });
  // Closed: its pictures are no longer needed.
  if (act.row && act.row.closed === true) removeFeedbackImages(id);
  const rows = [];
  if (act.note) rows.push({ feedback_id: id, author: 'note', text: act.note });
  if (act.message) rows.push({ feedback_id: id, author: 'owner', text: act.message });
  if (rows.length) {
    const { error: mErr } = await supabaseAdmin.from('feedback_messages').insert(rows);
    if (mErr) return res.status(500).json({ error: 'failed' });
  }
  // An answer reaches the person as a notification and, if asked, by email.
  let mailed = false;
  if (act.message) {
    sendPushToUser(data.user_id, { title: 'יש תשובה לפנייה שלך', body: act.message.slice(0, 140), url: '/app/?go=profile%2Ffeedback#/home' }).catch(() => {});
    if (req.body.mail !== false) {
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
        const to = u && u.user && u.user.email;
        if (to && mailStatus().ready) { await sendMailWithFallback({ to, ...ops.answerMail({ question: data.text, answer: act.message, link: appLinkOf(req) }) }); mailed = true; }
      } catch (err) { console.error('answer mail failed:', err.message); }
    }
  }
  return res.json({ ok: true, mailed });
});
const CHANGES = require('./server/changes');
// What can be seen about the person now, to tell whether their problem is
// gone: their household's setup and what happened since they wrote. No
// amounts, no text they typed elsewhere.
async function draftFacts(userId, since) {
  const out = [];
  try {
    const { data: m } = await supabaseAdmin.from('memberships').select('household_id').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (!m) out.push('אין לו עדיין משק בית (לא סיים הרשמה).');
    else {
      const [{ count: cats }, { count: txs }, { count: noCat }] = await Promise.all([
        supabaseAdmin.from('categories').select('id', { count: 'exact', head: true }).eq('household_id', m.household_id),
        supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).eq('household_id', m.household_id),
        supabaseAdmin.from('transactions').select('id', { count: 'exact', head: true }).eq('household_id', m.household_id).is('category_id', null)
      ]);
      out.push('קטגוריות במשק הבית: ' + (cats || 0) + '. תנועות: ' + (txs || 0) + ', מהן בלי קטגוריה: ' + (noCat || 0) + '.');
    }
    const [{ data: ev }, { data: er }] = await Promise.all([
      supabaseAdmin.from('app_events').select('name,at').eq('user_id', userId).gte('at', since).order('at', { ascending: false }).limit(200),
      supabaseAdmin.from('app_errors').select('message,at').eq('user_id', userId).gte('at', since).order('at', { ascending: false }).limit(20)
    ]);
    const opens = (ev || []).filter((e) => e.name === 'app_open');
    out.push(opens.length ? 'נכנס לאפליקציה ' + opens.length + ' פעמים מאז שכתב, לאחרונה ב-' + String(opens[0].at).slice(0, 16).replace('T', ' ') + '.' : 'לא נכנס לאפליקציה מאז שכתב.');
    const fails = (ev || []).filter((e) => e.name === 'import_fail').length;
    if (fails) out.push('העלאת פירוט נכשלה ' + fails + ' פעמים מאז שכתב.');
    out.push((er || []).length ? 'שגיאות מאז שכתב: ' + [...new Set(er.map((e) => String(e.message).slice(0, 80)))].slice(0, 3).join(' | ') : 'אין שגיאות מאז שכתב.');
  } catch (_e) { /* the draft still works without them */ }
  return out;
}
// A draft answer written by the AI from where things stand, for the owner to
// read, change and send (never sent by itself).
app.post('/api/admin/feedback/:id/draft', requireAuth, async (req, res) => {
  try {
    if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
    const id = String(req.params.id);
    const { data: f } = await supabaseAdmin.from('feedback').select('id,user_id,kind,text,created_at').eq('id', id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'not found' });
    const { data: msgs } = await supabaseAdmin.from('feedback_messages').select('author,text,created_at').eq('feedback_id', id).order('created_at', { ascending: true });
    const name = (await feedbackNames([f.user_id]))[f.user_id] || '';
    const facts = await draftFacts(f.user_id, f.created_at);
    const prompt = ops.draftPrompt({ status: req.body && req.body.status, hint: req.body && req.body.hint, kind: f.kind, name, messages: [{ author: 'user', text: f.text }, ...(msgs || [])], guide: APP_GUIDE, changes: CHANGES.slice(0, 25), facts, askedAt: f.created_at });
    if (!prompt) return res.status(400).json({ error: 'bad request' });
    const ai = await generateWithFallback({ prompt, text: '', maxTokens: 800, effort: 'low' });
    const d = ops.readDraft(ai.output);
    if (!d.text) return res.status(502).json({ error: 'לא הצלחנו לנסח. נסו שוב.' });
    return res.json(d);
  } catch (err) {
    console.error('feedback draft failed:', err.message);
    return res.status(502).json({ error: 'לא הצלחנו לנסח. נסו שוב.' });
  }
});
// The person's side of their own request: a reply (it reopens a closed
// one: "still not working"), "it helped", or "I read the answer".
const replyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.authUserId || req.ip, message: { error: 'שלחתם הרבה הודעות בשעה האחרונה. נסו שוב מאוחר יותר.' } });
app.post('/api/feedback/:id', requireAuth, replyLimiter, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    const id = String(req.params.id);
    const { data: f } = await supabaseAdmin.from('feedback').select('id,user_id,kind,status,closed,helped').eq('id', id).maybeSingle();
    if (!f || f.user_id !== req.authUserId) return res.status(404).json({ error: 'not found' });
    const act = ops.userAction(req.body, f);
    if (!act) return res.status(400).json({ error: 'כתבו לפחות כמה מילים.' });
    const { error } = await supabaseAdmin.from('feedback').update(act.row).eq('id', id);
    if (error) throw error;
    if (act.message) {
      const { error: mErr } = await supabaseAdmin.from('feedback_messages').insert({ feedback_id: id, author: 'user', text: act.message });
      if (mErr) throw mErr;
      const who = (await feedbackNames([req.authUserId]))[req.authUserId] || ops.alias(req.authUserId, ADMIN_SALT);
      sendMailWithFallback({
        to: FEEDBACK_TO, subject: (act.reopened ? 'פנייה נפתחה מחדש: ' : 'הודעה חדשה בפנייה של ') + who,
        text: `${who}${act.reopened ? ' כתב/ה שזה עדיין לא עובד' : ''}:\n\n${act.message}\n\nלענות: לוח הבעלים באפליקציה.`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif"><b>${ops.escHtml(who)}</b>${act.reopened ? ' כתב/ה שזה עדיין לא עובד' : ''}:<p style="white-space:pre-wrap">${ops.escHtml(act.message)}</p><p style="color:#777">לענות: לוח הבעלים באפליקציה.</p></div>`
      }).catch((err) => console.error('feedback reply mail failed:', err.message));
    }
    return res.json({ ok: true, reopened: !!act.reopened });
  } catch (err) {
    console.error('feedback reply failed:', err.message);
    return res.status(500).json({ error: 'לא נשלח. נסו שוב.' });
  }
});


// A picture with a request (what went wrong, or the idea). Kept in a private
// storage bucket; only the person who wrote and the owner can see it, through
// the server. Pictures go when the request is closed.
const imageLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.authUserId || req.ip, message: { error: 'צירפתם הרבה תמונות בשעה האחרונה. נסו שוב מאוחר יותר.' } });
app.post('/api/feedback/:id/image', requireAuth, imageLimiter, async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'not configured' });
    const id = String(req.params.id);
    if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'bad request' });
    const { data: f } = await supabaseAdmin.from('feedback').select('id,user_id').eq('id', id).maybeSingle();
    if (!f || f.user_id !== req.authUserId) return res.status(404).json({ error: 'not found' });
    const img = ops.feedbackImage(req.body && req.body.data);
    if (!img) return res.status(400).json({ error: 'אפשר לצרף תמונה (PNG, JPG או WebP) עד 1.5MB.' });
    const file = id + '/' + require('crypto').randomUUID() + '.' + img.ext;
    const { error: upErr } = await supabaseAdmin.storage.from('feedback').upload(file, img.buf, { contentType: img.type, upsert: false });
    if (upErr) throw upErr;
    const now = new Date().toISOString();
    const { error: mErr } = await supabaseAdmin.from('feedback_messages').insert({ feedback_id: id, author: 'user', text: 'צירפתי תמונה', image: file });
    if (mErr) throw mErr;
    await supabaseAdmin.from('feedback').update({ last_at: now, last_by: 'user' }).eq('id', id);
    return res.json({ ok: true, image: file });
  } catch (err) {
    console.error('feedback image failed:', err.message);
    return res.status(500).json({ error: 'התמונה לא נשלחה. נסו שוב.' });
  }
});
app.get('/api/feedback-image', requireAuth, async (req, res) => {
  try {
    const file = String(req.query.p || '');
    if (!supabaseAdmin || !ops.IMAGE_PATH.test(file)) return res.status(400).end();
    const { data: f } = await supabaseAdmin.from('feedback').select('user_id').eq('id', file.split('/')[0]).maybeSingle();
    if (!f || (f.user_id !== req.authUserId && !(await isAdmin(req.authUserId)))) return res.status(404).end();
    const { data, error } = await supabaseAdmin.storage.from('feedback').download(file);
    if (error || !data) return res.status(404).end();
    res.setHeader('Content-Type', data.type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    return res.send(Buffer.from(await data.arrayBuffer()));
  } catch (err) { return res.status(500).end(); }
});
async function removeFeedbackImages(id) {
  try {
    const { data } = await supabaseAdmin.storage.from('feedback').list(id, { limit: 100 });
    const files = (data || []).map((o) => id + '/' + o.name);
    if (files.length) await supabaseAdmin.storage.from('feedback').remove(files);
  } catch (err) { console.error('feedback image cleanup failed:', err.message); }
}

// ═══ the monthly summary by email ═══
// Each member who asked for it gets it once a month. The link at the
// bottom turns it off without signing in (and mail apps show "unsubscribe").
const UNSUB_SECRET = process.env.UNSUB_SECRET || VAPID_PRIVATE_KEY || ADMIN_SALT;
const publicOrigin = (req) => (process.env.PUBLIC_URL || (req ? req.protocol + '://' + req.get('host') : 'https://budget-web-u0iy.onrender.com')).replace(/\/$/, '');
const unsubLinkFor = (userId, origin, kind = 'monthly') => origin + '/unsubscribe?u=' + encodeURIComponent(userId) + '&t=' + ops.unsubToken(userId, UNSUB_SECRET, kind) + (kind === 'monthly' ? '' : '&k=' + kind);
const unsubHeaders = (link) => ({ 'List-Unsubscribe': '<' + link + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
async function mailMonthly(hid, data, { only = null, origin = publicOrigin(null), force = false } = {}) {
  if (!mailStatus().ready) return { sent: 0 };
  const ids = only ? [only] : await householdMembers(hid);
  const { data: prefs } = await supabaseAdmin.from('mail_prefs').select('user_id,monthly').in('user_id', ids);
  // Only for whoever said yes in the app.
  const yes = new Set((prefs || []).filter((p) => p.monthly === true).map((p) => p.user_id));
  let sent = 0;
  for (const uid of ids) {
    if (!yes.has(uid) && !force) continue;
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
    const to = u && u.user && u.user.email;
    if (!to) continue;
    const key = 'monthly-' + data.month;
    // Marked first, so a person never gets the same month twice; a failed send is unmarked.
    if (!force) { const { error } = await supabaseAdmin.from('mail_sent').insert({ user_id: uid, campaign: key }); if (error) continue; }
    const unsub = unsubLinkFor(uid, origin);
    try {
      await sendMailWithFallback({ to, ...ops.monthlyMail(data, { link: origin + '/app/', unsubLink: unsub }),
        headers: { 'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
      sent++;
    } catch (err) {
      if (!force) await supabaseAdmin.from('mail_sent').delete().eq('user_id', uid).eq('campaign', key);
      throw err;
    }
    await delay(400);
  }
  return { sent };
}
async function latestReport(hid) {
  const { data } = await supabaseAdmin.from('monthly_reports').select('month,data').eq('household_id', hid).order('month', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const p = new Date(data.month + '-15T12:00:00Z'); p.setUTCMonth(p.getUTCMonth() - 1);
  return { ...data.data, month: data.month, prev: { ...(data.data.prev || {}), month: p.toISOString().slice(0, 7) } };
}
// The owner: see it in their own inbox, with their own household's numbers.
app.post('/api/admin/monthly-mail/test', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  try {
    const { data: m } = await supabaseAdmin.from('memberships').select('household_id').eq('user_id', req.authUserId).order('created_at', { ascending: true }).limit(1).maybeSingle();
    const report = m && await latestReport(m.household_id);
    if (!report) return res.status(404).json({ error: 'עוד אין דוח חודשי למשק הבית שלך.' });
    const r = await mailMonthly(m.household_id, report, { only: req.authUserId, origin: publicOrigin(req), force: true });
    return res.json({ ok: true, sent: r.sent, month: report.month });
  } catch (err) { return res.status(502).json({ error: ops.mailErrorText(err) }); }
});
// The owner: send the latest month's summary to everyone who has not had it.
app.post('/api/admin/monthly-mail/send', requireAuth, async (req, res) => {
  if (!(await isAdmin(req.authUserId))) return res.status(403).json({ error: 'not allowed' });
  if (!mailStatus().ready) return res.status(503).json({ error: 'השרת עוד לא מוגדר לשלוח מיילים.' });
  try {
    // The latest month, then every household's report for it (never cut short).
    const { data: last } = await supabaseAdmin.from('monthly_reports').select('month').order('month', { ascending: false }).limit(1);
    const month = last && last[0] && last[0].month;
    const { data: rows } = month ? await allRows(() => supabaseAdmin.from('monthly_reports').select('household_id,month').eq('month', month).order('household_id')) : { data: [] };
    let sent = 0;
    for (const r of (rows || []).filter((x) => x.month === month)) {
      const report = await latestReport(r.household_id);
      if (report && report.month === month) sent += (await mailMonthly(r.household_id, report, { origin: publicOrigin(req) })).sent;
    }
    return res.json({ ok: true, month, sent });
  } catch (err) { return res.status(502).json({ error: ops.mailErrorText(err) }); }
});
// Turning it off (or back on) from the email, without signing in. The page
// asks for one tap, so a mail scanner opening the link changes nothing; mail
// apps' own "unsubscribe" button posts here directly (RFC 8058).
function unsubPage(title, body) {
  return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + ' · התקציב שלנו</title>'
    + '<link rel="icon" href="/wallet.svg" type="image/svg+xml"><link rel="stylesheet" href="/app/pages/pages.css"></head><body><main class="page"><section class="hero"><img src="/wallet-512.png" alt=""><h1>' + title + '</h1></section>' + body + '</main></body></html>';
}
const unsubForm = (u, t, on, label, ghost, k = 'monthly') => '<form method="post" action="/unsubscribe"><input type="hidden" name="u" value="' + ops.escHtml(u) + '"><input type="hidden" name="t" value="' + ops.escHtml(t) + '">'
  + (k === 'news' ? '<input type="hidden" name="k" value="news">' : '')
  + (on ? '<input type="hidden" name="on" value="1">' : '') + '<button class="btn' + (ghost ? ' btn-ghost' : '') + '" type="submit">' + label + '</button></form>';
const UNSUB_TEXT = {
  monthly: { title: 'הסיכום החודשי במייל', ask: 'להפסיק לקבל את הסיכום החודשי במייל?', off: 'הוסרתם מהסיכום החודשי', offText: 'לא נשלח לכם יותר את הסיכום החודשי.', on: 'הסיכום החודשי חזר', onText: 'נשלח לכם סיכום בתחילת כל חודש.' },
  news: { title: 'מיילים מ"התקציב שלנו"', ask: 'להפסיק לקבל מאיתנו מיילים עם טיפים ותזכורות?', off: 'לא נשלח לכם יותר מיילים כאלה', offText: 'הסרנו אתכם מהמיילים עם הטיפים והתזכורות.', on: 'חזרתם לרשימה', onText: 'נשלח לכם מדי פעם טיפ או תזכורת.' }
};
const unsubKind = (req) => (String((req.body && req.body.k) || req.query.k || 'monthly') === 'news' ? 'news' : 'monthly');
app.get('/unsubscribe', (req, res) => {
  res.setHeader('Content-Security-Policy', NEW_APP_CSP);
  const u = String(req.query.u || ''), t = String(req.query.t || ''), k = unsubKind(req), w = UNSUB_TEXT[k];
  if (!ops.unsubOk(u, t, UNSUB_SECRET, k)) return res.status(400).type('html').send(unsubPage('הקישור לא תקין', '<p class="lead">אפשר לכבות את הסיכום החודשי גם בפרופיל באפליקציה.</p><a class="btn" href="/app/">לאפליקציה</a>'));
  return res.type('html').send(unsubPage(w.title, '<p class="lead">' + w.ask + '</p>' + unsubForm(u, t, false, 'כן, להפסיק', false, k) + '<a class="btn btn-ghost" href="/app/">לא, להשאיר</a>'));
});
app.post('/unsubscribe', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
  res.setHeader('Content-Security-Policy', NEW_APP_CSP);
  const b = req.body || {};
  const u = String(b.u || req.query.u || ''), t = String(b.t || req.query.t || ''), k = unsubKind(req), w = UNSUB_TEXT[k];
  if (!supabaseAdmin || !ops.unsubOk(u, t, UNSUB_SECRET, k)) return res.status(400).type('html').send(unsubPage('הקישור לא תקין', '<a class="btn" href="/app/">לאפליקציה</a>'));
  const on = b.on === '1';
  const { error } = await supabaseAdmin.from('mail_prefs').upsert({ user_id: u, [k]: on, updated_at: new Date().toISOString() });
  if (error) return res.status(500).type('html').send(unsubPage('משהו נכשל', '<p class="lead">נסו שוב בעוד רגע, או כבו בפרופיל באפליקציה.</p>'));
  if (on) return res.type('html').send(unsubPage(w.on, '<p class="lead">' + w.onText + '</p><a class="btn" href="/app/">לאפליקציה</a>'));
  return res.type('html').send(unsubPage(w.off, '<p class="lead">' + w.offText + ' מיילים חשובים על החשבון, כמו קוד כניסה, ימשיכו להגיע.</p>' + unsubForm(u, t, true, 'טעיתי, להחזיר', true, k)));
});

// ═══ stage 4: monthly report (1st of the month, cron) ═══
app.post('/api/reports/run', async (req, res) => {
  try {
    if (!(await checkCronSecret(req))) return res.status(401).json({ error: 'unauthorized' });
    const today = israelToday();
    const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
    const month = d.toISOString().slice(0, 7);
    const p = new Date(d); p.setUTCMonth(p.getUTCMonth() - 1);
    const prevMonth = p.toISOString().slice(0, 7);
    const { data: hhs } = await supabaseAdmin.from('memberships').select('household_id');
    const ids = [...new Set((hhs || []).map((m) => m.household_id))];
    let made = 0, mailed = 0;
    const monthNames = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    for (const hid of ids) {
      const [{ data: tx }, { data: cats }, { data: goals }, { data: tasks }, { data: mems }] = await Promise.all([
        supabaseAdmin.from('transactions').select('type,amount,tx_date,category_id').eq('household_id', hid).in('type', COUNTED).gte('tx_date', prevMonth + '-01').lt('tx_date', addDaysIso(today, 1)),
        supabaseAdmin.from('categories').select('id,name').eq('household_id', hid),
        supabaseAdmin.from('goals').select('name,target_amount,saved_amount').eq('household_id', hid),
        supabaseAdmin.from('advisor_tasks').select('title,status,done_at').eq('household_id', hid),
        supabaseAdmin.from('advisor_memories').select('text').eq('household_id', hid).limit(30)
      ]);
      const sum = (m, type) => (tx || []).filter((t) => t.type === type && String(t.tx_date).slice(0, 7) === m).reduce((s, t) => s + Number(t.amount), 0);
      const income = sum(month, 'income'), expense = sum(month, 'expense');
      if (!income && !expense) continue;
      const pIncome = sum(prevMonth, 'income'), pExpense = sum(prevMonth, 'expense');
      const byCat = {}, byCatPrev = {};
      (tx || []).filter((t) => t.type === 'expense').forEach((t) => {
        const m = String(t.tx_date).slice(0, 7);
        if (m === month) byCat[t.category_id] = (byCat[t.category_id] || 0) + Number(t.amount);
        if (m === prevMonth) byCatPrev[t.category_id] = (byCatPrev[t.category_id] || 0) + Number(t.amount);
      });
      const catName = (id) => ((cats || []).find((c) => c.id === id) || {}).name || 'ללא קטגוריה';
      const top = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]).slice(0, 5)
        .map((id) => ({ name: catName(id), amount: Math.round(byCat[id]), prev: Math.round(byCatPrev[id] || 0) }));
      const data = {
        month, monthLabel: monthNames[Number(month.slice(5)) - 1] + ' ' + month.slice(0, 4),
        income: Math.round(income), expense: Math.round(expense), balance: Math.round(income - expense),
        prev: { income: Math.round(pIncome), expense: Math.round(pExpense), balance: Math.round(pIncome - pExpense) },
        topCategories: top,
        goals: (goals || []).map((g) => ({ name: g.name, pct: Number(g.target_amount) ? Math.round(Number(g.saved_amount || 0) / Number(g.target_amount) * 100) : 0 })).slice(0, 5),
        tasksDone: (tasks || []).filter((t) => t.status === 'done' && String(t.done_at || '').slice(0, 7) === month).length
      };
      try {
        const ai = await generateWithFallback({
          prompt: `אתה יועץ פיננסי למשק בית בישראל. כתוב דוח חודשי קצר על סמך הנתונים (JSON). בעברית חמה ועניינית.
narrative: 2–3 משפטים — מה היה החודש לעומת הקודם, מה בולט, מה הלך טוב. recommendations: בדיוק 3 פעולות קונקרטיות לחודש הבא, כל אחת עד 60 תווים, שאפשר להפוך למשימה.
התחשב בהחלטות של המשפחה (memories) ואל תסתור אותן: ${JSON.stringify((mems || []).map((m) => m.text))}
ענה רק ב-JSON: {"narrative":"...","recommendations":["...","...","..."]}`,
          text: JSON.stringify(data)
        });
        const j = JSON.parse(extractJsonText(ai.output || '{}'));
        data.narrative = String(j.narrative || '').slice(0, 600);
        data.recommendations = (Array.isArray(j.recommendations) ? j.recommendations : []).map((x) => String(x).slice(0, 90)).slice(0, 3);
      } catch (_e) { data.narrative = ''; data.recommendations = []; }
      const { data: row } = await supabaseAdmin.from('monthly_reports')
        .upsert({ household_id: hid, month, data }, { onConflict: 'household_id,month', ignoreDuplicates: true }).select('id');
      if (row && row.length) {
        made += 1;
        await pushHousehold(hid, { title: `📊 הדוח של ${data.monthLabel} מוכן`, body: `נשארו ₪${data.balance.toLocaleString('he-IL')} · 3 המלצות לחודש הבא`, url: '/app/#/money/report' });
        try { mailed += (await mailMonthly(hid, { ...data, prev: { ...data.prev, month: prevMonth } })).sent; } catch (err) { console.error('monthly mail failed:', err.message); }
      }
    }
    return res.json({ ok: true, month, households: ids.length, created: made, mailed });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/push/vapid-public-key', (req, res) => {
  if (!PUSH_CONFIGURED) return res.status(503).json({ error: 'Push not configured' });
  return res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/test', requireAuth, notifyLimiter, async (req, res) => {
  try {
    const result = await sendPushToUser(req.authUserId, {
      title: 'התראת ניסיון 🔔',
      body: 'זו התראה לדוגמה ממערכת התקציב. אם אתה רואה אותה — ההתראות עובדות!',
      url: '/app/#/home'
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({ ok: false, error: err.message || 'Push send failed' });
  }
});

app.post('/api/reminders/test', requireAuth, notifyLimiter, async (req, res) => {
  const { channel, email, appLink, integrations } = req.body || {};
  const userId = req.authUserId;
  const msg = `תזכורת ניסיון: אל תשכח לעדכן הוצאות והכנסות היום. ${appLink || ''}`.trim();
  const selected = String(channel || 'email').trim().toLowerCase();
  if (selected === 'email' && email) {
    try {
      const sent = await sendMailWithFallback({
        userId,
        to: email,
        subject: 'תזכורת ניסיון - מערכת התקציב',
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px"><h2 style="margin:0 0 10px">תזכורת ניסיון</h2><p>${msg}</p><p><a href="${appLink || APP_URL}">מעבר למערכת</a></p></div>`,
        text: msg
      });
      return res.json({ ok: true, channel: 'email', sent: true, provider: sent.provider, message: msg });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (selected === 'google_chat') {
    try {
      const mergedIntegrations = await resolveIntegrationsForChannelTest({ userId, integrations });
      const gcWebhook = String(mergedIntegrations.gcWebhook || '').trim();
      if (!gcWebhook) return res.status(400).json({ ok: false, error: 'Google Chat webhook is not configured' });
      const sent = await sendGoogleChatMessage({ webhookUrl: gcWebhook, text: msg });
      return res.json({ ok: true, channel: 'google_chat', sent: true, provider: sent.provider, status: sent.status, message: msg });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'Google Chat send failed' });
    }
  }

  if (selected === 'whatsapp') {
    try {
      const mergedIntegrations = await resolveIntegrationsForChannelTest({ userId, integrations });
      const waPhone = String(mergedIntegrations.waPhone || '').trim();
      const waApiKey = String(mergedIntegrations.waApiKey || '').trim();
      if (!waPhone || !waApiKey) {
        return res.status(400).json({ ok: false, error: 'WhatsApp phone/api key is not configured' });
      }
      const sent = await sendWhatsAppCallMeBot({ phone: waPhone, apiKey: waApiKey, text: msg });
      return res.json({ ok: true, channel: 'whatsapp', sent: true, provider: sent.provider, status: sent.status, message: msg });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'WhatsApp send failed' });
    }
  }

  return res.json({ ok: true, channel: channel || 'email', sent: false, email: email || null, message: msg });
});

app.post('/api/channels/test', requireAuth, notifyLimiter, async (req, res) => {
  try {
    const {
      channel = 'all',
      integrations,
      message
    } = req.body || {};
    const userId = req.authUserId;

    const selected = String(channel || 'all').trim().toLowerCase();
    const wantsGoogleChat = selected === 'all' || selected === 'google_chat';
    const wantsWhatsapp = selected === 'all' || selected === 'whatsapp';

    if (!wantsGoogleChat && !wantsWhatsapp) {
      return res.status(400).json({ ok: false, error: 'Invalid channel. Use all, google_chat, or whatsapp.' });
    }

    const mergedIntegrations = await resolveIntegrationsForChannelTest({ userId, integrations });
    const results = {};
    const sampleText = String(message || '✅ בדיקת חיבור ממערכת התקציב הצליחה.').trim();

    if (wantsGoogleChat) {
      const gcWebhook = String(mergedIntegrations.gcWebhook || '').trim();
      if (!gcWebhook) {
        results.google_chat = { ok: false, reason: 'Google Chat webhook is not configured' };
      } else {
        try {
          const sent = await sendGoogleChatMessage({ webhookUrl: gcWebhook, text: sampleText });
          results.google_chat = { ok: true, provider: sent.provider, status: sent.status };
        } catch (err) {
          results.google_chat = { ok: false, error: err.message || 'Google Chat send failed' };
        }
      }
    }

    if (wantsWhatsapp) {
      const waPhone = String(mergedIntegrations.waPhone || '').trim();
      const waApiKey = String(mergedIntegrations.waApiKey || '').trim();
      const waWebhook = String(mergedIntegrations.waWebhook || '').trim();
      if (waPhone && waApiKey) {
        try {
          const sent = await sendWhatsAppCallMeBot({ phone: waPhone, apiKey: waApiKey, text: sampleText });
          results.whatsapp = { ok: true, provider: sent.provider, status: sent.status };
        } catch (err) {
          results.whatsapp = { ok: false, error: err.message || 'WhatsApp send failed' };
        }
      } else if (!waWebhook) {
        results.whatsapp = { ok: false, reason: 'WhatsApp phone/api key is not configured' };
      } else {
        results.whatsapp = { ok: false, reason: 'Webhook mode is advanced. Recommended: fill phone + ApiKey for built-in flow.' };
      }
    }

    const successCount = Object.values(results).filter((r) => r && r.ok).length;
    const failedCount = Object.keys(results).length - successCount;
    const statusCode = successCount > 0 ? 200 : 400;

    return res.status(statusCode).json({
      ok: successCount > 0,
      results,
      summary: {
        successCount,
        failedCount
      }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Unexpected error' });
  }
});

app.post('/api/import/commit', requireAuth, aiLimiter, async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Supabase server credentials are not configured' });
    }

    const { householdId, transactions } = req.body || {};
    const userId = req.authUserId;
    if (!householdId || !Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ error: 'householdId and non-empty transactions are required' });
    }
    if (!(await isHouseholdMember(userId, householdId))) {
      return res.status(403).json({ error: 'User is not a member of this household' });
    }

    // category/account/card ids come from the client's AI-import UI --
    // trust that they belong to THIS household rather than inserting
    // whatever id was sent (would otherwise let one household's import
    // silently reference another household's category/account/card rows).
    const [{ data: validCats }, { data: validAccts }, { data: validCards }] = await Promise.all([
      supabaseAdmin.from('categories').select('id').eq('household_id', householdId),
      supabaseAdmin.from('bank_accounts').select('id').eq('household_id', householdId),
      supabaseAdmin.from('credit_cards').select('id').eq('household_id', householdId)
    ]);
    const catIds = new Set((validCats || []).map((c) => c.id));
    const acctIds = new Set((validAccts || []).map((a) => a.id));
    const cardIds = new Set((validCards || []).map((c) => c.id));

    const rows = transactions
      .map((t) => {
        const categoryId = t?.category_id && catIds.has(t.category_id) ? t.category_id : null;
        const subcategoryId = t?.subcategory_id && catIds.has(t.subcategory_id) ? t.subcategory_id : null;
        const accountId = t?.account_id && acctIds.has(t.account_id) ? t.account_id : null;
        const cardId = t?.card_id && cardIds.has(t.card_id) ? t.card_id : null;
        return {
          household_id: householdId,
          created_by: userId,
          type: t?.type === 'income' ? 'income' : 'expense',
          description: String(t?.description || 'ייבוא'),
          amount: Math.abs(Number(t?.amount) || 0),
          tx_date: String(t?.date || new Date().toISOString().slice(0, 10)),
          category_id: categoryId,
          subcategory_id: subcategoryId,
          nature: 'variable',
          spread: 'month',
          source: 'ai-file',
          account_id: accountId,
          card_id: cardId,
          payment_method: cardId ? 'credit' : 'cash'
        };
      })
      .filter((r) => r.amount > 0);

    if (!rows.length) {
      return res.status(400).json({ error: 'No valid transactions to insert' });
    }

    const { data, error } = await supabaseAdmin.from('transactions').insert(rows).select('*');
    if (error) {
      return res.status(500).json({ error: error.message || 'Failed to insert transactions' });
    }

    return res.json({ ok: true, inserted: data?.length || 0, rows: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

// Serves the frontend from this same service, so there's only one Render
// service (and one cold-start) instead of two. Registered after every /api/*
// route above so those still take priority.
// The new app (public/app) loads its few libraries from this server instead of
// a CDN, so its CSP can stay 'self'-only. Only these exact files are exposed.
const APP_VENDOR_FILES = {
  'preact.js': 'node_modules/preact/dist/preact.module.js',
  'hooks.js': 'node_modules/preact/hooks/dist/hooks.module.js',
  'htm.js': 'node_modules/htm/dist/htm.module.js',
  'supabase.js': 'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  // Loaded only when a PDF statement is picked.
  'pdf.js': 'node_modules/pdfjs-dist/build/pdf.min.mjs',
  'pdf.worker.js': 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'
};
// The fonts, from this site (no request to Google on every visit).
const FONT_FILE = /^(assistant|frank-ruhl-libre)-(hebrew|latin)-\d{3}-normal\.woff2$/;
app.get('/app/fonts/:file', (req, res) => {
  const m = FONT_FILE.exec(req.params.file);
  if (!m) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(path.join(__dirname, 'node_modules/@fontsource', m[1], 'files', req.params.file));
});
app.get('/app/vendor/:file', (req, res) => {
  const rel = APP_VENDOR_FILES[req.params.file];
  if (!rel) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(path.join(__dirname, rel));
});

// The new app has no build step: the browser discovers its ~100 modules one
// import at a time, a round trip per level. The shell lists every module up
// front (modulepreload), so they are all fetched in parallel right away.
function listModules(dir, base) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? listModules(path.join(dir, e.name), base + e.name + '/')
    : e.name.endsWith('.js') ? [base + e.name] : []));
}
let APP_SHELL = null;
function appShell() {
  if (APP_SHELL && process.env.NODE_ENV === 'production') return APP_SHELL;
  const html = fs.readFileSync(path.join(NEW_APP_DIR, 'index.html'), 'utf8');
  const mods = ['/app/vendor/preact.js', '/app/vendor/hooks.js', '/app/vendor/htm.js', ...listModules(path.join(NEW_APP_DIR, 'src'), '/app/src/')];
  const links = mods.map((m) => `<link rel="modulepreload" href="${m}">`).join('\n');
  APP_SHELL = html.replace('<script type="module"', links + '\n<script type="module"');
  return APP_SHELL;
}

// The main address opens the app; the query string is kept, so invite
// links (?invite=) and older push links still work.
app.get('/', (req, res) => {
  const q = req.originalUrl.indexOf('?');
  res.redirect(302, '/app/' + (q >= 0 ? req.originalUrl.slice(q) : ''));
});
// Pages that work without signing in: downloading the app, the privacy
// policy and how to delete an account (Google Play links to the last two),
// the terms of use and the accessibility statement (required by law).
for (const [route, file] of [['/download', 'download.html'], ['/privacy', 'privacy.html'], ['/delete-account', 'delete-account.html'], ['/terms', 'terms.html'], ['/accessibility', 'accessibility.html'], ['/security', 'security.html']]) {
  app.get(route, (req, res) => { res.setHeader('Content-Security-Policy', NEW_APP_CSP); res.sendFile(path.join(NEW_APP_DIR, 'pages', file)); });
}
// Google Play (Trusted Web Activity): proves the Android app and this site
// belong together, so the app opens full screen without a browser bar.
// Set TWA_SHA256 (from Play Console → App signing) once the app exists.
app.get('/.well-known/assetlinks.json', (req, res) => {
  const links = twa.assetLinks(process.env.TWA_PACKAGE, process.env.TWA_SHA256);
  if (!links) return res.status(404).json([]);
  return res.json(links);
});
// The previous version of the app is gone; its old address opens the app.
app.get(['/old', '/old/'], (req, res) => res.redirect(301, '/app/'));
// The service worker carries a version made from the app's own files, so
// every deploy that changes the app changes it too. Phones (installed or
// not) then pick up the whole new version at once, never half old, half new.
function appVersion() {
  const h = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else h.update(e.name).update(fs.readFileSync(p));
    }
  };
  walk(NEW_APP_DIR);
  h.update(fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js')));
  return h.digest('hex').slice(0, 12);
}
let SW_BODY = null;
app.get('/sw.js', (req, res) => {
  if (!SW_BODY || process.env.NODE_ENV !== 'production') {
    SW_BODY = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8').replace(/const CACHE = '[^']*';/, "const CACHE = 'budget-app-" + appVersion() + "';");
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/javascript').send(SW_BODY);
});
// A file shared to the app reaches here only when the app's service worker
// is not there yet: nothing is kept, the app says to share it again.
app.post('/app/share-target', (_req, res) => res.redirect(303, '/app/?action=shared-lost'));
app.use(express.static(PUBLIC_DIR, { index: false }));
// The new app uses hash routes (/app/#/money), so every other GET under /app
// gets its shell.
app.use('/app', (req, res, next) => {
  if (req.method !== 'GET') return next();
  res.setHeader('Cache-Control', 'no-cache');
  return res.type('html').send(appShell());
});
app.get('/app-config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.__APP_CONFIG = { API_BASE: '' };`);
});
// Anything else: a page opens the app, anything else is not found.
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.redirect(302, '/app/');
  return res.status(404).json({ error: 'not found' });
});

// Any route that throws: the person gets a plain error, and the failure is kept.
app.use((err, req, res, _next) => {
  console.error('unhandled route error:', req.path, err && err.message);
  reportServerError(err, req.method + ' ' + req.path);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: 'משהו השתבש. נסו שוב.' });
});

app.listen(PORT, () => {
  console.log(`Budget app server listening on http://localhost:${PORT}`);
});
