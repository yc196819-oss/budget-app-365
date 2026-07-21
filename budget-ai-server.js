require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GROK_KEY = process.env.GROK_API_KEY || process.env.XAI_API_KEY || '';
const GROK_MODEL = process.env.GROK_MODEL || 'grok-2-latest';
const GROK_BASE_URL = process.env.GROK_BASE_URL || 'https://api.x.ai/v1';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || '';
const GOOGLE_OAUTH_SCOPES = String(
  process.env.GOOGLE_OAUTH_SCOPES || 'openid,email,https://www.googleapis.com/auth/gmail.send'
).split(',').map((s) => s.trim()).filter(Boolean);
const PORT = process.env.PORT || 8787;
const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5500/budget-final%20(2).html';
const ALLOW_DEV_RESET_FALLBACK = String(
  process.env.ALLOW_DEV_RESET_FALLBACK || (process.env.NODE_ENV !== 'production' ? 'true' : 'false')
) === 'true';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/rest\/v1\/?$/i, '')
  .replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false') === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || '';

const DEFAULT_CATEGORIES = [
  { name: 'אוכל', icon: '🍽️', kind: 'expense', subs: ['סופר', 'מסעדות ואוכל בחוץ'] },
  { name: 'רכב', icon: '🚗', kind: 'expense', subs: ['דלק', 'אגרה', 'מוסך', 'ביטוח רכב'] },
  { name: 'בית ודיור', icon: '🏠', kind: 'expense', subs: ['שכירות / משכנתא', 'חשבונות', 'ריהוט ותחזוקה'] },
  { name: 'בריאות', icon: '💊', kind: 'expense', subs: ['רופאים', 'תרופות', 'ביטוח בריאות'] },
  { name: 'פנאי ובידור', icon: '🎭', kind: 'expense', subs: ['ספורט', 'תרבות', 'נסיעות'] },
  { name: 'שונות', icon: '📦', kind: 'expense', subs: [] },
  { name: 'משכורת', icon: '💼', kind: 'income', subs: [] },
  { name: 'עזרה מההורים', icon: '👨‍👩‍👧', kind: 'income', subs: [] },
  { name: 'עבודה צדדית / פרילנס', icon: '💻', kind: 'income', subs: [] },
  { name: 'החזרים והטבות', icon: '🧾', kind: 'income', subs: [] },
  { name: 'רווחי השקעות', icon: '📈', kind: 'income', subs: [] },
  { name: 'מתנות', icon: '🎁', kind: 'income', subs: [] },
  { name: 'הכנסה אחרת', icon: '💰', kind: 'income', subs: [] }
];

const mailer = SMTP_HOST && SMTP_USER && SMTP_PASS
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
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
  if (GEMINI_KEY) providers.push('gemini');
  if (GROK_KEY) providers.push('grok');
  return providers;
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

async function generateWithFallback(payload) {
  const attempted = [];

  if (GEMINI_KEY) {
    try {
      const result = await callGemini(payload);
      return { ...result, attempted };
    } catch (err) {
      attempted.push({ provider: 'gemini', error: err.message || 'Unknown Gemini error' });
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

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeState(state) {
  return JSON.parse(Buffer.from(String(state || ''), 'base64url').toString('utf8'));
}

function safeAppUrl(inputUrl) {
  const fallback = APP_URL;
  try {
    const u = new URL(String(inputUrl || '').trim());
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    return fallback;
  } catch (_err) {
    return fallback;
  }
}

function withQuery(url, params) {
  const u = new URL(safeAppUrl(url));
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') u.searchParams.set(k, String(v));
  });
  return u.toString();
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

async function upsertGoogleMailSettings({ userId, householdId, patch }) {
  if (!supabaseAdmin) throw new Error('Supabase server credentials are not configured');
  const existing = await getUserSettings(userId);
  const existingIntegrations = existing?.integrations && typeof existing.integrations === 'object' ? existing.integrations : {};
  const currentGoogle = existingIntegrations.googleMail && typeof existingIntegrations.googleMail === 'object'
    ? existingIntegrations.googleMail
    : {};

  const merged = {
    ...existingIntegrations,
    googleMail: {
      ...currentGoogle,
      ...patch
    }
  };

  const payload = {
    user_id: userId,
    household_id: householdId || existing?.household_id || null,
    reminders: existing?.reminders && typeof existing.reminders === 'object' ? existing.reminders : {},
    integrations: merged,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseAdmin
    .from('user_settings')
    .upsert(payload, { onConflict: 'user_id' });

  if (error) throw new Error(error.message || 'Failed to save Google integration');
  return merged.googleMail;
}

async function ensureDefaultCategoriesForHousehold(householdId) {
  if (!supabaseAdmin) throw new Error('Supabase server credentials are not configured');
  const hid = String(householdId || '').trim();
  if (!hid) throw new Error('householdId is required');

  const { data: current, error: readError } = await supabaseAdmin
    .from('categories')
    .select('id,name,parent_id,kind,icon')
    .eq('household_id', hid);

  if (readError) throw new Error(readError.message || 'Failed to read categories');
  const all = Array.isArray(current) ? current : [];
  const roots = all.filter((c) => !c.parent_id);
  if (roots.length > 0) return all;

  for (const cat of DEFAULT_CATEGORIES) {
    const { data: root, error: rootError } = await supabaseAdmin
      .from('categories')
      .insert({
        household_id: hid,
        name: cat.name,
        icon: cat.icon,
        kind: cat.kind
      })
      .select('id,name,parent_id,kind,icon')
      .single();

    if (rootError) throw new Error(rootError.message || `Failed to insert root category ${cat.name}`);

    for (const subName of cat.subs) {
      const { error: subError } = await supabaseAdmin
        .from('categories')
        .insert({
          household_id: hid,
          name: subName,
          parent_id: root.id,
          kind: cat.kind
        });
      if (subError) throw new Error(subError.message || `Failed to insert subcategory ${subName}`);
    }
  }

  const { data: rebuilt, error: rebuiltError } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('household_id', hid);
  if (rebuiltError) throw new Error(rebuiltError.message || 'Failed to fetch rebuilt categories');
  return rebuilt || [];
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

async function sendMailWithFallback({ userId, to, subject, html, text }) {
  const errors = [];

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

function sixDigitCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

async function sendResetEmail({ email, code, userId }) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px">
      <h2 style="margin:0 0 10px">קוד איפוס מערכת</h2>
      <p style="margin:0 0 12px">התקבלה בקשה לאיפוס מלא של נתוני התקציב.</p>
      <p style="margin:0 0 12px">קוד האימות שלך:</p>
      <div style="font-size:34px;font-weight:700;letter-spacing:6px;background:#f2f5ff;padding:14px 18px;border-radius:10px;display:inline-block">${code}</div>
      <p style="margin:16px 0 0;color:#555">הקוד תקף ל-15 דקות. אם לא ביקשת איפוס, אפשר להתעלם מהמייל.</p>
      <p style="margin:10px 0 0"><a href="${APP_URL}">מעבר למערכת</a></p>
    </div>
  `;

  return sendMailWithFallback({
    userId,
    to: email,
    subject: 'קוד איפוס למערכת התקציב',
    text: `קוד איפוס למערכת התקציב: ${code}`,
    html
  });
}

app.post('/api/google/connect-url', async (req, res) => {
  try {
    if (!isGoogleOAuthConfigured()) {
      return res.status(503).json({ error: 'Google OAuth is not configured on server' });
    }

    const { userId, householdId, returnTo } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const state = encodeState({
      userId: String(userId),
      householdId: String(householdId || ''),
      returnTo: safeAppUrl(returnTo || APP_URL),
      ts: Date.now()
    });

    const oauthClient = getGoogleOAuthClient();
    const authUrl = oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: GOOGLE_OAUTH_SCOPES,
      state
    });

    return res.json({ ok: true, authUrl });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

app.get('/api/google/callback', async (req, res) => {
  const fallbackRedirect = APP_URL;
  try {
    if (!isGoogleOAuthConfigured()) {
      return res.redirect(withQuery(fallbackRedirect, { google_mail: 'error', google_msg: 'Google OAuth is not configured on server' }));
    }

    const { code, state, error } = req.query || {};
    const stateData = decodeState(state);
    const redirectTarget = safeAppUrl(stateData?.returnTo || fallbackRedirect);

    if (error) {
      return res.redirect(withQuery(redirectTarget, { google_mail: 'error', google_msg: String(error) }));
    }
    if (!code || !stateData?.userId) {
      return res.redirect(withQuery(redirectTarget, { google_mail: 'error', google_msg: 'Missing code or state' }));
    }

    const oauthClient = getGoogleOAuthClient();
    const tokenResult = await oauthClient.getToken(String(code));
    const tokens = tokenResult?.tokens || {};
    oauthClient.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
    const me = await oauth2.userinfo.get();
    const googleEmail = normalizeEmail(me?.data?.email || '');

    const existing = await getUserSettings(stateData.userId);
    const prevRefresh = existing?.integrations?.googleMail?.refreshToken || '';
    const refreshToken = tokens.refresh_token || prevRefresh;
    if (!refreshToken) {
      return res.redirect(withQuery(redirectTarget, {
        google_mail: 'error',
        google_msg: 'Google did not return a refresh token. Revoke access and connect again.'
      }));
    }

    await upsertGoogleMailSettings({
      userId: stateData.userId,
      householdId: stateData.householdId,
      patch: {
        connected: true,
        provider: 'google',
        email: googleEmail,
        refreshToken,
        accessToken: tokens.access_token || existing?.integrations?.googleMail?.accessToken || '',
        expiryDate: tokens.expiry_date || null,
        scope: tokens.scope || '',
        connectedAt: new Date().toISOString()
      }
    });

    return res.redirect(withQuery(redirectTarget, {
      google_mail: 'connected',
      google_email: googleEmail
    }));
  } catch (err) {
    return res.redirect(withQuery(fallbackRedirect, {
      google_mail: 'error',
      google_msg: err.message || 'Google connect failed'
    }));
  }
});

app.post('/api/google/disconnect', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Supabase server credentials are not configured' });
    }
    const { userId, householdId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    await upsertGoogleMailSettings({
      userId: String(userId),
      householdId: String(householdId || ''),
      patch: {
        connected: false,
        disconnectedAt: new Date().toISOString(),
        refreshToken: '',
        accessToken: '',
        expiryDate: null,
        scope: ''
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

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
    devResetFallback: ALLOW_DEV_RESET_FALLBACK
  });
});

app.post('/api/ai/import', async (req, res) => {
  try {
    if (!GEMINI_KEY && !GROK_KEY) {
      return res.status(503).json({ error: 'No AI key configured. Set GEMINI_API_KEY and/or GROK_API_KEY' });
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

app.post('/api/chat/parse', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });

    if (!GEMINI_KEY && !GROK_KEY) {
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

app.post('/api/reminders/test', async (req, res) => {
  const { channel, email, appLink, userId, householdId, integrations } = req.body || {};
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
      const mergedIntegrations = await resolveIntegrationsForChannelTest({ userId, householdId, integrations });
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
      const mergedIntegrations = await resolveIntegrationsForChannelTest({ userId, householdId, integrations });
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

app.post('/api/channels/test', async (req, res) => {
  try {
    const {
      channel = 'all',
      userId,
      householdId,
      integrations,
      message
    } = req.body || {};

    const selected = String(channel || 'all').trim().toLowerCase();
    const wantsGoogleChat = selected === 'all' || selected === 'google_chat';
    const wantsWhatsapp = selected === 'all' || selected === 'whatsapp';

    if (!wantsGoogleChat && !wantsWhatsapp) {
      return res.status(400).json({ ok: false, error: 'Invalid channel. Use all, google_chat, or whatsapp.' });
    }

    const mergedIntegrations = await resolveIntegrationsForChannelTest({ userId, householdId, integrations });
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

app.get('/api/user/household/:userId', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Supabase server credentials are not configured' });
    }
    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('memberships')
      .select('household_id')
      .eq('user_id', userId)
      .limit(1)
      .single();

    if (error || !data?.household_id) {
      return res.status(404).json({ error: error?.message || 'No household found for user' });
    }

    return res.json({ ok: true, householdId: data.household_id, userId });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

app.post('/api/categories/bootstrap', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ ok: false, error: 'Supabase server credentials are not configured' });
    }

    const { householdId, userId } = req.body || {};
    const hid = String(householdId || '').trim();
    const uid = String(userId || '').trim();
    if (!hid || !uid) {
      return res.status(400).json({ ok: false, error: 'householdId and userId are required' });
    }

    const { data: membership, error: membershipError } = await supabaseAdmin
      .from('memberships')
      .select('user_id')
      .eq('household_id', hid)
      .eq('user_id', uid)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      return res.status(500).json({ ok: false, error: membershipError.message || 'Failed membership check' });
    }
    if (!membership?.user_id) {
      return res.status(403).json({ ok: false, error: 'User is not a member of this household' });
    }

    const categories = await ensureDefaultCategoriesForHousehold(hid);
    return res.json({ ok: true, categories, count: categories.length });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Unexpected error' });
  }
});

app.post('/api/import/commit', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Supabase server credentials are not configured' });
    }

    const { householdId, userId, transactions } = req.body || {};
    if (!householdId || !userId || !Array.isArray(transactions) || !transactions.length) {
      return res.status(400).json({ error: 'householdId, userId and non-empty transactions are required' });
    }

    const rows = transactions
      .map((t) => ({
        household_id: householdId,
        created_by: userId,
        type: t?.type === 'income' ? 'income' : 'expense',
        description: String(t?.description || 'ייבוא'),
        amount: Math.abs(Number(t?.amount) || 0),
        tx_date: String(t?.date || new Date().toISOString().slice(0, 10)),
        category_id: t?.category_id || null,
        subcategory_id: t?.subcategory_id || null,
        nature: 'variable',
        spread: 'month',
        source: 'ai-file',
        account_id: t?.account_id || null,
        card_id: t?.card_id || null,
        payment_method: t?.card_id ? 'credit' : 'other'
      }))
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

app.post('/api/reset/request', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Supabase server credentials are not configured' });
    }

    const { householdId, userId, email } = req.body || {};
    if (!householdId || !userId || !email) {
      return res.status(400).json({ error: 'householdId, userId and email are required' });
    }

    const code = sixDigitCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const normalized = normalizeEmail(email);

    const { error: insertError } = await supabaseAdmin
      .from('household_reset_codes')
      .insert({
        household_id: householdId,
        user_id: userId,
        email: normalized,
        code,
        expires_at: expiresAt,
        used: false
      });

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    try {
      const sent = await sendResetEmail({ email: normalized, code, userId });
      return res.json({ ok: true, expiresAt, sent: true, provider: sent.provider });
    } catch (emailErr) {
      if (!ALLOW_DEV_RESET_FALLBACK) {
        return res.status(500).json({ error: emailErr.message || 'Failed to send reset email' });
      }

      console.warn('Reset email delivery failed, returning dev fallback code:', emailErr.message || emailErr);
      return res.json({
        ok: true,
        expiresAt,
        sent: false,
        fallback: 'manual_code',
        devCode: code,
        message: 'Email delivery is blocked by provider test-mode. Use devCode to continue reset flow.'
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

app.post('/api/reset/confirm', async (req, res) => {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Supabase server credentials are not configured' });
    }

    const { householdId, userId, code } = req.body || {};
    if (!householdId || !userId || !code) {
      return res.status(400).json({ error: 'householdId, userId and code are required' });
    }

    const { data: resetRow, error: resetError } = await supabaseAdmin
      .from('household_reset_codes')
      .select('*')
      .eq('household_id', householdId)
      .eq('user_id', userId)
      .eq('code', String(code).trim())
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (resetError) {
      return res.status(500).json({ error: resetError.message });
    }

    if (!resetRow) {
      return res.status(400).json({ error: 'Invalid or expired reset code' });
    }

    const { error: markUsedError } = await supabaseAdmin
      .from('household_reset_codes')
      .update({ used: true })
      .eq('id', resetRow.id);

    if (markUsedError) {
      return res.status(500).json({ error: markUsedError.message });
    }

    const tables = ['transactions', 'installments', 'loans', 'investments', 'goals', 'categories'];
    for (const table of tables) {
      const { error: delError } = await supabaseAdmin
        .from(table)
        .delete()
        .eq('household_id', householdId);
      if (delError) {
        return res.status(500).json({ error: `Failed to delete from ${table}: ${delError.message}` });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

app.listen(PORT, () => {
  console.log(`Budget AI server listening on http://localhost:${PORT}`);
});
