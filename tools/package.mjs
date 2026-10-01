// After `vite build`:
// - copies the single-file game to PigRig3D.html (double-click to play)
// - writes docs/index.html, the website version served by GitHub Pages: the same game plus links to
//   the home-screen icon, the web app manifest and the offline service worker that live in docs/
// - writes dist/embed.html, a version without the <html>/<head>/<body> wrapper for embedding hosts
//   that supply their own document skeleton.

import fs from 'fs';

const src = 'dist/index.html';
const html = fs.readFileSync(src, 'utf8');
fs.copyFileSync(src, 'PigRig3D.html');

const webLinks = [
  '<link rel="manifest" href="manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="icon-180.png" />',
  '<link rel="icon" type="image/png" href="icon-192.png" />',
].join('\n    ');
const site = html.replace(/<\/title>/, `</title>\n    ${webLinks}`);
if (site === html) throw new Error('could not find </title> in the build');
fs.writeFileSync('docs/index.html', site);

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
console.log(`docs/index.html ${mb(site.length)}`);
console.log(`dist/embed.html ${mb(embed.length)}`);
