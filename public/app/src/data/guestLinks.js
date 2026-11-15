import { api } from '../lib/api.js';

// The owner's shopping links (one person each, no account needed).
export const listGuestLinks = () => api('/api/admin/guest-links');
// home: the same list as the household open in the app (for a partner); otherwise a test link with a list of its own.
export const makeGuestLink = (label, home = false, hid = null) => api('/api/admin/guest-links', { method: 'POST', body: { label, home, hid } });
export const cancelGuestLink = (id) => api('/api/admin/guest-links/' + encodeURIComponent(id), { method: 'DELETE' });
export const guestUrl = (token) => location.origin + '/app/#/guest/' + token;
