# Togg CarPlay (web)

## Railway'e kurulum
1. Klasörü GitHub'a gönderin (`git init && git add . && git commit -m init`, sonra repoya push).
2. railway.com → **New Project → Deploy from GitHub repo** → bu repoyu seçin.
3. Servis → **Settings → Networking → Generate Domain** (HTTPS adresi verir).
4. (İsteğe bağlı) Variables: `PUBLIC_URL=https://<alan-adiniz>.up.railway.app`
5. Araç tarayıcısında bu adresi açın, iPhone ile karekodu okutun.

Alternatif CLI: `railway login && railway init && railway up && railway domain`

Yerel çalıştırma: `npm install && npm start` → http://localhost:3000
