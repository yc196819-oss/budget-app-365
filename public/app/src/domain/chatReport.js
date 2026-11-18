// The conversation report as plain text, for copying and WhatsApp.
const shekel = (v) => '₪' + Math.round(v).toLocaleString('he-IL');

export function reportText({ title, when, report, changes = [] }) {
  const r = report || {};
  const lines = ['דוח על השיחה: ' + title, when, '', 'בקצרה', r.summary || ''];
  const part = (head, items) => { if (items && items.length) lines.push('', head, ...items.map((x) => '• ' + x)); };
  part('מה החלטתם', r.decisions);
  part('מה נשאר לעשות', r.tasks);
  part('סכומים שעלו בשיחה', (r.amounts || []).map((a) => a.label + ': ' + shekel(a.amount)));
  part('מה עודכן באפליקציה', changes);
  return lines.join('\n').trim();
}

// What the report is made from: the conversation's questions and answers
// (not a question that was stopped, and not quick answers from the guide).
export function reportMessages(messages, memberName) {
  return (messages || []).filter((m) => (m.role === 'user' || m.role === 'ai') && !m.local && !m.pending && !m.stopped && m.text)
    .map((m) => ({ role: m.role, text: m.text, author: m.role === 'user' ? memberName(m.author_id) : undefined }));
}
