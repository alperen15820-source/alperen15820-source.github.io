# Kanal Takip

YouTube kanallarını takip eden, sıçramalarda ve abone hedeflerinde bildirim gönderen iPhone uygulaması. Herkese açık: App Store'dan indiren her kullanıcı kendi kanallarını (en fazla 5) ekler.

- Video sıçraması, izlenme patlaması, abone yağması, yeni video ve abone hedefi bildirimleri (1000 aboneye özel kutlama)
- Sabah özeti: belli bir saati yok, alarm kapanınca gelir (Kısayollar otomasyonu)
- Kilit ekranı ve ana ekran widget'ı
- Apple Watch uygulaması ve kadran komplikasyonları
- Türkçe + İngilizce, siyah-beyaz tasarım
- Giriş yok (anonim hesap), uygulama içinden "Verilerimi sil"

```
kanal-takip/
├── worker/      → Cloudflare sunucusu (Workers + D1): kanalları yoklar, push gönderir
├── ios/         → Xcode projesi (SwiftUI + widget + Kısayollar eylemi)
└── APPSTORE.md  → App Store Connect'e girilecek tüm metinler ve gönderim adımları
```

Gizlilik ve destek sayfaları repo kökünde: `kanaltakip-privacy.html`, `kanaltakip-support.html`.

## Kurulum (Mac'te, ~20 dakika)

Gerekenler: Xcode 16+, [Node.js](https://nodejs.org) (LTS), ücretsiz bir [Cloudflare](https://dash.cloudflare.com/sign-up) hesabı (yayında ayda 5$'lık Workers Paid önerilir), YouTube API anahtarı ve Apple push anahtarı (`.p8`).

### 1. Sunucu

```bash
cd kanal-takip/worker
npm install
npm run kurulum
```

Betik sırasıyla şunları yapar:
- Cloudflare girişini açar.
- Veritabanını ve tabloları oluşturur, sunucuyu yayına alır.
- YouTube anahtarını ve `.p8` dosyasını, Key ID'yi ve Team ID'yi sorar.
- Sunucu adresini Xcode projesine kendisi yazar.

### 2. Uygulama

1. `kanal-takip/ios/KanalTakip.xcodeproj` dosyasını aç.
2. Team (`TLSF8D3HV5`) projede ayarlı. Xcode → Settings → Accounts bölümünde Apple ID'nin ekli olması yeterli.
3. iPhone'u bağla ve ▶︎ Run de. Apple Watch uygulaması iPhone uygulamasıyla birlikte gelir (saatte otomatik yüklenmezse: iPhone'daki Watch uygulaması → Kanal Takip → Yükle).
4. Uygulama açılınca **Başla** de, bildirim iznini ver ve kanallarını ekle.

> Bundle ID başkası tarafından alınmışsa: Build Settings → `BUNDLE_ID_PREFIX` değerini değiştir, sonra `npm run kurulum` komutunu tekrar çalıştırıp aynı Bundle ID'yi gir.

### 3. App Store

[APPSTORE.md](APPSTORE.md) dosyasındaki adımları izle: mağaza metinleri, ekran görüntüleri, gizlilik etiketleri, inceleme notları, arşivleme ve YouTube kota başvurusu.

## Sunucu notları

- **Kanallar paylaşılır.** Bir kanalı 100 kişi takip etse de YouTube'a bir kez sorulur.
- **Kotaya göre zamanlama:** Yoklama sıklığı günlük kotaya göre otomatik ayarlanır. Ücretsiz kota (10.000/gün) yaklaşık 100 kanalı 10 dakikada bir yoklamaya yeter. Bu sınır `MAX_TOTAL_CHANNELS` ile korunur; kota artışı gelince `wrangler.toml` dosyasında yükselt.
- **Veri saklama:** YouTube istatistikleri en fazla 30 gün tutulur. 180 gün açılmayan hesaplar silinir.
- **Loglar:** `npm run loglar`
- **Test:** `npm test` çalıştırır. Gerçek SQLite, sahte YouTube ve sahte APNs ile 2 kullanıcı (TR/EN) için 36 saatlik bir simülasyon yapar.

Uygulamayı örnek veriyle açmak için Xcode → Scheme → Run → Arguments bölümüne `-demo` ekle.
