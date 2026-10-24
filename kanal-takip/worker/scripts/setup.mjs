#!/usr/bin/env node
// Tek komutla kurulum: npm run kurulum
// Cloudflare'e giriş, KV oluşturma, gizli anahtarlar, yayına alma ve iPhone için QR kod.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import qrcode from 'qrcode-terminal';

const TOML = new URL('../wrangler.toml', import.meta.url);
const STATE = new URL('../.kurulum.json', import.meta.url);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const saved = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const save = () => writeFileSync(STATE, JSON.stringify(saved, null, 2));

function wrangler(args, opts = {}) {
  return execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...opts });
}
// Çıktıyı hem ekrana basar hem yakalar (ilk kurulumda wrangler soru sorabilir).
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
  console.log('Tarayıcı açılacak, Cloudflare hesabınla giriş yap (yoksa ücretsiz oluştur).');
  spawnSync('npx', ['wrangler', 'login'], { stdio: 'inherit' });
} else console.log('  ✓ Giriş yapılmış');

step(2, 'Veri deposu (KV)');
let toml = readFileSync(TOML, 'utf8');
if (toml.includes('KV_ID_BURAYA')) {
  const out = wrangler(['kv', 'namespace', 'create', 'KV']);
  const id = out.match(/[0-9a-f]{32}/)?.[0];
  if (!id) throw new Error(`KV oluşturulamadı:\n${out}`);
  toml = toml.replace('KV_ID_BURAYA', id);
  writeFileSync(TOML, toml);
  console.log(`  ✓ Oluşturuldu (${id})`);
} else console.log('  ✓ Zaten var');

step(3, 'Yayına alma');
const deployOut = await wranglerLive(['deploy']);
const url = deployOut.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
if (!url) throw new Error(`Adres bulunamadı:\n${deployOut}`);
saved.url = url;
save();
console.log(`  ✓ ${url}`);

step(4, 'Gizli anahtarlar');
saved.secret ||= randomBytes(24).toString('hex');
save();
putSecret('APP_SECRET', saved.secret);

const ytKey = await ask('YouTube API anahtarı (boş bırak = değiştirme)');
if (ytKey) putSecret('YT_API_KEY', ytKey);

console.log('\nApple push bildirimi için (developer.apple.com → Keys → APNs anahtarı):');
const p8 = await ask('.p8 dosyasının yolu (boş bırak = değiştirme)');
if (p8) {
  putSecret('APNS_KEY', readFileSync(p8.replace(/^['"]|['"]$/g, ''), 'utf8'));
  const keyId = await ask('Key ID (10 karakter)', p8.match(/AuthKey_(\w{10})/)?.[1]);
  putSecret('APNS_KEY_ID', keyId);
  putSecret('APNS_TEAM_ID', await ask('Team ID (10 karakter)', saved.teamId));
  saved.bundleId = await ask('Uygulama Bundle ID', saved.bundleId || 'com.alperen15820.kanaltakip');
  putSecret('APNS_TOPIC', saved.bundleId);
  save();
}
rl.close();

step(5, 'iPhone bağlantısı');
const link = `kanaltakip://kurulum?url=${encodeURIComponent(url)}&secret=${saved.secret}`;
console.log('Uygulamayı telefona yükledikten sonra iPhone kamerasıyla bu QR kodu okut:\n');
qrcode.generate(link, { small: true });
console.log(`\nYa da uygulamada elle gir:\n  Sunucu: ${url}\n  Anahtar: ${saved.secret}\n`);
console.log('Bu bilgiler kanal-takip/worker/.kurulum.json dosyasında saklandı (paylaşma).');
