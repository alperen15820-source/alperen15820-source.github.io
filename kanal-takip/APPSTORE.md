# App Store'a gönderim rehberi

Bu dosyadaki her metin, App Store Connect'te ilgili kutuya **kopyala-yapıştır** yapılmak için hazır.

---

## 0. Yayından önce (bir kerelik)

1. **Sunucuyu kur:** `cd kanal-takip/worker && npm install && npm run kurulum`. Betik D1 veritabanını oluşturur, sunucuyu yayına alır ve adresini Xcode projesine yazar.
2. **Cloudflare Workers Paid planına geç** (ayda 5$, dash.cloudflare.com → Workers & Pages → Plans). Ücretsiz plan, zamanlanmış görev başına 10 ms işlemci süresiyle sınırlı ve birkaç kullanıcıdan sonra yetmez.
3. **Gizlilik ve destek sayfalarını yayınla:** Bu daldaki `kanaltakip-privacy.html` ve `kanaltakip-support.html` dosyalarının `main` dalına geçmesi gerekiyor. Ancak o zaman şu adreslerde açılırlar:
   - https://alperen15820-source.github.io/kanaltakip-privacy.html
   - https://alperen15820-source.github.io/kanaltakip-support.html
4. **YouTube kota artışı başvurusu yap** (aşağıda, bölüm 6). Onay gelene kadar uygulama en fazla ~100 farklı kanalı takip edebilir; sınıra gelinirse yeni kullanıcılar "kapasite dolu" mesajı görür.

## 1. Uygulamayı oluştur

App Store Connect → **Apps → + → New App**

| Alan | Değer |
|---|---|
| Platform | iOS |
| Name | **Kanal Takip** |
| Primary Language | Turkish |
| Bundle ID | `com.alperen15820.kanaltakip` (Xcode'da ilk derlemeden sonra listede çıkar) |
| SKU | `kanaltakip-ios` |
| User Access | Full Access |

Ardından **App Information → Localizable Information → + English (U.S.)** ile İngilizce dilini de ekle.

## 2. Mağaza metinleri

### Türkçe

**Alt başlık (30 karakter):**
```
Kanal istatistiği ve uyarılar
```

**Tanıtım metni (170 karakter):**
```
Videon patlama yaptığında, aboneler yağdığında ve 1000 aboneye ulaştığında ilk sen öğren. Siyah-beyaz, sade ve hızlı.
```

**Açıklama:**
```
Kanal Takip, YouTube kanallarının nabzını tutar ve önemli bir şey olduğunda sana haber verir.

SIÇRAMA BİLDİRİMİ
Bir video normalden çok daha hızlı izlenmeye başladığında anında bildirim alırsın. Eşiği kendin belirlersin.

ABONE HEDEFLERİ
100, 1000, 10.000… Her hedefe ulaştığında kutlama. 1000 aboneye özel tam ekran kutlama ve YouTube Partner Programı hatırlatması.

SABAH ÖZETİ — SAAT YOK
Alarmını kapattığın an dünün özeti gelir: kaç abone kazandın, kaç izlenme aldın, en iyi videon hangisi.

KİLİT EKRANI WIDGET'I
Telefonu eline aldığın an son 24 saat.

5 KANALA KADAR
Kendi kanalını ya da herhangi bir herkese açık kanalı @kullanıcıadı ile ekle. Giriş yok, şifre yok.

GİZLİLİK ÖNCELİKLİ
Hesap açman gerekmez. Reklam ve takip yok. Tüm verilerini tek dokunuşla silebilirsin.

Kanal verileri YouTube API Hizmetleri ile alınır. Kanal Takip, YouTube veya Google ile bağlantılı değildir.
```

**Anahtar kelimeler (100 karakter):** — Apple kuralı (2.3.7) gereği marka adları ("youtube") anahtar kelimelere yazılmaz.
```
abone,kanal,izlenme,analiz,istatistik,youtuber,shorts,bildirim,takip,video,içerik üretici,büyüme
```

### English (U.S.)

**Subtitle:**
```
Channel stats & spike alerts
```

**Promotional Text:**
```
Be the first to know when a video takes off, subscribers pour in, or you hit 1,000 subscribers. Black and white, simple, fast.
```

**Description:**
```
Kanal Takip keeps a pulse on your YouTube channels and lets you know when something big happens.

SPIKE ALERTS
Get notified the moment a video starts getting views much faster than usual. You set the threshold.

SUBSCRIBER MILESTONES
100, 1,000, 10,000… A celebration at every milestone, with a special full-screen moment at 1,000 and a YouTube Partner Program reminder.

MORNING SUMMARY — NO FIXED TIME
Yesterday's recap arrives the moment you stop your alarm: subscribers gained, views, and your best video.

LOCK SCREEN WIDGET
The last 24 hours at a glance.

UP TO 5 CHANNELS
Add your own channel or any public channel by @handle. No sign-in, no password.

PRIVACY FIRST
No account required. No ads, no tracking. Delete all your data with one tap.

Channel data is provided by YouTube API Services. Kanal Takip is not affiliated with YouTube or Google.
```

**Keywords:**
```
subscriber,channel,views,analytics,stats,youtuber,shorts,alerts,tracker,creator,growth,video
```

### Her iki dil için ortak

| Alan | Değer |
|---|---|
| Support URL | https://alperen15820-source.github.io/kanaltakip-support.html |
| Marketing URL | *(boş bırak)* |
| Privacy Policy URL | https://alperen15820-source.github.io/kanaltakip-privacy.html |
| Category (Primary) | Productivity |
| Category (Secondary) | Utilities |
| Copyright | 2026 Alperen |
| Price | Free |

## 3. Ekran görüntüleri

**6.9" Display** bölümüne yükle. Boyut 1320×2868, Apple diğer boyutları bundan üretir.

- Türkçe: `ios/screenshots/appstore/tr/` (6 görsel, sırayla)
- English: `ios/screenshots/appstore/en/` (6 görsel, sırayla)

## 4. Yaş derecesi ve App Privacy

**Age Rating:** Bütün sorulara "None / No" de. Sonuç **4+** olur.

**App Privacy → Data Collection:** "Yes, we collect data" de ve şunları seç:

| Veri türü | Kullanım | Kimliğe bağlı mı? | İzleme için mi? |
|---|---|---|---|
| **Identifiers → User ID** | App Functionality | No | No |
| **User Content → Other User Content** (takip edilen kanal listesi) | App Functionality | No | No |

Başka bir şey seçme. Konum, kişiler, analiz ve reklam verisi toplanmıyor.

## 5. App Review bilgileri

**Sign-in required:** No

**Notes (İngilizce yaz):**
```
Kanal Takip tracks public YouTube channel statistics using the YouTube Data API v3 (API key, public data only — no OAuth, no access to the user's YouTube account).

No sign-in is needed. On first launch the app creates an anonymous account on our server.

To test:
1. Tap "Get started" and allow notifications.
2. Add any public channel, e.g. @MrBeast or @YouTube, and tap "Start tracking".
3. Data appears within seconds. Settings → "Test alert" sends a push notification.
4. Settings → "Delete my data" permanently deletes the account and all server data (guideline 5.1.1(v)).

Spike and milestone notifications are sent from our server (Cloudflare Workers) via APNs when a tracked channel's statistics change; channels are polled about every 10 minutes.

The morning summary is an App Intent ("Morning Summary") that users can run from a Shortcuts personal automation (e.g. when an alarm is stopped). The app also offers Lock Screen and Home Screen widgets.
```

**Contact Information:** Adın, telefon ve e-posta (Apple'ın inceleme ekibi için, yayınlanmaz).

## 6. Arşivle ve gönder

1. Xcode üstteki cihaz menüsünden **Any iOS Device (arm64)** seç.
2. **Product → Archive** de.
3. Organizer penceresinde **Distribute App → App Store Connect → Upload** yolunu izle.
4. App Store Connect'te sürüm sayfasında **Build** bölümünden yüklenen build'i seç → **Add for Review** → **Submit**.
5. İnceleme genelde 1–3 gün sürer.

Sonraki sürümlerde Xcode'da **MARKETING_VERSION**'ı (1.0 → 1.1) ve **CURRENT_PROJECT_VERSION**'ı (1 → 2) artır.

## 7. YouTube API kota artışı başvurusu

Form: https://support.google.com/youtube/contact/yt_api_form → **"YouTube API Services - Audit and Quota Extension Form"**

Önce Google Cloud Console → APIs & Services → **OAuth consent screen** bölümünden uygulama adını, destek e-postasını ve gizlilik politikası linkini doldur. Bazı formlar bunu istiyor; OAuth kullanmıyor olsan da sorun değil.

Forma girilecek bilgiler (İngilizce):

- **API Client name:** Kanal Takip
- **Project number:** Google Cloud Console → proje ayarları
- **Website / app link:** App Store linki (yayından sonra) ya da destek sayfası
- **Privacy policy:** https://alperen15820-source.github.io/kanaltakip-privacy.html
- **Quota requested:** 100,000 units/day
- **Use case:**
```
Kanal Takip is an iOS app that lets YouTube creators track up to 5 public channels (usually their own) and receive push notifications for view spikes, subscriber milestones and new uploads.

API usage: channels.list (statistics, snippet) batched 50 IDs per call, playlistItems.list for each channel's uploads playlist (to detect the 10 most recent videos), and videos.list (statistics) batched 50 IDs per call. Channels are shared across users, so each channel is polled once regardless of how many users follow it. Polling frequency adapts automatically to the daily quota.

We only use public data, we do not use OAuth or access private user data. Statistics are stored for at most 30 days to render charts and detect spikes, then deleted. The app links to the YouTube Terms of Service and Google Privacy Policy, and users can delete all their data in-app.

Current quota (10,000/day) supports about 100 unique channels at a 10-minute interval. 100,000 units/day would let us support about 1,000 channels.
```

Onay gelince `worker/wrangler.toml` dosyasında `YT_DAILY_QUOTA` ve `MAX_TOTAL_CHANNELS` değerlerini yükselt ve `npm run deploy` çalıştır.
