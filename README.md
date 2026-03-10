# 📚 StudyVibe — Free Education Platform

UPSC, JEE, NEET, SSC, IBPS ke liye free video platform!

## 🚀 Setup

```bash
cd studyvibe
npm install
npm start
```

- 🌐 Website: http://localhost:3000
- ⚙️ Admin: http://localhost:3000/admin.html

## ▶️ Playlist Add Karna

`playlists.js` mein sirf yeh add karo:

```js
{ playlistId: "PLxxxxxx", category: "JEE", label: "JEE Physics by PW" }
```

**Playlist ID kaise dhundein:**
YouTube playlist → URL mein `?list=` ke baad wala copy karo

**Categories:** `UPSC` | `JEE` | `NEET` | `SSC` | `IBPS`

## 🔄 Auto-Sync
Server start hote hi sync hota hai, phir har 6 ghante automatically!

## ⚙️ Admin Panel
`/admin.html` se manually bhi sync kar sakte ho!
