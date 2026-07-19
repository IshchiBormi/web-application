# Google Play muvofiqligi — ma'lumotlar, saqlash muddatlari, uchinchi tomonlar

Bu hujjat Google Play'ga topshirish uchun **yagona haqiqat manbai**: ilova
qanday ma'lumot yig'adi, uni qancha saqlaydi, kimga uzatadi va qanday
o'chiradi. Har bir qator manba kodidagi aniq joyga havola qilingan.

> **Qoida:** bu yerdagi biror qator o'zgarsa, quyidagilar ham birga o'zgarishi
> shart — `frontend/lib/retention.ts`, `/maxfiylik-siyosati`,
> `/delete-account`, ilovadagi `privacy_policy_page.dart` va Play Console'dagi
> **Data safety** formasi. Kod bilan e'lon qilingan siyosat bir-biriga mos
> kelmasligi — Google Play siyosatining to'g'ridan-to'g'ri buzilishi.

Oxirgi tekshiruv: 2026-07-19.

---

## 1. Yig'iladigan ma'lumotlar

| Ma'lumot | Qayerda | Manba |
|---|---|---|
| Telefon raqami | `users.phone` | `internal/auth/otp.go`, `models.User` |
| Telegram ID | `users.telegramId` | `internal/auth/otp.go` |
| Ism, familiya | `users.firstName/lastName` | `models.User` |
| Viloyat, tuman | `users.region/district` | `models.User` |
| Bio, ko'nikmalar (ixtiyoriy) | `users.bio/skills` | `models.User` |
| Avatar (ixtiyoriy) | `users.avatarUrl` → S3/disk | `internal/upload` |
| E'lon matni, narxi, vaqti | `elons.*` | `models.Elon` |
| E'lon koordinatalari (ixtiyoriy) | `elons.lat/lng` | `models.Elon` |
| E'lon rasmlari | `elons.images` → S3/disk | `internal/upload` |
| Arizalar (+ ishchi telefoni) | `applications.*` | `models.Application` |
| Bildirishnomalar | `notifications.*` | `internal/notification` |
| Taklif/shikoyat | `feedback.*` | `models.Feedback` |
| Shikoyatlar | `reports.*` | `models.Report` |
| **Qo'llab-quvvatlash boti murojaatlari** | `bot_feedback.*` | `bot/cmd/feedbackbot/main.go` |
| ├ telefon, ism, Telegram username | `bot_feedback.phone/name/username` | `feedbackDoc` |
| ├ matn xabari | `bot_feedback.text` | `contentType: "text"` |
| └ **ovozli xabar / rasm havolasi** | `bot_feedback.fileId` | `contentType: "voice" \| "photo"` |
| IP manzil | server jurnali + rate limit | `chi middleware.Logger`, `pkg/httpx/ratelimit` |

> ⚠️ **`bot_feedback` ni unutmang.** U backend emas, **bot moduli** tomonidan
> yoziladi (`bot/cmd/feedbackbot`), lekin **o'sha bazaga** tushadi. Kolleksiyalar
> ro'yxatini faqat `backend/` bo'ylab `grep 'Collection("'` bilan tuzish shu
> sababli xato natija beradi — `bot/` ni ham qo'shing:
> `grep -rhno 'Collection("[a-z_]*")' --include=*.go backend/ bot/ | sort -u`

### Yig'ilMAYdigan — tekshirilgan va tasdiqlangan

Quyidagilar **kodda umuman yo'q**. Maxfiylik siyosatida ham yo'q bo'lishi shart:

- **Analitika / crash reporting** — `pubspec.yaml` da Firebase, Crashlytics,
  Google Analytics, Sentry, Amplitude va shunga o'xshash **hech qanday SDK yo'q**.
- **Kamera** — `post_job_page.dart:_pickImages()` faqat `pickMultiImage()`
  chaqiradi. `ImageSource.camera` butun kod bazasida ishlatilmaydi.
  `NSCameraUsageDescription` shu sababli `Info.plist` dan olib tashlandi.
- **Qurilma/brauzer identifikatorlari** — device model, OS versiyasi, advertising
  ID yig'ilmaydi.
- **Chat / xabarlar** — backend'da `/api/ws` yoki conversations endpoint'lari
  **yo'q** (`cmd/api/main.go` marshrutlar ro'yxatiga qarang). Flutter'dagi
  `features/chat/` — ishlatilmayotgan data qatlami, serveri yo'q.
- **Moliyaviy hisobotlar** — `/api/me/finance` marshruti backend'da yo'q.
- **Sharh va baholar** — `users.rating`, `workerRating` maydonlari mavjud, lekin
  **hech qanday kod ularga yozmaydi**. Sharh qoldirish funksiyasi
  amalga oshirilmagan.
- **Parol (foydalanuvchi uchun)** — kirish faqat Telegram OTP orqali.
  bcrypt **faqat admin** hisoblarida (`internal/admin/login.go`).
- **To'lovlar** — karta/to'lov ma'lumotlari qabul qilinmaydi.

---

## 2. Saqlash muddatlari

Muddatlarning **yagona manbai** — `frontend/lib/retention.ts`. Backend tomonda
ular quyidagicha bajariladi:

| Ma'lumot | Muddat | Qanday bajariladi |
|---|---|---|
| Kirish (OTP) kodi | 3 daqiqa | `OTP_TTL_SECONDS`; Mongo TTL index `otp_codes.expiresAt` |
| O'chirish kodi | 10 daqiqa | `deleteCodeTTL`; TTL index `delete_codes.expiresAt` |
| Access JWT | 15 kun | `JWT_ACCESS_TTL_MIN=21600`; serverda saqlanmaydi |
| Refresh JWT | 30 kun | `JWT_REFRESH_TTL_HRS=720`; serverda saqlanmaydi |
| E'lon (foydalanuvchi o'chirsa) | **darhol, butunlay** | `elon.Delete` — `DeleteOne` + arizalar + rasmlar |
| Profil, e'lon, ariza, bildirishnoma, feedback, report | hisob faol bo'lgunicha | — |
| **O'chirilgan hisob** | **90 kun**, keyin butunlay yo'q | `ACCOUNT_RETENTION_DAYS`; `internal/account/retention.go` |

### Hisobni o'chirish — ikki bosqich

**1-bosqich (darhol)** — `internal/account/delete.go:softDelete`:
`isDeleted=true`, `deletedAt` qo'yiladi; `phone`/`telegramId` `$unset` qilinadi
(raqam darhol bo'shaydi, qayta ro'yxatdan o'tish mumkin) va `deletedPhone`/
`deletedTelegramId` ga arxivlanadi; e'lonlar feed'dan olinadi; faol arizalar
ikki tomonda ham bekor qilinadi; rasmlar o'chiriladi. Eski JWT bilan kelgan har
qanday so'rov `403 account_disabled` oladi.

**2-bosqich (90 kundan keyin)** — `internal/account/retention.go:Purger`:
har 6 soatda muddati o'tganlarni topib, **butunlay o'chiradi** — user hujjati
(shu jumladan `deletedPhone`/`deletedTelegramId`), e'lonlar, ikki tomondagi
arizalar, bildirishnomalar, feedback, reportlar (yuborgan va u haqidagi),
**qo'llab-quvvatlash boti murojaatlari (`bot_feedback`)**, o'chirish/OTP kodlari
va yuklangan fayllar. Qarshi tomondagi, o'chirilgan arizalarga havola qiluvchi
bildirishnomalar ham tozalanadi (uzilgan havola qolmasligi uchun).

Muhim tafsilotlar:
- User hujjati **eng oxirida** o'chiriladi — jarayon yarmida uzilsa, keyingi
  siklda qaytadan boshlanadi (idempotent).
- Admin o'chirishi (`admin.DeleteUser`) ham `deletedAt` qo'yadi, demak **u ham
  shu 90 kunlik soatga bo'ysunadi** — hech qanday yozuv abadiy qolmaydi.
- `ACCOUNT_RETENTION_DAYS` 0 yoki manfiy bo'lsa 90 kun qo'llanadi — noto'g'ri
  sozlama o'chirishni jimgina o'chirib qo'ya olmaydi.
- `bot_feedback` da `userId` yo'q, shuning uchun **arxivlangan shaxsiyat**
  bo'yicha topiladi (`deletedTelegramId` / `deletedPhone`) — `softDelete` aynan
  shu ikki qiymatni saqlab qo'ygani uchun bu bog'lanish umuman mumkin.
  Filtrda `createdAt <= deletedAt` sharti bor: bo'shatilgan raqam qayta
  ro'yxatdan o'tishi mumkin, va eski hisobni 90 kundan keyin tozalash **yangi**
  hisobning xabarlarini o'chirib yubormasligi kerak.
- Testlar: `internal/account/retention_test.go` (real Mongo'ga qarshi).

### Nima o'chmaydi va NEGA (2-talab bo'yicha hujjatlashtirish)

| Qoladigan narsa | Nega o'chira olmaymiz |
|---|---|
| Botga yuborilgan **ovozli xabar va rasm fayllarining o'zi** | Fayl bizda emas, **Telegram serverlarida** turadi; `bot_feedback` da faqat `fileId` (havola) saqlanadi. Telegram Bot API'sida boshqa foydalanuvchi yuborgan faylni o'chirish amali **umuman mavjud emas**. Biz havolani va yozuvni o'chiramiz. Foydalanuvchi Telegram'da bot bilan suhbatni o'chirsa, o'z tomonidagi nusxa ham ketadi. **Ikkala maxfiylik sahifasida ochiq yozilgan.** |
| Foydalanuvchining Telegram'idagi **suhbat tarixi** | Bu foydalanuvchining o'z qurilmasi/Telegram hisobidagi ma'lumot — bizning nazoratimizda emas. Ochiq yozilgan. |
| `support_admins` | Foydalanuvchi emas, **xodim** (admin) yozuvlari: admin telefoni va chat id. Foydalanuvchi shaxsiy ma'lumoti emas. |
| `admin_audit` | Moderatsiya harakatlari jurnali. Tozalashdan keyin unda faqat **hech narsaga ishora qilmaydigan ObjectID** qoladi — bog'langan hujjat yo'q qilingani uchun shaxsni aniqlab bo'lmaydi. Xavfsizlik/hisobdorlik uchun saqlanadi. |

---

## 3. Uchinchi tomonlar — to'liq ro'yxat

Oldingi audit ro'yxati **to'liq emas edi**. Kod bo'ylab barcha tashqi
chaqiruvlar qidirib chiqilgach quyidagilar aniqlandi:

| Xizmat | Nima uzatiladi | Qayerdan | Manba |
|---|---|---|---|
| **Telegram Bot API** (auth bot) | Telegram ID, kod matni | server | `pkg/tgsend`, `bot/` |
| **Telegram** (qo'llab-quvvatlash boti) ⚠️ | foydalanuvchi yuborgan **matn, ovozli xabar, rasm** + telefon, ism, username | foydalanuvchi → Telegram → bizning bot | `bot/cmd/feedbackbot`; ilovadan havola: `AppConstants.telegramSupportUrl` |
| **AWS EC2** | barcha server ma'lumotlari (xosting) | — | `docker-compose.yml` |
| **AWS S3** | yuklangan rasmlar | server | `pkg/storage/s3.go` |
| **MongoDB** | barcha yozuvlar (o'z serverimizda) | — | `pkg/db` |
| **OpenStreetMap tiles** | IP, ko'rilayotgan hudud | klient | `location_picker_page.dart`, `jobs_map_view.dart` |
| **Esri ArcGIS tiles** | IP, ko'rilayotgan hudud | klient | `location_picker_page.dart` |
| **Nominatim (OSM)** ⚠️ | **e'lon koordinatalari** | **server** | `pkg/geocode/geocode.go` ← `elon/handler.go:648` |
| **Xarita ilovalari** (Google Maps, Yandex, 2GIS…) | ish joyi koordinatalari | klient, foydalanuvchi bosganda | `core/utils/map_launcher.dart` |
| **Google Play** | o'rnatish ma'lumotlari (Google to'playdi) | — | tarqatish kanali |

⚠️ **Nominatim** oldingi ro'yxatda yo'q edi va u eng muhimi: bu **server
tomondan** yuboriladigan joylashuv ma'lumoti. E'lon yaratilganda koordinatalar
viloyat/tuman nomiga aylantirish uchun `nominatim.openstreetmap.org` ga
yuboriladi. Faqat koordinata yuboriladi — ism/telefon emas. Ikkala maxfiylik
sahifasida ham oshkor qilingan.

**Google Play Services:** `geolocator` va `location` paketlari Android'da
joylashuvni fused location provider orqali oladi. Bu — OS darajasidagi API,
bizdan hech qanday ma'lumot uzatilmaydi.

**Tekshirish usuli** (yangi bog'liqlik qo'shilganda takrorlang):

```bash
# Backend'dagi barcha tashqi manzillar
grep -rhno "https\?://[a-zA-Z0-9._/-]*" --include=*.go backend/ | sed 's/.*http/http/' | sort -u
# Flutter'dagi barcha tashqi manzillar
grep -rhno "https\?://[a-zA-Z0-9._{}/-]*" ../flutter-app/lib --include=*.dart | sed 's/.*http/http/' | sort -u
```

---

## 4. Ilova ruxsatlari

`android/app/src/main/AndroidManifest.xml` — release build faqat shu uchtasini
e'lon qiladi:

**Manba** — `android/app/src/main/AndroidManifest.xml` **emas**, balki
**birlashtirilgan (merged) release manifesti**: Flutter plaginlari o'z
ruxsatlarini qo'shadi va Google aynan shuni ko'radi. Tekshirish:

```bash
grep -o 'uses-permission android:name="[^"]*"' \
  build/app/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml \
  | sort -u
```

| Ruxsat | Nima uchun | Manba |
|---|---|---|
| `INTERNET` | backend + xarita plitalari | asosiy manifest |
| `ACCESS_FINE_LOCATION` | xaritadan ish joyini belgilash | asosiy manifest |
| `ACCESS_COARSE_LOCATION` | e'lonlarni "eng yaqin" tartibida ko'rsatish | asosiy manifest |
| `ACCESS_NETWORK_STATE` | ulanish holatini kuzatish (oflayn ogohlantirishi) | **`connectivity_plus` plagini qo'shadi** |
| `…DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | AndroidX avtomatik qo'shadi; signature darajasida, faqat ilova ichida | androidx |

`ACCESS_BACKGROUND_LOCATION` **yo'q** — bo'lganda Play uchun alohida ariza va
video ko'rik talab qilinardi.

Galereyadan rasm tanlash tizim tanlagichi orqali bo'ladi — alohida ruxsat
talab qilmaydi. `usesCleartextTraffic="true"` **faqat** debug va profile
manifestlarida; release HTTPS-only.

---

## 5. Play Console → Data safety formasi

Quyidagi javoblar kodga asoslangan. **Topshirishdan oldin tasdiqlang.**

| Savol | Javob | Izoh |
|---|---|---|
| Ma'lumot shifrlangan holda uzatiladimi? | **Ha** | HTTPS-only (release) |
| Foydalanuvchi ma'lumot o'chirishni so'ray oladimi? | **Ha** | ilovada + `https://ishchibormi.uz/delete-account` |
| Ma'lumot o'chirish URL'i | `https://ishchibormi.uz/delete-account` | — |

**Collected (yig'iladi):**

| Kategoriya | Tur | Maqsad | Majburiymi |
|---|---|---|---|
| Personal info | Telefon raqami | Account management, App functionality | Ha |
| Personal info | Ism | App functionality | Ha |
| Personal info | Boshqa (Telegram ID, Telegram username) | Account management, Customer support | Ha |
| Location | Taxminiy/aniq joylashuv | App functionality | **Yo'q** (ixtiyoriy) |
| Photos and videos | **Photos** | App functionality, **Customer support** | Yo'q |
| **Audio** | **Voice or sound recordings** | **Customer support** | **Yo'q** |
| Messages | Boshqa UGC (e'lon, ariza, feedback) | App functionality, Customer support | Ha |
| App activity | Boshqa (arizalar) | App functionality | Ha |

⚠️ **Audio (ovozli xabar)** — bu qatorni tushirib qoldirmang. Ilova o'zi mikrofonga
murojaat qilmaydi, lekin **Yordam bo'limidagi tugma foydalanuvchini bizning
Telegram qo'llab-quvvatlash botimizga olib boradi** va u yerda yuborilgan ovozli
xabar bizning bazamizga (`bot_feedback`) tushadi. Google uchun bu — ilova yo'llab
yuborgan kanal orqali yig'ilgan ma'lumot, shuning uchun "Voice or sound
recordings" deb e'lon qilinadi. Xuddi shu sabab bilan `Photos` uchun
"Customer support" maqsadi ham belgilanadi.

**Faqat ilovada** (bot orqali emas) yig'ilishini ta'kidlash uchun eslatma:
mikrofon ruxsati manifestda **yo'q** — ovoz faqat Telegram ilovasi orqali
yuboriladi.

**Shared (uchinchi tomonga uzatiladi):** e'lon koordinatalari → Nominatim
(viloyat/tuman aniqlash uchun). Google "service provider" transferlarini
"shared" deb hisoblamaydi, lekin **ehtiyot chorasi sifatida oshkor qilishni
tavsiya qilamiz** — ikkala maxfiylik sahifasida yozilgan.

**IP manzil:** faqat xavfsizlik va suiiste'molning oldini olish uchun
(rate limiting + server jurnali). Google'ning "Fraud prevention, security and
compliance" maqsadi bo'yicha deklaratsiya qilinadi.

---

## 6. App Access — reviewer uchun kirish

Play Console → App content → **App access**. Ilova login bilan yopiq, shuning
uchun Google ishlaydigan kredensial talab qiladi. Oddiy login Telegram bot OTP'si
orqali — reviewer buni bajara olmaydi (Telegram hisobi ham, O'zbekiston raqami
ham yo'q). Shu sabab **review login** mexanizmi qo'shilgan.

Mexanizm: `backend/internal/auth/review.go` (u yerdagi izohda to'liq asoslash).

**Qisqacha:** yoqilgan paytda `/auth/otp/verify` bitta qo'shimcha 6 xonali kodni
qabul qiladi va uni bitta oldindan yaratilgan, sandbox'langan hisobga bog'laydi.
Kod **mobil ilovada yo'q** — reviewer uni oddiy OTP maydoniga qo'lda kiritadi,
ya'ni APK'ni teskari muhandislik qilish hech narsa bermaydi.

### Buyruqlar

```bash
docker compose exec backend /app/reviewaccount status   # holat
docker compose exec backend /app/reviewaccount create   # bir marta, umuman
docker compose exec backend /app/reviewaccount open     # topshirishdan oldin
docker compose exec backend /app/reviewaccount close    # tasdiqlangach
docker compose exec backend /app/reviewaccount purge    # demo qoldiqlarni tozalash
```

`open` har safar **yangi kod** generatsiya qiladi va Play Console'ga
qo'yiladigan matnni chop etadi. Kod hech qachon qayta ishlatilmaydi.

### Demo hisob nima qila oladi

| Ruxsat | Bloklangan |
|---|---|
| E'lon joylash, tahrirlash, o'chirish | Rasm yuklash (`/uploads`) |
| Ariza yuborish, qabul/rad qilish | Hisobni o'chirish |
| Profil tahriri | Shikoyat (`/reports`) |
| Ko'rish, qidirish, bildirishnomalar | Taklif/shikoyat (`/feedback`) |
| | Foydalanuvchi bloklash |

Telefon raqamini o'zgartirish yo'li umuman yo'q (`updateMeReq` da bunday maydon
yo'q) — bu barcha hisoblar uchun shunday.

### Izolyatsiya — real foydalanuvchi hech narsa sezmaydi

- Demo hisob yaratgan e'lonlar `isReviewData: true` bilan belgilanadi va feed,
  qidiruv hamda sitemap'dan chiqariladi
- Demo hisobning arizalari real ish beruvchining nomzodlar ro'yxatiga tushmaydi
- `notification.Push` — yagona choke point: demo hisob harakatidan real
  foydalanuvchiga bildirishnoma **hech qachon** yetib bormaydi
- Demo hisob ommaviy foydalanuvchi qidiruvida ko'rinmaydi
- Admin statistikasi va analitikasidan chiqarilgan
- `isReviewAccount` / `isReviewData` maydonlari JSON'da **hech qachon**
  serializatsiya qilinmaydi (`json:"-"`) — klient review rejimi borligini
  bilib ham qolmaydi

### ⚠️ Tasdiqlangandan keyin IKKALASI ham shart

1. `REVIEW_LOGIN_ENABLED=false` (+ `REVIEW_LOGIN_CODE` ni tozalash) — yangi
   sessiya ochilmaydi
2. `reviewaccount close` — hisobni bloklaydi

Faqat birinchisi yetarli emas: access token TTL 15 kun. Hisob bloklanganda esa
`RequireActiveUser` mavjud sessiyani darhol rad etadi.

Oyna `REVIEW_LOGIN_EXPIRES_AT` da o'zi ham yopiladi (maksimum 30 kun, tavsiya
7 kun) — kimdir unutsa ham backdoor ochiq qolmaydi. Muddat o'tishi serverni
yiqitmaydi, faqat login inert bo'ladi.

**Eslatma:** web frontend ham (`ishchibormi.uz/login`) shu endpoint'dan
foydalanadi, ya'ni kod u yerda ham ishlaydi. Hisob bir xil cheklangan bo'lgani
uchun bu xavf tug'dirmaydi.

**Eslatma:** review oynasi ochiq paytda **deploy qilmang** — CI har deployda
`REVIEW_LOGIN_ENABLED=false` qiladi va reviewer kirolmay qoladi.

---

## 7. Topshirish tartibi — qat'iy ketma-ketlik

> **Eng muhim saboq (2026-07-19 auditi):** repoda hamma narsa to'g'ri bo'lishi
> mumkin, lekin Google faqat **serverda turgan** narsani ko'radi. O'sha auditda
> uchala bloker ham aynan shu farqdan kelib chiqqan edi — kod to'g'ri, deploy
> eski. Shuning uchun quyidagi tartibda va **tekshirib** boring.

### 1-qadam — deploy

Production repo holatiga chiqishi kerak. Frontend **va** backend.

### 2-qadam — jonli tekshiruv (avtomatlashtirilgan)

```bash
bash Web/scripts/play-preflight.sh
```

18 ta tekshiruv: majburiy sahifalar 200 qaytaradimi, jonli maxfiylik siyosati
Data Safety deklaratsiyasidagi har bir atamani o'z ichiga oladimi, sitemap,
robots, HTTPS, va dev endpoint'lari yopiqmi.

**Bitta ham FAIL qolsa — topshirmang.** Skript repo build'iga qarshi 18/18
o'tishi tasdiqlangan, ya'ni FAIL chiqsa bu deploy muammosi.

### 3-qadam — review login

```bash
docker compose exec backend /app/reviewaccount create   # faqat birinchi marta
docker compose exec backend /app/reviewaccount open
```

Chiqqan `.env` blokini serverga qo'ying, backendni restart qiling, so'ng
`reviewaccount status` bilan `ACTIVE` ekanini tasdiqlang.

### 4-qadam — qo'lda sinov (o'tkazib yubormang)

**Toza qurilmada, mobil internetda** (o'z Wi-Fi'ingizda emas — Play reviewer
boshqa mamlakatdan kiradi):

1. Ilovani oching → Telegram tugmasini **bosmang** → kodni kiriting → kirdingizmi?
2. E'lon joylang → "Mening e'lonlarim" da ko'rinadimi?
3. Biror e'longa ariza yuboring → "Arizalarim" da ko'rinadimi?
4. Profilni tahrirlang → saqlanadimi?

### 5-qadam — Play Console maydonlari

**App access** → "All or some functionality is restricted":

| Maydon | Qiymat |
|---|---|
| Username | `+998000000000` (yoki `reviewaccount open` ko'rsatgani) |
| Password | `reviewaccount open` bergan 6 xonali kod |

Instructions (nusxa oling):

```
The app uses Telegram-based OTP login, which reviewers cannot complete.
A dedicated demo account is provided instead.

1. Open the app and continue past onboarding.
2. On the login screen, do NOT tap the "Open Telegram bot" button.
3. Type the 6-digit code from the Password field directly into the code
   input, then continue.

You will be signed in to a demo account with full access to browsing,
posting a job, applying to a job, and editing the profile.

Some actions are disabled on this demo account to keep it reusable for
future reviews: image upload, account deletion, reporting and blocking
other users. Account deletion can be reviewed at
https://ishchibormi.uz/delete-account (publicly accessible, no login).
```

**Data safety** → 5-bo'limdagi jadval.
**Privacy policy URL** → `https://ishchibormi.uz/maxfiylik-siyosati`
**Data deletion URL** → `https://ishchibormi.uz/delete-account`

### 6-qadam — tasdiqlangandan keyin

```bash
docker compose exec backend /app/reviewaccount close
```
va `.env` da `REVIEW_LOGIN_ENABLED=false` + `REVIEW_LOGIN_CODE=` (bo'sh).
**Ikkalasi ham shart** — sabab 6-bo'limda.

---

## 8. Hali hal qilinmagan / e'tibor talab qiladigan

- **`Ishchi_Bormi_API_Hujjati.docx`** va Flutter'dagi ishlatilmayotgan data
  qatlamlari (`features/chat/`, `features/finance/`) serveri yo'q funksiyalarni
  tasvirlaydi. Kod ishlamaydi, lekin chalg'itadi — tozalash tavsiya etiladi.
- **iOS:** `NSAppTransportSecurity.NSAllowsArbitraryLoads=true` hali ham
  `Info.plist` da (lokal HTTP backend uchun). App Store'ga topshirishdan oldin
  olib tashlash yoki asoslash kerak. Google Play'ga ta'sir qilmaydi.
- **iOS:** `image_picker_ios` binarida kamera kodi bo'lgani uchun App Store
  statik tahlili `NSCameraUsageDescription` yo'qligini ogohlantirish sifatida
  belgilashi mumkin (ITMS-90683). Android'ga aloqasi yo'q; iOS relizi
  rejalashtirilsa qayta ko'rib chiqiladi.
