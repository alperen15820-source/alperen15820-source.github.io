# Kanal Takip — Kurulum (≈10 dakika)

Uygulama adresi: **https://alperen15820-source.github.io/yt/**
Kurmadan önce görmek için: **https://alperen15820-source.github.io/yt/?demo**

## Nasıl çalışır?

- **GitHub Actions** her ~10 dakikada bir YouTube'dan kanal ve video istatistiklerini çeker (telefonun kapalıyken de).
- Veriler `yt-data` dalına yazılır, uygulama oradan okur.
- Önemli bir şey olduğunda **ntfy** (ve istersen **Telegram**) üzerinden telefonuna bildirim gelir:
  - 🎉 **Abone hedefleri**: 100, 250, 500, **1000** (özel kutlama), 2000, 5000… Uygulamayı açınca konfetili kutlama ekranı da çıkar.
  - 🔥 **Video sıçraması**: Bir videonun son 1 saatteki izlenme hızı, önceki 24 saatin ortalamasının 3 katını geçerse.
  - 🚀 **Kanal izlenme patlaması** ve 👥 **abone yağması** (saatte 10+ abone).
  - 🎬 **Yeni video** yayınlandığında.
  - 📊 **Günlük rapor** her akşam saat 21:00'de (son 24 saat özeti ve en çok büyüyen video).

## 1. YouTube API anahtarı al (ücretsiz)

1. https://console.cloud.google.com/ adresine git, yeni bir proje oluştur.
2. **APIs & Services → Library** bölümünde **YouTube Data API v3**'ü bul ve **Enable** de.
3. **APIs & Services → Credentials → Create credentials → API key** yolunu izle.
4. (Önerilir) Anahtarı düzenle ve **API restrictions** altında yalnızca *YouTube Data API v3*'ü seç.

Günlük ücretsiz kota (10.000 birim) bu sistem için fazlasıyla yeterli: kanal başına günde yaklaşık 450 birim harcanıyor.

## 2. Bildirim uygulamasını kur (ntfy, ücretsiz)

1. Telefonuna **ntfy** uygulamasını yükle ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iPhone](https://apps.apple.com/app/ntfy/id1625396347)).
2. **+** butonuna bas ve tahmin edilmesi zor bir konu adı (topic) yaz. Örnek: `alperen-yt-7f3k9q2x`
   > Konu adını bilen herkes bildirimlerini görebilir, o yüzden rastgele ve uzun bir ad seç.

**İsteğe bağlı: Telegram.** @BotFather'dan bir bot oluştur ve token'ını al. Bota bir mesaj at, ardından `https://api.telegram.org/bot<TOKEN>/getUpdates` adresinden `chat.id` değerini öğren.

## 3. Gizli anahtarları GitHub'a ekle

Depoda **Settings → Secrets and variables → Actions → New repository secret** yolunu izle:

| Ad | Değer |
|---|---|
| `YT_API_KEY` | 1. adımdaki API anahtarı |
| `NTFY_TOPIC` | 2. adımdaki konu adı |
| `TELEGRAM_BOT_TOKEN` | *(isteğe bağlı)* |
| `TELEGRAM_CHAT_ID` | *(isteğe bağlı)* |

## 4. Kanallarını ekle

`yt/config.json` dosyasını GitHub'da aç, kalem ikonuna basarak düzenle ve kanallarını yaz:

```json
"channels": ["@kanal1", "@kanal2", "https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx"],
```

`@kullanıcıadı`, kanal linki ya da `UC…` ile başlayan kanal ID'si kabul edilir.

Aynı dosyada şu ayarları da değiştirebilirsin:

| Ayar | Anlamı |
|---|---|
| `milestones` | Kutlama yapılacak abone sayıları |
| `alerts.spikeMultiplier` | Sıçrama sayılması için normalin kaç katı gerektiği (varsayılan 3) |
| `alerts.videoMinViewsPerHour` | Bir videonun sıçrama sayılması için en az saatlik izlenme |
| `alerts.channelMinViewsPerHour` | Kanalın tamamı için en az saatlik izlenme |
| `alerts.subsPerHour` | "Abone yağıyor" bildirimi için gereken saatlik abone sayısı |
| `alerts.newVideo` | Yeni video bildirimi açık mı (`true` / `false`) |
| `alerts.cooldownHours` | Aynı şey için iki bildirim arasındaki en kısa süre (saat) |
| `dailyReportHour` | Günlük raporun saati (0–23, Türkiye saati) |
| `trackLatestVideos` | Takip edilen son video sayısı |

## 5. Çalıştır ve test et

1. **Actions** sekmesine git. İş akışları kapalıysa "I understand… enable" butonuna bas.
2. **YouTube Takip → Run workflow** yolunu izle, **"Telefona test bildirimi gönder"** kutusunu işaretle ve çalıştır.
3. Bir dakika içinde telefonuna ✅ test bildirimi gelmeli.
4. Telefonda **https://alperen15820-source.github.io/yt/** adresini aç ve uygulamayı ana ekrana ekle:
   - iPhone: Safari → Paylaş → **Ana Ekrana Ekle**
   - Android: Chrome → ⋮ → **Uygulamayı yükle** / **Ana ekrana ekle**

## Bilmen gerekenler

- **Güncelleme sıklığı ~10 dakika.** GitHub yoğun saatlerde zamanlanmış işleri birkaç dakika geciktirebilir.
- **Sıçrama tespiti** için biraz geçmiş veri gerekiyor. İlk sıçrama bildirimi en erken birkaç saat sonra gelebilir; grafikler zamanla dolar.
- **YouTube 1000 üstündeki abone sayılarını yuvarlar** (ör. 12.345 yerine 12.300 görünür). Hedef bildirimleri bundan etkilenmez.
- **Kurulumdan önce geçilmiş hedefler için bildirim gelmez.** Sadece yeni geçilen hedefler kutlanır.
- **GitHub, 60 gün boyunca depoda hiç hareket olmazsa zamanlanmış işleri durdurabilir.** Uygulama veriler 1 saatten eskiyse uyarı gösterir. Böyle bir durumda Actions sayfasından iş akışını yeniden etkinleştirmen yeterli.
