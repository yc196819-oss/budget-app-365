import { render } from 'preact';
import { html } from './lib/html.js';
import { readLocal } from './lib/storage.js';
import { App } from './app/App.js';
import { applyTheme } from './app/Shell.js';

applyTheme(readLocal('theme', ''));
render(html`<${App} />`, document.getElementById('root'));
