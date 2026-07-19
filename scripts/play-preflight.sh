#!/usr/bin/env bash
# Google Play topshirishdan oldingi JONLI tekshiruv.
#
# Bu skript repoga emas, PRODUCTION'ga qaraydi. Sababi oddiy: repoda hamma narsa
# to'g'ri bo'lishi mumkin, lekin Google faqat serverda turgan narsani ko'radi.
# Aynan shu farq 2026-07-19 auditida uchta bloker bergan edi.
#
# Ishlatish:
#   bash Web/scripts/play-preflight.sh
#
# Hamma tekshiruv PASS bo'lmaguncha Play Console'ga topshirmang.

set -uo pipefail

SITE="${SITE:-https://ishchibormi.uz}"
API="${API:-https://api.ishchibormi.uz}"

pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

code_for() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null; }
body_of()  { curl -sL --max-time 20 "$1" 2>/dev/null; }

# ---------------------------------------------------------------------------
head_ "1. Majburiy ochiq sahifalar (Google bularni bosadi)"
# ---------------------------------------------------------------------------
for path in /delete-account /maxfiylik-siyosati /foydalanish-shartlari; do
  c=$(code_for "$SITE$path")
  if [ "$c" = "200" ]; then ok "$path -> 200"; else bad "$path -> $c (200 bo'lishi SHART)"; fi
done

c=$(code_for "$API/healthz")
if [ "$c" = "200" ]; then ok "api /healthz -> 200"; else bad "api /healthz -> $c"; fi

# ---------------------------------------------------------------------------
head_ "2. Jonli maxfiylik siyosati Data Safety bilan mos kelishi"
# ---------------------------------------------------------------------------
# Har bir atama Play Console'dagi Data safety deklaratsiyasining bir qatoriga
# to'g'ri keladi. Biri yo'q bo'lsa — deklaratsiya bilan siyosat ziddiyatga
# kiradi, bu esa rad etishning eng ko'p uchraydigan sabablaridan biri.
policy=$(body_of "$SITE/maxfiylik-siyosati")
if [ -z "$policy" ]; then
  bad "maxfiylik siyosatini o'qib bo'lmadi — qolgan tekshiruvlar o'tkazib yuborildi"
else
  while IFS='|' read -r needle label; do
    if printf '%s' "$policy" | grep -qi -- "$needle"; then
      ok "siyosatda bor: $label"
    else
      bad "siyosatda YO'Q: $label  (qidirildi: '$needle')"
    fi
  done <<'TERMS'
90|90 kunlik saqlash muddati
butunlay|butunlay o'chirish
aniq joylashuv|aniq joylashuv (precise location)
ACCESS_FINE_LOCATION|ACCESS_FINE_LOCATION ruxsati
Nominatim|Nominatim uzatmasi
OpenStreetMap|OpenStreetMap
ovozli|ovozli xabar (voice recordings)
file ID|fayl identifikatori (file ID)
username|Telegram username
llab-quvvatlash|qo'llab-quvvatlash boti
TERMS
fi

# ---------------------------------------------------------------------------
head_ "3. Indekslanish va sitemap"
# ---------------------------------------------------------------------------
robots=$(body_of "$SITE/robots.txt")
if printf '%s' "$robots" | grep -qi "disallow.*delete-account"; then
  bad "robots.txt /delete-account ni bloklayapti — u ochiq bo'lishi SHART"
else
  ok "robots.txt /delete-account ni bloklamayapti"
fi

# /sitemap.xml — bu INDEX: u haqiqiy URL'larni emas, bo'laklarga havolani
# qaytaradi. Shuning uchun har bir bo'lakni ham ochib ko'ramiz.
sitemap=$(body_of "$SITE/sitemap.xml")
sitemap_all="$sitemap"
while read -r chunk; do
  [ -n "$chunk" ] || continue
  # Index absolyut prod URL'larini qaytaradi; SITE boshqa bo'lsa (lokal sinov)
  # xostni almashtiramiz, aks holda lokal build'ni tekshirib bo'lmaydi.
  local_chunk="${chunk/https:\/\/ishchibormi.uz/$SITE}"
  sitemap_all="$sitemap_all$(body_of "$local_chunk")"
done < <(printf '%s' "$sitemap" | grep -o '<loc>[^<]*</loc>' | sed 's/<[^>]*>//g')

if printf '%s' "$sitemap_all" | grep -q "delete-account"; then
  ok "sitemap da /delete-account bor"
else
  bad "sitemap da /delete-account yo'q"
fi

# ---------------------------------------------------------------------------
head_ "4. HTTPS"
# ---------------------------------------------------------------------------
redir=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://ishchibormi.uz/maxfiylik-siyosati" 2>/dev/null)
case "$redir" in
  30*|200) ok "http -> https ishlayapti ($redir)" ;;
  *)       bad "http so'rovi kutilmagan javob berdi: $redir" ;;
esac

# ---------------------------------------------------------------------------
head_ "5. Dev qoldiqlari production'da ochiq emasligi"
# ---------------------------------------------------------------------------
# OTP peek dev-only. Prod'da 404 qaytarishi shart, aks holda tasdiqlash
# kodlari API orqali oshkor bo'ladi.
c=$(code_for "$API/api/auth/otp/peek?token=preflight")
if [ "$c" = "404" ]; then
  ok "/auth/otp/peek prod'da o'chiq (404)"
else
  bad "/auth/otp/peek $c qaytardi — OTP_DEV_RETURN=false ekanini tekshiring"
fi

# ---------------------------------------------------------------------------
printf '\n\033[1mNATIJA:\033[0m %d pass, %d fail\n' "$pass" "$fail"
if [ "$fail" -gt 0 ]; then
  printf '\033[31mTOPSHIRMANG.\033[0m Yuqoridagi FAIL larni tuzatib, qayta ishga tushiring.\n'
  exit 1
fi
printf '\033[32mJonli tekshiruvlar toza.\033[0m Endi review login ni qo'"'"'lda sinang:\n'
printf '  1) reviewaccount open  -> .env -> restart\n'
printf '  2) toza qurilmada, MOBIL INTERNETDA (o'"'"'z Wi-Fi da emas) kod bilan kiring\n'
printf '  3) e'"'"'lon joylang, ariza yuboring, profilni tahrirlang\n'
