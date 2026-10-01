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

const app = express();
app.set('trust proxy', 1);
const PUBLIC_DIR = path.join(__dirname, 'public');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
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

// ═══ security headers ═══
// Applied to every response. The strict Content-Security-Policy only covers
// the new app under /app: the current app (public/index.html) relies on
// inline scripts, inline handlers and several CDNs, so a strict CSP would
// break it. It still gets the other headers.
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
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
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
async function requireAuth(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase server credentials are not configured' });
  }
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization bearer token' });
  }
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user?.id) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    req.authUserId = data.user.id;
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'Authentication failed' });
  }
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
    const limit = hh && hh.ai_monthly_limit;
    if (limit != null && Number(used) > Number(limit)) {
      return res.status(429).json({ error: `הגעתם למכסת ה-AI החודשית (${limit} פעולות). היא מתאפסת בתחילת החודש הבא.`, quota: { used: Number(used) - 1, limit } });
    }
    return next();
  } catch (_e) { return next(); }                   // never block on a quota bug
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

  const payload = JSON.stringify({ title: title || 'ניהול תקציב', body: body || '', url: url || APP_URL });
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

async function callClaude({ prompt, text, fileData, mimeType }) {
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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      temperature: 0.1,
      messages: [{ role: 'user', content }]
    })
  });

  const data = await response.json();
  if (!response.ok || data.type === 'error') {
    throw new Error(data.error?.message || 'Claude provider error');
  }

  return {
    provider: 'claude',
    model: ANTHROPIC_MODEL,
    output: (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  };
}

async function callGemini({ prompt, text, fileData, mimeType }) {
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
    generationConfig: { temperature: 0.1 }
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

  return {
    provider: 'gemini',
    model: GEMINI_MODEL,
    output: data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
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

  return {
    provider: 'grok',
    model: GROK_MODEL,
    output: data?.choices?.[0]?.message?.content || ''
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithFallback(payload) {
  const attempted = [];

  if (ANTHROPIC_KEY) {
    try {
      const result = await callClaude(payload);
      return { ...result, attempted };
    } catch (err) {
      attempted.push({ provider: 'claude', error: err.message || 'Unknown Claude error' });
      // one retry after a short delay, same reasoning as the Gemini retry below --
      // most failures at this stage are transient (rate limit, momentary 5xx).
      try {
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

async function sendMailWithFallback({ userId, to, subject, html, text }) {
  const errors = [];

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

app.get('/api/health', async (_req, res) => {
  const availableAiProviders = getAvailableAiProviders();
  return res.json({
    ok: true,
    aiConfigured: availableAiProviders.length > 0,
    aiProviders: availableAiProviders,
    geminiModel: GEMINI_MODEL,
    grokModel: GROK_MODEL,
    googleOAuthConfigured: isGoogleOAuthConfigured(),
    supabaseConfigured: !!supabaseAdmin,
    smtpConfigured: !!mailer,
    resendConfigured: !!RESEND_API_KEY,
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

    const aiResult = await generateWithFallback({ prompt, text, fileData, mimeType });
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

    if (!Array.isArray(parsed)) {
      parsed = [];
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
    return res.status(statusCode).json({
      error: err.message || 'Unexpected error',
      attemptedProviders: err.attempted || []
    });
  }
});

app.post('/api/ai/advice', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) {
      return res.status(503).json({ error: 'No AI key configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY and/or GROK_API_KEY' });
    }

    const { summary } = req.body || {};
    if (!summary) {
      return res.status(400).json({ error: 'summary is required' });
    }

    const prompt = `אתה יועץ פיננסי מקצועי שמנתח נתוני תקציב משפחתי אמיתיים בעברית, עבור משתמש בשם "${summary.userName || ''}". קיבלת סיכום נתונים (JSON) של הכנסות/הוצאות לפי חודש, פילוח לפי קטגוריות ברמת משק הבית (categorySpendingHistory, כולל מגמה של 6 חודשים לכל קטגוריה), פילוח אישי של המשתמש הזה בלבד לחודש הנוכחי (personalCategoryBreakdown), תקציבים מול בפועל, ויעדי חיסכון. אפשר לפנות למשתמש בשמו ולהתייחס גם להוצאות האישיות שלו וגם למצב הכולל של משק הבית. תן ניתוח קצר, כן וממוקד — לא כללי, מבוסס על המספרים בפועל.

חשוב: ענה אך ורק בפורמט JSON תקני (בלי markdown, בלי טקסט מסביב), במבנה הבא בדיוק:
{"healthLevel":"good|watch|risk","headline":"משפט אחד קצר שמסכם את המצב","strengths":["..."],"concerns":["..."],"tips":["..."]}

כללים: strengths/concerns/tips - כל אחד 2-4 פריטים, משפט קצר וברור, מבוסס על נתונים ספציפיים (ציין מספרים/קטגוריות בפועל). healthLevel="risk" אם יש חריגה משמעותית מתקציב או מאזן שלילי חוזר, "watch" אם יש נקודות לשיפור לא דרמטיות, "good" אם המצב יציב.`;

    const aiResult = await generateWithFallback({ prompt, text: JSON.stringify(summary) });
    const output = aiResult.output || '{}';
    let parsed = null;
    try {
      parsed = JSON.parse(extractJsonText(output));
    } catch (_err) {
      const candidate = String(output).match(/\{[\s\S]*\}/);
      if (candidate && candidate[0]) {
        try {
          parsed = JSON.parse(candidate[0]);
        } catch (_err2) {
          parsed = null;
        }
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(502).json({ error: 'AI response could not be parsed', rawOutput: output });
    }

    return res.json({
      advice: parsed,
      aiProvider: aiResult.provider,
      aiModel: aiResult.model
    });
  } catch (err) {
    const statusCode = err.statusCode || 502;
    return res.status(statusCode).json({ error: err.message || 'Unexpected error' });
  }
});

app.post('/api/ai/advice-chat', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) {
      return res.status(503).json({ error: 'No AI key configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY and/or GROK_API_KEY' });
    }

    const { summary, history, message } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    const historyText = Array.isArray(history)
      ? history.map((h) => `${h.role === 'user' ? 'משתמש' : 'יועץ'}: ${h.text}`).join('\n')
      : '';

    const prompt = `אתה יועץ פיננסי מקצועי ואדיב שעונה בעברית על שאלות המשך לגבי תקציב משפחתי, עבור משתמש בשם "${(summary && summary.userName) || ''}", בהתבסס על נתוני סיכום (JSON) שצורפו. שים לב: categorySpendingHistory מכיל נתונים מפורטים ברמת משק הבית לכל קטגוריה (מגמה חודשית 6 חודשים אחורה, ממוצע חודשי, ותתי-קטגוריות של החודש הנוכחי), ו-personalCategoryBreakdown מכיל את ההוצאות האישיות של המשתמש הזה בלבד לחודש הנוכחי. אם השאלה נוגעת לקטגוריה ספציפית (למשל רכב, אוכל, בריאות) או "ההוצאות שלי", חפש בנתונים האלה וענה על סמך המספרים בפועל, אל תגיד שאין לך מידע אם הקטגוריה קיימת בנתונים. ענה בקצרה ובאופן פרקטי (2-5 משפטים), ישירות לשאלה, בלי markdown ובלי כותרות. אם השאלה לא קשורה לכסף/תקציב, הפנה בעדינות בחזרה לנושא.
${historyText ? '\nהיסטוריית שיחה קודמת:\n' + historyText + '\n' : ''}
שאלת המשתמש הנוכחית: ${message}`;

    const aiResult = await generateWithFallback({ prompt, text: JSON.stringify(summary || {}) });
    return res.json({ reply: (aiResult.output || '').trim(), aiProvider: aiResult.provider });
  } catch (err) {
    const statusCode = err.statusCode || 502;
    return res.status(statusCode).json({ error: err.message || 'Unexpected error' });
  }
});

app.post('/api/ai/onboarding', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) {
      return res.status(503).json({ error: 'No AI key configured. Set ANTHROPIC_API_KEY, GEMINI_API_KEY and/or GROK_API_KEY' });
    }

    const { qaText } = req.body || {};
    if (!qaText) {
      return res.status(400).json({ error: 'qaText is required' });
    }

    const prompt = `אתה עוזר שמקים חשבון תקציב משפחתי חדש עבור משתמש, על סמך ראיון שאלות-ותשובות בעברית שצורף. חלץ מהתשובות נתונים מובנים כדי להקים את המערכת עבורו. אם משהו לא צוין או לא רלוונטי, השמט אותו (אל תמציא נתונים).

החזר JSON בלבד (ללא markdown), במבנה הבא בדיוק:
{
  "bankAccounts": [{"name":"שם תיאורי, למשל 'חשבון קובי'"}],
  "creditCards": [{"name":"שם הכרטיס","billingDay":מספר 1-28,"accountIndex":אינדקס בתוך bankAccounts (0 אם לא ברור)}],
  "recurringIncome": [{"description":"למשל 'משכורת קובי'","amount":מספר חודשי}],
  "recurringExpenses": [{"description":"למשל 'משכנתא' או 'שכירות' או 'חינוך ילדים'","amount":מספר חודשי}],
  "debts": [{"counterparty":"למי חייבים","amount":מספר,"note":"הערה חופשית כולל מועד פירעון אם צוין"}],
  "goals": [{"name":"שם היעד, למשל 'חיסכון חודשי' או 'חיסכון לילדים'","targetAmount":מספר או null אם לא צוין}]
}

ראיון השאלות-תשובות:
${qaText}`;

    const aiResult = await generateWithFallback({ prompt, text: qaText });
    const output = aiResult.output || '{}';
    let parsed = null;
    try {
      parsed = JSON.parse(extractJsonText(output));
    } catch (_err) {
      const candidate = String(output).match(/\{[\s\S]*\}/);
      if (candidate && candidate[0]) {
        try {
          parsed = JSON.parse(candidate[0]);
        } catch (_err2) {
          parsed = null;
        }
      }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return res.status(502).json({ error: 'AI response could not be parsed', rawOutput: output });
    }

    return res.json({ setup: parsed, aiProvider: aiResult.provider, aiModel: aiResult.model });
  } catch (err) {
    const statusCode = err.statusCode || 502;
    return res.status(statusCode).json({ error: err.message || 'Unexpected error' });
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
// ═══ AI advisor → action plan (tasks with clear steps + push reminders) ═══
const TASK_TABS = ['dash', 'expenses', 'charts', 'categories', 'accounts', 'loans', 'installments', 'investments', 'planning'];
function israelToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date()); // YYYY-MM-DD
}
function addDaysIso(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

app.post('/api/ai/action-plan', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) {
      return res.status(503).json({ error: 'No AI key configured' });
    }
    const { summary, advice, messages } = req.body || {};
    if (!summary) return res.status(400).json({ error: 'summary is required' });

    const convo = (Array.isArray(messages) ? messages : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'ai') && m.text)
      .slice(-12)
      .map((m) => `${m.role === 'user' ? 'משתמש' : 'יועץ'}: ${String(m.text).slice(0, 1500)}`)
      .join('\n');

    const prompt = `אתה יועץ פיננסי שהופך ייעוץ לתוכנית פעולה מעשית בעברית, עבור "${summary.userName || ''}".
קיבלת: סיכום נתוני התקציב (JSON), את הניתוח שנתת (advice) ואת השיחה עם המשתמש.
צור 3 עד 6 משימות שהמשתמש צריך לבצע כדי ליישם את ההמלצות. כל משימה:
- title: פעולה אחת ברורה, מתחילה בפועל (למשל "להוריד את תקציב המסעדות ל-600 ₪ בחודש"), עד 60 תווים.
- why: משפט אחד שמסביר למה, עם המספרים האמיתיים מהנתונים.
- steps: 2 עד 5 צעדים קצרים וקונקרטיים לביצוע, כל אחד פעולה שאפשר לסמן כבוצעה (למשל "להיכנס לאתר של חברת הביטוח ולבקש הצעה מתחרה").
- due_in_days: בעוד כמה ימים לבצע (0 עד 30). משימות קלות ודחופות מוקדם, גדולות מאוחר יותר.
- link_tab: המסך באפליקציה שבו מבצעים את זה, אחד מ: ${TASK_TABS.join(', ')}, או null.
- target_amount: סכום יעד בשקלים אם רלוונטי, אחרת null.
- deliverable_kind: אם כדאי שהיועץ יכין תוצר מוכן למשימה: "checklist" (רשימת בדיקה), "budget" (תקציב חודשי לקטגוריות), "meal_plan" (תפריט שבועי ורשימת קניות), "comparison" (השוואת הצעות מחיר), "message" (מכתב/הודעה/תסריט שיחה), "savings_plan" (תוכנית חיסכון ליעד), "loan_payoff" (סדר פירעון הלוואות), "info" (משכנתא/השקעות: חישובים ושאלות), אחרת null.
- בכל צעד שבו המשתמש צריך לדווח מידע (הצעת מחיר, תשובה שקיבל, תאריך), הפוך את הצעד לאובייקט: {"text":"...","input":{"type":"number|text|date|choice","label":"...","options":["..."]}}. צעד בלי דיווח נשאר מחרוזת.
אל תמציא נתונים שלא מופיעים בסיכום. העדף משימות שהשיחה עסקה בהן.
ענה אך ורק ב-JSON תקני בלי markdown: {"tasks":[{"title":"","why":"","steps":["", {"text":"","input":{"type":"number","label":""}}],"due_in_days":0,"link_tab":null,"target_amount":null,"deliverable_kind":null}]}`;

    const text = JSON.stringify({ summary, advice: advice || null }) + (convo ? '\n\nהשיחה:\n' + convo : '');
    const aiResult = await generateWithFallback({ prompt, text });
    let parsed = null;
    try { parsed = JSON.parse(extractJsonText(aiResult.output || '')); } catch (_e) {
      const m = String(aiResult.output || '').match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (_e2) { parsed = null; } }
    }
    const raw = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null;
    if (!raw) return res.status(502).json({ error: 'AI response could not be parsed' });

    const today = israelToday();
    const tasks = raw.slice(0, 6).map((t) => {
      const days = Math.max(0, Math.min(60, parseInt(t.due_in_days, 10) || 7));
      const INPUT_TYPES = ['number', 'text', 'date', 'choice'];
      const steps = (Array.isArray(t.steps) ? t.steps : []).slice(0, 6).map((x) => {
        const text = String((x && typeof x === 'object') ? x.text : x || '').trim().slice(0, 200);
        if (!text) return null;
        const step = { text, done: false };
        const inp = x && typeof x === 'object' ? x.input : null;
        if (inp && INPUT_TYPES.includes(inp.type)) {
          step.input = { type: inp.type, label: String(inp.label || '').slice(0, 80) };
          if (inp.type === 'choice') step.input.options = (Array.isArray(inp.options) ? inp.options : ['כן', 'לא']).map(String).slice(0, 5);
        }
        return step;
      }).filter(Boolean);
      return {
        title: String(t.title || '').trim().slice(0, 120),
        why: String(t.why || '').trim().slice(0, 400) || null,
        steps,
        due_date: addDaysIso(today, days),
        link_tab: TASK_TABS.includes(t.link_tab) ? t.link_tab : null,
        target_amount: Number.isFinite(+t.target_amount) && +t.target_amount > 0 ? Math.round(+t.target_amount) : null,
        deliverable_kind: ['checklist', 'budget', 'meal_plan', 'comparison', 'message', 'savings_plan', 'loan_payoff', 'info'].includes(t.deliverable_kind) ? t.deliverable_kind : null
      };
    }).filter((t) => t.title);
    return res.json({ tasks, aiProvider: aiResult.provider });
  } catch (err) {
    return res.status(err.statusCode || 502).json({ error: err.message || 'Unexpected error' });
  }
});

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
function buildChatPrompt(summary, history, message, authorName, fixContext) {
  const historyText = Array.isArray(history)
    ? history.slice(-20).map((h) => `${h.role === 'user' ? (h.author || 'משתמש') : 'יועץ'}: ${String(h.text || '').slice(0, 2000)}`).join('\n')
    : '';
  return `אתה יועץ פיננסי חם, ענייני ומקצועי למשק בית בישראל. עונים בעברית פשוטה.
בשיחה יכולים להשתתף שני בני הזוג; ההודעה הנוכחית נכתבה על ידי ${authorName || 'משתמש'} — פנה אליו/אליה בשמו/ה כשזה טבעי.
הנתונים (JSON) כוללים categorySpendingHistory ברמת משק הבית, personalCategoryBreakdown של המשתמש, תקציבים, יעדים ומשימות. ענה על סמך המספרים בפועל, 2-6 משפטים, בלי markdown ובלי כותרות.
בהחלטות גדולות (משכנתא, השקעות) תן מידע, חישובים ושאלות לבדיקה, וציין שכדאי להתייעץ עם יועץ מורשה; אל תמליץ על נייר ערך או מוצר ספציפי.
אם בנתונים יש memories (החלטות והעדפות שבני הזוג קבעו בעבר): התחשב בהן כעובדה, אל תציע משהו שסותר אותן אלא אם שואלים, ואם משהו השתנה — שאל.
אם בנתונים יש feelings (איך בני הזוג מרגישים השבוע עם הכסף): כשמישהו "stressed" — טון רגוע, צעד אחד קטן בכל פעם, הזכר מה כבר הולך טוב; כשכולם "calm" — אפשר להציע יעד גדול יותר. אל תכתוב "ראיתי שאתה לחוץ" אלא אם שאלו.
בסוף התשובה, בשורה נפרדת, כתוב בדיוק: ${SUGG_MARK} ואחריו 2-3 שאלות המשך קצרות (עד 5 מילים כל אחת) מופרדות ב-|.
${fixContext || ''}
${historyText ? '\nהשיחה עד עכשיו:\n' + historyText + '\n' : ''}
ההודעה הנוכחית (${authorName || 'משתמש'}): ${message}`;
}

app.post('/api/ai/advice-chat-stream', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  const { summary, history, message, authorName, candidates, categories } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message is required' });
  if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) return res.status(503).json({ error: 'No AI key configured' });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const prompt = buildChatPrompt(summary, history, message, authorName, buildFixContext(candidates, categories));
  const text = JSON.stringify(summary || {}).slice(0, 12000);
  try {
    if (ANTHROPIC_KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 3000, temperature: 0.3, stream: true,
          messages: [{ role: 'user', content: `${prompt}\n\n${text}` }] })
      });
      if (r.ok && r.body) {
        const decoder = new TextDecoder();
        let buf = '';
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
            } catch (_e) { /* ignore keep-alives */ }
          }
        }
        send({ done: true, provider: 'claude' });
        return res.end();
      }
    }
    // fallback: no streaming — whole answer as one chunk
    const ai = await generateWithFallback({ prompt, text });
    send({ delta: String(ai.output || '').trim() });
    send({ done: true, provider: ai.provider });
    return res.end();
  } catch (err) {
    send({ error: err.message || 'AI error' });
    return res.end();
  }
});

// ═══ deliverables: create / revise together / shopping list ═══
const DELIVERABLE_SPECS = {
  checklist: '{"items":[{"text":"..."}]}  — 4 עד 12 פריטים קונקרטיים לבדיקה או לביצוע.',
  budget: '{"lines":[{"category":"שם קטגוריה קיים בדיוק כמו בנתונים","current_avg":0,"proposed":0,"note":"..."}]}  — current_avg מהנתונים בפועל; proposed מציאותי.',
  meal_plan: '{"days":[{"day":"ראשון","meal":"...","note":""}],"assumptions":"...","est_weekly_cost":0}  — ארוחות ערב לשבוע, פשוטות וחסכוניות, לפי מה שנאמר בשיחה.',
  comparison: '{"subject":"...","columns":["חברה/אפשרות","מחיר בחודש","הערה"],"rows":[{"name":"...","monthly":0,"note":"...","current":true}],"best":"שם האפשרות הכי משתלמת או null","yearly_saving":0}  — כלול את המצב הנוכחי מהנתונים (current:true). סכומים שהמשתמש דיווח בצעדי המשימה (value) הם נתונים אמיתיים; אל תמציא הצעות מחיר — אם חסר, השאר את השורה עם monthly null ו-note "לבירור".',
  message: '{"channel":"email|whatsapp|call","to":"למי","subject":"נושא או null","body":"הנוסח המלא","tips":["טיפ קצר לשיחה"]}  — בעברית, מנומס וענייני, עם המספרים האמיתיים. בשיחת טלפון body הוא תסריט קצר.',
  savings_plan: '{"goal_name":"...","target_amount":0,"monthly":0,"months":0,"target_date":"YYYY-MM-DD","start_from":0,"notes":"..."}  — ריאלי לפי המאזן החודשי בפועל; start_from = סכום שכבר נחסך אם ידוע.',
  loan_payoff: '{"strategy":"שם הגישה","order":[{"loan":"שם ההלוואה כפי שמופיע בנתונים","balance":0,"monthly":0,"extra":0,"payoff_date":"YYYY-MM"}],"total_interest_saved":0,"notes":"..."}  — רק הלוואות שמופיעות בנתונים; אם חסר מידע כמו ריבית, ציין הנחה.',
  info: '{"topic":"...","calcs":[{"label":"...","value":"..."}],"questions":["שאלה לבדוק מול בנק/יועץ"],"considerations":["..."],"disclaimer":"מידע וחישובים בלבד, לא ייעוץ מורשה"}  — משכנתא/השקעות: חישובים על הנתונים, שאלות נכונות, בלי המלצה על מוצר או נייר ערך ספציפי.',
  shopping_list: '{"sections":[{"name":"מחלקה","items":[{"text":"מוצר, כמות","for":"לאיזו ארוחה"}]}],"at_home":["..."],"est_cost":0}  — מאוחד (בלי כפילויות), לפי מחלקות בסופר, בלי מה שכבר יש בבית.'
};
app.post('/api/ai/deliverable', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    if (!ANTHROPIC_KEY && !GEMINI_KEY && !GROK_KEY) return res.status(503).json({ error: 'No AI key configured' });
    const { summary, task, kind, content, chat, message, action, authorName } = req.body || {};
    const outKind = action === 'shopping_list' ? 'shopping_list' : kind;
    if (!DELIVERABLE_SPECS[outKind]) return res.status(400).json({ error: 'unknown deliverable kind' });
    const chatText = (Array.isArray(chat) ? chat : []).slice(-16)
      .map((m) => `${m.role === 'user' ? (m.author || 'משתמש') : 'יועץ'}: ${String(m.text || '').slice(0, 1200)}`).join('\n');
    const mode = action === 'shopping_list'
      ? 'בנה רשימת קניות מהתפריט המאושר (content).'
      : content ? 'עדכן את הטיוטה הקיימת (content) לפי ההודעה האחרונה. שנה רק מה שהתבקש.'
        : 'צור טיוטה ראשונה. אם חסר מידע חיוני (למשל בתפריט: כמה נפשות, הגבלות ומה לא אוכלים, כמה ערבים מבשלים) — אל תיצור עדיין, רק שאל עד 3 שאלות קצרות.';
    const prompt = `אתה יועץ פיננסי למשק בית, בונה תוצר מעשי בעברית עבור המשימה: "${(task && task.title) || ''}".
${mode}
מבנה התוכן (content) לסוג "${outKind}": ${DELIVERABLE_SPECS[outKind]}
ענה אך ורק ב-JSON תקני בלי markdown:
{"reply":"משפט או שניים למשתמש","questions":["..."] או [],"content":<תוכן לפי המבנה או null אם אתה רק שואל>,"changes":["מה שונה מהגרסה הקודמת"]}
${chatText ? '\nהשיחה על התוצר:\n' + chatText : ''}
${message ? `\nהודעה חדשה (${authorName || 'משתמש'}): ${message}` : ''}`;
    const text = JSON.stringify({ summary: summary || null, task: task || null, content: content || null }).slice(0, 12000);
    const ai = await generateWithFallback({ prompt, text });
    let parsed = null;
    try { parsed = JSON.parse(extractJsonText(ai.output || '')); } catch (_e) {
      const m = String(ai.output || '').match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (_e2) { parsed = null; } }
    }
    if (!parsed || typeof parsed !== 'object') return res.status(502).json({ error: 'AI response could not be parsed' });
    return res.json({
      kind: outKind,
      reply: String(parsed.reply || '').slice(0, 1500),
      questions: Array.isArray(parsed.questions) ? parsed.questions.map(String).slice(0, 4) : [],
      content: parsed.content && typeof parsed.content === 'object' ? parsed.content : null,
      changes: Array.isArray(parsed.changes) ? parsed.changes.map(String).slice(0, 8) : []
    });
  } catch (err) {
    return res.status(err.statusCode || 502).json({ error: err.message || 'Unexpected error' });
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
        await sendPushToUser(userId, { title, body, url: (APP_URL.replace(/\/$/, '')) + '/?tab=advisor' });
        sentUsers += 1;
      } catch (_e) { /* no subscription for this user – the in-app list still shows it */ }
      await supabaseAdmin.from('advisor_tasks').update({ last_reminded_on: today }).in('id', list.map((t) => t.id));
    }
    return res.json({ ok: true, today, dueTasks: due.length, usersNotified: sentUsers });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/market/quote', requireAuth, async (req, res) => {
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
app.get('/api/market/quotes', requireAuth, async (req, res) => {
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
    supabaseAdmin.from('transactions').select('id,type,amount,description,tx_date,category_id,card_id,created_at').eq('household_id', hid).gte('tx_date', since),
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
          body: fresh[0].title + (fresh.length > 1 ? ` ועוד ${fresh.length - 1}` : ''), url: APP_URL.replace(/\/$/, '') + '/?tab=dash' });
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
        supabaseAdmin.from('transactions').select('type,amount,tx_date,category_id').eq('household_id', hid).gte('tx_date', since),
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
          text: JSON.stringify(summary)
        });
        const j = JSON.parse(extractJsonText(ai.output || '{}'));
        decisions = (Array.isArray(j.decisions) ? j.decisions : []).map((d) => ({ text: String(d).slice(0, 90), votes: {} })).slice(0, 3);
      } catch (_e) { decisions = []; }
      const { data: row } = await supabaseAdmin.from('weekly_checkins')
        .upsert({ household_id: hid, week_start: weekStart, summary, decisions }, { onConflict: 'household_id,week_start', ignoreDuplicates: true }).select('id');
      if (row && row.length) {
        made += 1;
        await pushHousehold(hid, { title: '📅 רבע השעה הזוגית שלכם מוכנה', body: `השבוע יצאו ₪${summary.spentWeek.toLocaleString('he-IL')}. ${decisions.length ? decisions.length + ' החלטות קטנות מחכות לכם.' : ''}`.trim(), url: APP_URL.replace(/\/$/, '') + '/?tab=dash&checkin=1' });
      }
    }
    return res.json({ ok: true, households: ids.length, created: made });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══ stage 2: "what if" — turn a sentence into dated cash-flow events ═══
app.post('/api/ai/scenario', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    const { text, summary } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });
    const today = israelToday();
    const prompt = `המר תרחיש "מה אם" של משק בית לאירועים כספיים. היום ${today}. החודשים בפורמט YYYY-MM.
אירוע חד-פעמי: {"type":"once","month":"YYYY-MM","amount":<שלילי להוצאה, חיובי להכנסה>,"label":"..."}
שינוי חודשי קבוע: {"type":"monthly","from":"YYYY-MM","to":"YYYY-MM או null","amount":<שינוי בחודש, שלילי/חיובי>,"label":"..."}
אם כתוב "הלוואה"/"תשלומים", פצל לסכום מקדמה (once) + תשלום חודשי (monthly) רק אם יש מספרים. אל תמציא מספרים שלא נאמרו — אם חסר סכום, החזר "question".
ענה רק ב-JSON: {"events":[...],"question":null או "שאלה קצרה","title":"כותרת קצרה לתרחיש"}`;
    const ai = await generateWithFallback({ prompt, text: `התרחיש: ${text}\n\nסיכום נתונים: ${JSON.stringify(summary || {}).slice(0, 6000)}` });
    let j = null;
    try { j = JSON.parse(extractJsonText(ai.output || '')); } catch (_e) { const m = String(ai.output || '').match(/\{[\s\S]*\}/); if (m) { try { j = JSON.parse(m[0]); } catch (_e2) { j = null; } } }
    if (!j) return res.status(502).json({ error: 'AI response could not be parsed' });
    const ym = /^\d{4}-\d{2}$/;
    const events = (Array.isArray(j.events) ? j.events : []).filter((e) => e && Number.isFinite(+e.amount) && +e.amount !== 0 &&
      ((e.type === 'once' && ym.test(e.month)) || (e.type === 'monthly' && ym.test(e.from) && (!e.to || ym.test(e.to)))))
      .slice(0, 10).map((e) => ({ ...e, amount: Math.round(+e.amount), label: String(e.label || '').slice(0, 60) }));
    return res.json({ events, question: j.question ? String(j.question).slice(0, 200) : null, title: String(j.title || text).slice(0, 80) });
  } catch (err) {
    return res.status(err.statusCode || 502).json({ error: err.message || 'Unexpected error' });
  }
});

// ═══ stage 4: advisor memory — pull durable decisions/preferences out of a chat ═══
app.post('/api/ai/extract-memories', requireAuth, aiLimiter, aiQuota, async (req, res) => {
  try {
    const { messages, existing } = req.body || {};
    const convo = (Array.isArray(messages) ? messages : []).filter((m) => m && (m.role === 'user' || m.role === 'ai') && m.text)
      .slice(-20).map((m) => `${m.role === 'user' ? (m.author || 'משתמש') : 'יועץ'}: ${String(m.text).slice(0, 1200)}`).join('\n');
    if (!convo) return res.json({ memories: [] });
    const prompt = `מתוך שיחה עם יועץ פיננסי למשק בית, חלץ רק דברים שכדאי לזכור לשיחות הבאות:
החלטות שבני הזוג קיבלו ("סיכמנו לא לקנות רכב השנה"), העדפות קבועות ("חשוב לנו להפריש מעשרות"), יעדים שהוגדרו, ועובדות יציבות על המשפחה שהם אמרו.
לא: עצות של היועץ שלא אושרו, מספרים שמשתנים כל חודש, רגשות רגעיים, פרטים רפואיים.
כל פריט — משפט קצר בעברית (עד 80 תווים). עד 5 פריטים. אל תחזור על מה שכבר קיים: ${JSON.stringify((existing || []).slice(0, 40))}
ענה רק ב-JSON: {"memories":[{"text":"...","kind":"decision|preference|goal|fact"}]}`;
    const ai = await generateWithFallback({ prompt, text: convo });
    let j = null;
    try { j = JSON.parse(extractJsonText(ai.output || '')); } catch (_e) { j = null; }
    const kinds = ['decision', 'preference', 'goal', 'fact'];
    const memories = (j && Array.isArray(j.memories) ? j.memories : []).filter((m) => m && m.text)
      .map((m) => ({ text: String(m.text).trim().slice(0, 120), kind: kinds.includes(m.kind) ? m.kind : 'decision' })).slice(0, 5);
    return res.json({ memories });
  } catch (err) {
    return res.status(err.statusCode || 502).json({ error: err.message || 'Unexpected error' });
  }
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
    let made = 0;
    const monthNames = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    for (const hid of ids) {
      const [{ data: tx }, { data: cats }, { data: goals }, { data: tasks }, { data: mems }] = await Promise.all([
        supabaseAdmin.from('transactions').select('type,amount,tx_date,category_id').eq('household_id', hid).gte('tx_date', prevMonth + '-01').lt('tx_date', addDaysIso(today, 1)),
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
        await pushHousehold(hid, { title: `📊 הדוח של ${data.monthLabel} מוכן`, body: `נשארו ₪${data.balance.toLocaleString('he-IL')} · 3 המלצות לחודש הבא`, url: APP_URL.replace(/\/$/, '') + '/?tab=dash&report=1' });
      }
    }
    return res.json({ ok: true, month, households: ids.length, created: made });
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
      url: APP_URL
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
app.get('/app/vendor/:file', (req, res) => {
  const rel = APP_VENDOR_FILES[req.params.file];
  if (!rel) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.sendFile(path.join(__dirname, rel));
});

app.use(express.static(PUBLIC_DIR));
// The new app uses hash routes (/app/#/money), so every other GET under /app
// gets its shell.
app.use('/app', (req, res, next) => {
  if (req.method !== 'GET') return next();
  return res.sendFile(path.join(NEW_APP_DIR, 'index.html'));
});
app.get('/app-config.js', (req, res) => {
  res.type('application/javascript');
  res.send(`window.__APP_CONFIG = { API_BASE: '' };`);
});
app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Budget app server listening on http://localhost:${PORT}`);
});
