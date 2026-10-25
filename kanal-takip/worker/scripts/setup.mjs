#!/usr/bin/env node
// Tek komutla kurulum: npm run kurulum
// Cloudflare girişi, D1 veritabanı, tablolar, gizli anahtarlar, yayına alma ve
// sunucu adresinin Xcode projesine yazılması.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

const TOML = new URL('../wrangler.toml', import.meta.url);
const PBX = new URL('../../ios/KanalTakip.xcodeproj/project.pbxproj', import.meta.url);
const STATE = new URL('../.kurulum.json', import.meta.url);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(saved, null, 2));

function wrangler(args, opts = {}) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts });
}
// Çıktıyı hem ekrana basar hem yakalar (wrangler ilk kurulumda soru sorabilir).
function wranglerLive(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], { stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`wrangler ${args[0]} başarısız (${code})`))));
  });
}
function putSecret(name, value) {
  wrangler(['secret', 'put', name], { input: value });
  console.log(`  ✓ ${name}`);
}
async function ask(q, def) {
  const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
  return a || def || '';
}
const step = (n, t) => console.log(`\n━━ ${n}. ${t}`);

step(1, 'Cloudflare hesabı');
const who = spawnSync('npx', ['wrangler', 'whoami'], { encoding: 'utf8' });
if (/not authenticated/i.test(who.stdout + who.stderr)) {
  console.log('Tarayıcı açılacak, Cloudflare hesabınla giriş yap.');
  spawnSync('npx', ['wrangler', 'login'], { stdio: 'inherit' });
} else console.log('  ✓ Giriş yapılmış');

step(2, 'Veritabanı (D1)');
let toml = readFileSync(TOML, 'utf8');
if (toml.includes('D1_ID_BURAYA')) {
  const out = wrangler(['d1', 'create', 'kanal-takip']);
  const id = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0];
  if (!id) throw new Error(`D1 oluşturulamadı:\n${out}`);
  toml = toml.replace('D1_ID_BURAYA', id);
  writeFileSync(TOML, toml);
  console.log(`  ✓ Oluşturuldu (${id})`);
} else console.log('  ✓ Zaten var');
await wranglerLive(['d1', 'migrations', 'apply', 'kanal-takip', '--remote']);

step(3, 'Yayına alma');
const deployOut = await wranglerLive(['deploy']);
const url = deployOut.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
if (!url) throw new Error(`Adres bulunamadı:\n${deployOut}`);
saved.url = url;
save();
console.log(`  ✓ ${url}`);

step(4, 'Gizli anahtarlar (boş bırakırsan değiştirilmez)');
const ytKey = await ask('YouTube API anahtarı');
if (ytKey) putSecret('YT_API_KEY', ytKey);
const p8 = await ask('Apple .p8 dosyasının yolu (Terminal\'e sürükle)');
if (p8) {
  const path = p8.replace(/^['"]|['"]$/g, '').replace(/\\ /g, ' ');
  putSecret('APNS_KEY', readFileSync(path, 'utf8'));
  putSecret('APNS_KEY_ID', await ask('Key ID (10 karakter)', path.match(/AuthKey_(\w{10})/)?.[1]));
  saved.teamId = await ask('Team ID (10 karakter)', saved.teamId);
  putSecret('APNS_TEAM_ID', saved.teamId);
  saved.bundleId = await ask('Bundle ID', saved.bundleId || 'com.alperen15820.kanaltakip');
  putSecret('APNS_TOPIC', saved.bundleId);
  save();
}
rl.close();

step(5, 'Xcode projesi');
let pbx = readFileSync(PBX, 'utf8');
pbx = pbx.replace(/API_BASE_URL = "[^"]*";/g, `API_BASE_URL = "${url}";`);
if (saved.bundleId) pbx = pbx.replace(/BUNDLE_ID_PREFIX = [^;]+;/g, `BUNDLE_ID_PREFIX = ${saved.bundleId};`);
writeFileSync(PBX, pbx);
console.log(`  ✓ Uygulama artık ${url} adresini kullanıyor`);

console.log('\nBitti. Xcode\'da projeyi aç (açıksa kapatıp yeniden aç) ve ▶︎ Run de.');
