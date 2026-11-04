import { html } from '../../lib/html.js';
import { useFeedbackUnread } from '../../data/feedback.js';
import { go } from '../../lib/go.js';

// "There is an answer to your request": shown on the home screen until the
// answer is opened.
export function AnswerNotice({ userId }) {
  const n = useFeedbackUnread(userId);
  if (!n) return null;
  return html`<div class="card answer-notice" role="status">
    <span class="fb-live" aria-hidden="true"></span>
    <span style="flex:1">${n === 1 ? 'יש תשובה לפנייה שלך' : 'יש ' + n + ' תשובות לפניות שלך'}</span>
    <button type="button" class="btn-text" onClick=${() => go('profile/feedback')}>לקרוא</button>
  </div>`;
}
