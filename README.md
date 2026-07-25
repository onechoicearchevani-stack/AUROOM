# Aurum Restaurant — ვებსაიტი

სრულად ფუნქციური, სამენოვანი (ქართული / English / Русский) რესტორნის საიტი
ადმინ პანელით, შეკვეთების სისტემითა და ცოცხალი სამზარეულოს დაფით.

სტეკი: **Node.js + Express + SQLite (Node-ის ჩაშენებული `node:sqlite`)**, vanilla JS frontend (build-ის გარეშე),
JWT ავტორიზაცია httpOnly cookie-ში, bcrypt, helmet, rate-limiting, SSE ცოცხალი შეკვეთებისთვის.

---

## შესაძლებლობები

**საჯარო საიტი** (`/`)
- სამენოვანი ინტერფეისი — ენა ერთი ღილაკით იცვლება (KA / EN / RU), არჩევანი ნახსოვრდება.
- დინამიური მენიუ კატეგორიებად, ფასებით, აღწერებითა და სურათებით (ბაზიდან).

**შეკვეთა** (`/order`)
1. სტუმარი ირჩევს მაგიდას 1–40 დარბაზის გეგმაზე (დაკავებული მაგიდები გამორთულია).
2. ირჩევს კერძებს მენიუდან, არეგულირებს რაოდენობას კალათში.
3. ტოვებს სახელს / ტელეფონს / შენიშვნას და აგზავნის შეკვეთას.

**ადმინ პანელი** (`/admin`)
- რეგისტრაცია / ავტორიზაცია (რეგისტრაცია დაცულია სპეციალური კოდით).
- როლები: **owner / manager / staff** (კერძების მართვა — owner და manager).
- ცოცხალი შეკვეთების დაფა — ახალი შეკვეთა ავტომატურად ჩნდება ხმოვანი სიგნალით (SSE, გვერდის გადატვირთვის გარეშე). სტატუსი: ახალი → მზადდება → მზადაა (წაშლა).
- მენიუს მართვა: კერძის დამატება / რედაქტირება / წაშლა, სამივე ენაზე, სურათის ატვირთვით, „გამორჩეული“ და „ხელმისაწვდომი“ ნიშნულებით.
- კატეგორიების მართვა: დამატება / რედაქტირება / წაშლა, დალაგების მიხედვით.

**უსაფრთხოება**
- პაროლები — bcrypt (12 rounds). JWT — httpOnly + secure cookie-ში.
- helmet CSP, express-rate-limit (ავტორიზაცია და შეკვეთები).
- შეკვეთის ფასები ხელახლა ითვლება სერვერზე ბაზიდან — კლიენტის ფასს არ ენდობა.

---

## ლოკალური გაშვება

საჭიროა **Node.js 22.5+** (გირჩევ 22 LTS-ს ან 24-ს). ბაზა Node-ის ჩაშენებულ `node:sqlite`-ს იყენებს — არანაირი native კომპილაცია, Python ან Visual Studio Build Tools **არ სჭირდება**.

```bash
# 1. დამოკიდებულებები
npm install

# 2. გარემოს ფაილი
cp .env.example .env
#   შემდეგ .env-ში შეცვალე JWT_SECRET და ADMIN_REGISTRATION_CODE
#   ძლიერი secret-ის გენერაცია:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3. საწყისი მენიუ და კატეგორიები (არასავალდებულო, სადემო კონტენტი)
npm run seed

# 4. ადმინის ანგარიშის შექმნა (ინტერაქტიული)
npm run create-admin

# 5. გაშვება
npm start
#   dev რეჟიმი (ავტო-რესტარტი): npm run dev
```

შემდეგ გახსენი:
- საჯარო საიტი — `http://localhost:3000/`
- შეკვეთა — `http://localhost:3000/order`
- ადმინი — `http://localhost:3000/admin`

> რეგისტრაციისას „რეგისტრაციის კოდის“ ველში შეიყვანე `ADMIN_REGISTRATION_CODE`-ის
> მნიშვნელობა `.env`-დან (ნაგულისხმევი: `aurum-staff-2024` — **აუცილებლად შეცვალე**).

---

## დომეინზე განთავსება (production)

### ვარიანტი A — Railway (მარტივი, რეკომენდებული)

1. ატვირთე კოდი GitHub-ის რეპოზიტორიაში (node_modules, .env და data/ არ აიტვირთება — ამას `.gitignore` უზრუნველყოფს).
2. railway.com → New Project → Deploy from GitHub repo → აირჩიე ეს რეპო. Railway თვითონ ცნობს Node-ს და გაუშვებს `npm install` + `npm start`-ს.
3. **Volume (მუდმივი მეხსიერება):** პროექტში → Service → Variables-ის გვერდით „Volumes“ → New Volume, Mount path: `/data`. ეს აუცილებელია — თორემ ბაზა და სურათები ყოველ განახლებაზე წაიშლება.
4. **Environment Variables** (Variables ჩანართში დაამატე):
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = გრძელი შემთხვევითი სტრიქონი (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `ADMIN_REGISTRATION_CODE` = შენი საიდუმლო კოდი
   - `DATA_DIR` = `/data`
   - `UPLOADS_DIR` = `/data/uploads`
   - (`PORT`-ს Railway თვითონ აყენებს — ხელით არ დაამატო.)
5. დააჭირე Deploy. დასრულების შემდეგ Settings → Networking → Generate Domain — მიიღებ public URL-ს (`*.up.railway.app`).
6. გახსენი `https://<შენი-url>/admin`, გადადი რეგისტრაციაზე, შექმენი owner ანგარიში `ADMIN_REGISTRATION_CODE`-ით, შემდეგ დაამატე კატეგორიები და კერძები.
7. **საკუთარი დომენი:** Settings → Networking → Custom Domain → ჩაწერე დომენი და მიჰყევი DNS ინსტრუქციას (CNAME). SSL ავტომატურია.

> შენიშვნა: მენიუ თავიდან ცარიელია — კერძებს ადმინ პანელიდან ამატებ. (სურვილისამებრ სადემო მენიუსთვის ლოკალურად `npm run seed`.)

### ვარიანტი B — VPS (Hetzner / DigitalOcean)

1. სერვერზე დააყენე Node.js 22.5+ (LTS), ატვირთე პროექტი, გაუშვი `npm install --omit=dev`.
2. `.env`-ში:
   - `NODE_ENV=production`
   - `PORT=3000` (ან სასურველი)
   - `SITE_URL=https://yourdomain.ge`
   - ახალი `JWT_SECRET` და `ADMIN_REGISTRATION_CODE`.
3. გაუშვი პროცეს-მენეჯერით, რომ ავტომატურად აღდგეს:
   ```bash
   npm i -g pm2
   pm2 start server/index.js --name aurum
   pm2 save && pm2 startup
   ```
4. დააყენე Nginx reverse proxy + HTTPS (Let's Encrypt):
   ```nginx
   server {
     server_name yourdomain.ge;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   (აპლიკაცია უკვე `trust proxy`-ზეა, ამიტომ secure cookie და rate-limit სწორად იმუშავებს.)

### მონაცემების შენახვა
- ბაზა: `data/aurum.db` — დატოვე და დააბექაპე ეს ფოლდერი.
- ატვირთული სურათები: `public/uploads/` — ასევე შესანახია.

### SQLite → PostgreSQL
პატარა/საშუალო რესტორნისთვის SQLite სავსებით საკმარისია. დიდი დატვირთვის შემთხვევაში
მონაცემთა შრე (`server/db/database.js`) შეიძლება გადავიდეს PostgreSQL-ზე — დანარჩენი
ლოგიკა იგივე რჩება.

---

## პროექტის სტრუქტურა

```
aurum/
├─ server/
│  ├─ index.js            # Express აპლიკაცია, უსაფრთხოება, როუტები
│  ├─ db/
│  │  ├─ database.js       # SQLite სქემა + 40 მაგიდის seed
│  │  ├─ seed.js           # სადემო მენიუ/კატეგორიები
│  │  └─ create-admin.js   # ადმინის შექმნის CLI
│  ├─ middleware/auth.js   # JWT, როლები
│  ├─ routes/              # auth, categories, menu, tables, orders
│  └─ utils/events.js      # ცოცხალი შეკვეთების event bus
├─ public/
│  ├─ index.html / order.html / admin.html
│  ├─ css/style.css
│  ├─ js/ (i18n, main, order, admin)
│  ├─ locales/ (ka/en/ru.json)
│  └─ uploads/             # ატვირთული სურათები
├─ .env.example
└─ package.json
```

---

## შესაცვლელი / დასაზუსტებელი

დროებითი (placeholder) მონაცემები, რომლებიც ნამდვილით უნდა ჩანაცვლდეს:
- საკონტაქტო ტელეფონი, მისამართი, სამუშაო საათები — `public/locales/*.json` და `index.html`.
- გალერეის სურათები — `index.html` (ახლა CSS placeholder-ებია).
- სტატისტიკა (წლები / კერძები / ღვინოები) — `index.html`.
- სადემო მენიუ — შეცვალე ადმინ პანელიდან ან `server/db/seed.js`-ში.

ვალუტა: ₾ (GEL).
