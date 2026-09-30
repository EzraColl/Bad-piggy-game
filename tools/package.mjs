// After `vite build`: copies the single-file game to PigRig3D.html (double-click to play) and
// writes dist/embed.html, a version without the <html>/<head>/<body> wrapper for embedding hosts
// that supply their own document skeleton.

import fs from 'fs';

const src = 'dist/index.html';
const html = fs.readFileSync(src, 'utf8');
fs.copyFileSync(src, 'PigRig3D.html');

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const links = head.match(/<link[^>]+fonts[^>]*>/g) ?? [];
const styles = head.match(/<style[\s\S]*?<\/style>/g) ?? [];
const scripts = head.match(/<script[\s\S]*?<\/script>/g) ?? [];
const embed = [title, ...links, ...styles, body.trim(), ...scripts].join('\n');
fs.writeFileSync('dist/embed.html', embed);

const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(`PigRig3D.html   ${mb(html.length)}`);
console.log(`dist/embed.html ${mb(embed.length)}`);
