import { api } from '../lib/api.js';
import { CONFIG } from '../config.js';

// Payment notifications sent from the phone (server/capture.js). All of it
// goes through our server: the database tables are closed to the browser.
export const captureStatus = (hid) => api('/api/capture/status?householdId=' + encodeURIComponent(hid));
export const newCaptureKey = (hid) => api('/api/capture/key', { method: 'POST', body: { householdId: hid } }).then((r) => r.key);
export const stopCaptureKey = (hid) => api('/api/capture/key', { method: 'DELETE', body: { householdId: hid } });
export const captureUrl = () => (CONFIG.apiBase || location.origin) + '/api/capture/wallet';
