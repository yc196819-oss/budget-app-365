import { api } from '../lib/api.js';

// The owner's shopping links (one person each, no account needed).
export const listGuestLinks = () => api('/api/admin/guest-links');
export const makeGuestLink = (label) => api('/api/admin/guest-links', { method: 'POST', body: { label } });
export const cancelGuestLink = (id) => api('/api/admin/guest-links/' + encodeURIComponent(id), { method: 'DELETE' });
export const guestUrl = (token) => location.origin + '/app/#/guest/' + token;
