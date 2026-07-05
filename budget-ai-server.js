require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function sixDigitCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

async function sendResetEmail(email, code) {
  if (!mailer) {
    throw new Error('SMTP is not configured on server');
  }

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

  await mailer.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'קוד איפוס למערכת התקציב',
    html
  });
}

app.get('/api/health', async (_req, res) => {
  return res.json({
    ok: true,
    aiConfigured: !!GEMINI_KEY,
    geminiModel: GEMINI_MODEL,
    supabaseConfigured: !!supabaseAdmin,
    smtpConfigured: !!mailer,
    devResetFallback: ALLOW_DEV_RESET_FALLBACK
  });
});

app.post('/api/ai/import', async (req, res) => {
  try {
    if (!GEMINI_KEY) {
      return res.status(503).json({ error: 'GEMINI_API_KEY is not configured on server' });
    }

    const { prompt, text, fileData, mimeType } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (!text && !fileData) {
      return res.status(400).json({ error: 'text or fileData is required' });
    }

    const parts = [{ text: `${prompt}\n\n${String(text || '').slice(0, 12000)}` }];
    if (fileData) {
      const normalizedMime = String(mimeType || '').toLowerCase().trim().replace('image/jpg', 'image/jpeg');
      const supportedImage = /^(image\/png|image\/jpeg|image\/webp)$/.test(normalizedMime);
      if (!supportedImage) {
        return res.status(400).json({ error: 'Unsupported image mimeType. Use PNG/JPEG/WEBP.' });
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
      return res.status(502).json({ error: data.error?.message || 'AI provider error' });
    }

    const output = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
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

    return res.json({ transactions: parsed, output: JSON.stringify(parsed), rawOutput: output });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

app.post('/api/chat/parse', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'text is required' });

    if (!GEMINI_KEY) {
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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1 } })
      }
    );

    const data = await response.json();
    if (!response.ok || data.error) {
      return res.status(502).json({ error: data.error?.message || 'AI provider error' });
    }

    const output = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return res.json(JSON.parse(extractJsonText(output)));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

app.post('/api/reminders/test', async (req, res) => {
  const { channel, email, appLink } = req.body || {};
  const msg = `תזכורת ניסיון: אל תשכח לעדכן הוצאות והכנסות היום. ${appLink || ''}`.trim();
  if ((channel || 'email') === 'email' && email && mailer) {
    try {
      await mailer.sendMail({
        from: SMTP_FROM,
        to: email,
        subject: 'תזכורת ניסיון - מערכת התקציב',
        text: msg
      });
      return res.json({ ok: true, channel: 'email', sent: true, message: msg });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
  return res.json({ ok: true, channel: channel || 'email', sent: false, email: email || null, message: msg });
});

app.post('/api/channels/test', async (req, res) => {
  return res.json({ ok: true, message: 'Channel test accepted', payload: req.body || {} });
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
        source: 'ai-file'
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
      await sendResetEmail(normalized, code);
      return res.json({ ok: true, expiresAt, sent: true });
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
