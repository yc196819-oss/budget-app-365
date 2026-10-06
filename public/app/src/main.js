import { render } from 'preact';
import { html } from './lib/html.js';
import { readLocal } from './lib/storage.js';
import { App } from './app/App.js';
import { applyTheme } from './app/Shell.js';
import { registerWorker } from './lib/push.js';
import { showToast } from './lib/toast.js';
// Loaded at startup: the browser's install offer comes once, early.
import './lib/install.js';

applyTheme(readLocal('theme', ''));
render(html`<${App} />`, document.getElementById('root'));
registerWorker(() => showToast('גרסה חדשה של האפליקציה מוכנה', { undo: () => location.reload(), label: 'לרענן', ms: 15000 }));
