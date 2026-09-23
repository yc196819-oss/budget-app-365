require('dotenv').config();
const express = require('express');
const path = require('path');
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

app.post('/api/ai/import', requireAuth, aiLimiter, async (req, res) => {
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

app.post('/api/ai/advice', requireAuth, aiLimiter, async (req, res) => {
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

app.post('/api/ai/advice-chat', requireAuth, aiLimiter, async (req, res) => {
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

app.post('/api/ai/onboarding', requireAuth, aiLimiter, async (req, res) => {
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

app.post('/api/chat/parse', requireAuth, aiLimiter, async (req, res) => {
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
app.use(express.static(PUBLIC_DIR));
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
