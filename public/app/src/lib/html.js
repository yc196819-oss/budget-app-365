import { h } from 'preact';
import htm from 'htm';

// JSX-like templates without a build step: html`<div class=${x}>...</div>`
export const html = htm.bind(h);
