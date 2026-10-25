// Apple Push Notification service (token tabanlı, .p8 anahtarı ile).
const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};

let cachedJwt = null; // { token, exp, keyId }

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

function pemToDer(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

async function providerToken(env) {
  const now = Math.floor(Date.now() / 1000);
  // Apple token'ı 20–60 dakikada bir yenilemeyi istiyor.
  if (cachedJwt && cachedJwt.keyId === env.APNS_KEY_ID && now - cachedJwt.iat < 45 * 60) return cachedJwt.token;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(env.APNS_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const unsigned = `${b64urlJson({ alg: 'ES256', kid: env.APNS_KEY_ID })}.${b64urlJson({ iss: env.APNS_TEAM_ID, iat: now })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  cachedJwt = { token: `${unsigned}.${b64url(sig)}`, iat: now, keyId: env.APNS_KEY_ID };
  return cachedJwt.token;
}

export function apnsConfigured(env) {
  return Boolean(env.APNS_KEY && env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_TOPIC);
}

async function sendOne(env, device, payload, opts, host) {
  return fetch(`${HOSTS[host]}/3/device/${device.token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${await providerToken(env)}`,
      'apns-topic': env.APNS_TOPIC,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      ...(opts.collapseId ? { 'apns-collapse-id': opts.collapseId.slice(0, 64) } : {}),
    },
    body: JSON.stringify(payload),
  });
}

// Tüm cihazlara gönderir. Geçersiz token'ları ayıklar, yanlış ortamda kayıtlı
// cihazları (Xcode = sandbox, TestFlight/App Store = production) otomatik düzeltir.
// Dönen değer: değişiklik varsa { keep, moved }, yoksa null.
export async function pushAll(env, devices, payload, opts = {}) {
  if (!apnsConfigured(env) || !devices.length) return null;
  let changed = false;
  const keep = [];
  const moved = [];
  for (const device of devices) {
    const host = device.env === 'production' ? 'production' : 'sandbox';
    let res = await sendOne(env, device, payload, opts, host);
    let reason = res.ok ? null : (await res.json().catch(() => ({}))).reason;
    if (reason === 'BadDeviceToken' || reason === 'BadEnvironmentKeyInToken') {
      const other = host === 'production' ? 'sandbox' : 'production';
      res = await sendOne(env, device, payload, opts, other);
      reason = res.ok ? null : (await res.json().catch(() => ({}))).reason;
      if (res.ok) {
        device.env = other;
        moved.push(device);
        changed = true;
      }
    }
    if (res.status === 410 || reason === 'Unregistered' || reason === 'BadDeviceToken') {
      changed = true;
      console.warn(`Cihaz kaldırıldı (${reason || res.status})`);
      continue;
    }
    if (!res.ok) console.warn(`APNs hatası ${res.status}: ${reason}`);
    keep.push(device);
  }
  return changed ? { keep, moved } : null;
}
