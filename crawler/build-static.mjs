#!/usr/bin/env node
// Wrap site/index.html (authored as an Artifact page body) in a full document for static hosting
// (GitHub Pages, local preview). Output: dist/index.html, dist/events.json, dist/learned.json
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = await readFile(join(ROOT, 'site', 'index.html'), 'utf8');
const head = [];
const body = page.replace(/<(title|meta|link)\b[^>]*>(?:[^<]*<\/title>)?\s*/g, (m) => (head.push(m.trim()), ''));
const description = head.join(' ').match(/name="description" content="([^"]+)"/)?.[1] || '';
// The wristband mark as a favicon.
const icon = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#13151a"/><rect x="8" y="22" width="48" height="20" rx="10" fill="#ff8b0f"/><circle cx="19" cy="32" r="5" fill="#13151a"/></svg>'
)}`;
const doc = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
${head.join('\n')}
<meta property="og:title" content="Wristband">
<meta property="og:description" content="${description}">
<meta name="theme-color" content="#eceef2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1014" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-title" content="Wristband">
<link rel="icon" href="${icon}">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
await mkdir(join(ROOT, 'dist'), { recursive: true });
await writeFile(join(ROOT, 'dist', 'index.html'), doc);
await copyFile(join(ROOT, 'site', 'events.json'), join(ROOT, 'dist', 'events.json'));
await copyFile(join(ROOT, 'data', 'learned.json'), join(ROOT, 'dist', 'learned.json'));
console.log('dist/ ready');
