# Kanal Takip

5 YouTube kanalını anlık takip eden iPhone uygulaması.

- **Bildirimler:** Video sıçraması, izlenme patlaması, abone yağması, yeni video ve abone hedefleri. 1000 aboneye ulaşınca özel kutlama ekranı açılır.
- **Sabah özeti:** Belli bir saati yok. Alarmını kapattığında gelir.
- **Kilit ekranı ve ana ekran widget'ı:** Telefonu eline aldığın an son 24 saati görürsün.
- **Tasarım:** Siyah zemin, lacivert yüzeyler, sert köşeler.

```
kanal-takip/
├── worker/   → Cloudflare sunucusu: 10 dk'da bir kontrol eder, push gönderir (ücretsiz)
└── ios/      → Xcode projesi (SwiftUI + widget)
```

## Kurulum (~20 dakika, hepsi Mac'te)

### 1. YouTube API anahtarı

1. https://console.cloud.google.com adresinde yeni bir proje oluştur.
2. **APIs & Services → Library** bölümünden **YouTube Data API v3**'ü bul ve **Enable** de.
3. **Credentials → Create credentials → API key** ile anahtarı oluştur ve kopyala.

### 2. Apple push anahtarı (.p8)

1. https://developer.apple.com/account/resources/authkeys/list adresinde **+** butonuna bas.
2. Bir ad ver, **Apple Push Notifications service (APNs)** kutusunu işaretle ve **Continue → Register** de.
3. `AuthKey_XXXXXXXXXX.p8` dosyasını indir. Dosya sadece bir kez indirilebiliyor, sakla.
4. **Team ID**'ni not al: https://developer.apple.com/account → Membership details.

### 3. Sunucuyu kur

Gerekenler: [Node.js](https://nodejs.org) (LTS) ve ücretsiz bir [Cloudflare](https://dash.cloudflare.com/sign-up) hesabı.

```bash
cd kanal-takip/worker
npm install
npm run kurulum
```

Betik sırasıyla şunları yapar:

- Cloudflare'e giriş için tarayıcıyı açar.
- Veri deposunu oluşturur ve sunucuyu yayına alır.
- YouTube anahtarını ve `.p8` dosyasının yolunu sorar. Dosyayı Terminal'e sürükleyip bırakabilirsin.
- Sonunda telefon için bir **QR kod** gösterir. Terminali kapatma.

### 4. Uygulamayı iPhone'a yükle

1. `kanal-takip/ios/KanalTakip.xcodeproj` dosyasını Xcode ile aç (Xcode 16 veya üstü).
2. Sol üstte **KanalTakip** projesini seç. **Signing & Capabilities** sekmesinde iki hedef var: *KanalTakip* ve *KanalTakipWidgetExtension*. İkisinde de **Team** olarak kendi hesabını seç.
3. iPhone'u kabloyla bağla, üstteki cihaz menüsünden telefonunu seç ve **▶︎ Run** de.
   - İlk seferde iPhone'da **Ayarlar → Gizlilik ve Güvenlik → Geliştirici Modu**'nu açman gerekebilir.
4. Uygulama açılınca bildirim iznini ver.
5. iPhone kamerasıyla terminaldeki **QR kodu okut**. Uygulama sunucuya kendiliğinden bağlanır.

> **"Bundle identifier is not available" hatası alırsan:** Proje → **Build Settings** → `BUNDLE_ID_PREFIX` değerini değiştir (ör. `com.adin.kanaltakip`). Sonra `npm run kurulum` komutunu tekrar çalıştır ve aynı Bundle ID'yi gir.

### 5. Kanalları ekle

Uygulamada **Ayarlar → Kanallar** bölümüne `@kanaladin` yaz, **+** butonuna bas ve **Ayarları kaydet** de. Birkaç saniye içinde veriler gelir. Ardından **Test bildirimi** butonuyla push bildiriminin geldiğini kontrol et.

### 6. Sabah özeti (bir kerelik)

1. **Kısayollar** uygulamasında **Otomasyon → + → Alarm → Durdurulduğunda** seç (ya da **Uyku → Uyanış**).
2. **Hemen Çalıştır**'ı seç.
3. Eylem olarak **Kanal Takip → Sabah Özeti**'ni ekle.

İstersen **Ayarlar → Yedek özet** seçeneğini aç. Otomasyon o gün çalışmazsa sunucu özeti senin belirlediğin saatte gönderir.

### 7. Widget

Kilit ekranına uzun bas → **Özelleştir** → **Kanal Takip**'i ekle. Ana ekrana da küçük, orta ya da büyük boyutta ekleyebilirsin.

## Ayarlar

Bildirim eşiklerini uygulamadaki **Ayarlar** ekranından değiştirebilirsin. Varsayılanlar:

- **Sıçrama:** Bir videonun son 1 saatteki izlenme hızı, önceki 24 saatin ortalamasının 3 katını geçerse ve saatte en az 50 izlenme alıyorsa.
- **İzlenme patlaması:** Aynı kural kanalın tamamı için, saatte en az 100 izlenme ile.
- **Abone yağması:** Saatte 10 veya daha fazla abone.
- **Tekrar bekleme:** Aynı şey için 3 saat içinde ikinci bildirim gelmez.

## Bilmen gerekenler

- **Maliyet:** Cloudflare'in ücretsiz planı, YouTube API'nin ücretsiz kotası (5 kanal için günde ~2.200 / 10.000 birim) ve mevcut Apple geliştirici hesabın yeterli. Ek ücret yok.
- **Sıçrama tespiti** için birkaç saatlik veri gerekiyor. İlk sıçrama bildirimi en erken birkaç saat sonra gelir.
- **Abone sayıları yuvarlanır:** YouTube 1000 üstündeki abone sayılarını yuvarlar (12.345 → 12.300). Hedef bildirimleri bundan etkilenmez.
- **Eski hedefler kutlanmaz:** Kurulumdan önce geçilmiş hedefler için bildirim gelmez.
- **Sunucu logları:** `cd kanal-takip/worker && npm run loglar`
