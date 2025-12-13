# 🚨 IMPORTANT: DEPLOYMENT INSTRUCTIONS

## ⚠️ You're Seeing Old Files!

The screenshot shows only 5 countries, which means you're looking at your **current deployed version**, NOT the new package.

---

## ✅ The New Package HAS All 7 Countries

Run this test to verify:
```bash
cd bretton-woods-complete
node test-countries.js
```

You should see:
```
✅ SUCCESS! All 7 countries present with economic data

1. ✅ USA
2. ✅ UK
3. ✅ USSR
4. ✅ France
5. ✅ China
6. ✅ India      ← PRESENT
7. ✅ Argentina  ← PRESENT
```

---

## 🚀 TO SEE ALL 7 COUNTRIES:

### Option 1: Deploy to Render

1. Extract `bretton-woods-complete.zip`
2. Upload ALL files to your Render deployment
3. **Make sure to replace:**
   - game-data.json (has 7 countries)
   - server.js (has all 7 in scores)
   - index.html (renders all countries)
4. Restart Render service
5. **Hard refresh browser:** Ctrl+Shift+R

### Option 2: Test Locally

```bash
# Extract package
unzip bretton-woods-complete.zip
cd bretton-woods-complete

# Verify countries
node test-countries.js

# Install and run
npm install
npm start

# Open browser
http://localhost:65002

# You should see all 7 countries!
```

---

## 🔍 Why Only 5 Countries Show?

Your **live site** at https://bretton.onrender.com is still running the **old version** from before.

The **new package** has all 7 countries, but you haven't deployed it yet.

---

## ✅ Proof All 7 Countries Are in Package:

### game-data.json contains:
```json
{
  "countries": {
    "USA": { ... },
    "UK": { ... },
    "USSR": { ... },
    "France": { ... },
    "China": { ... },
    "India": { "name": "India (British Raj)", "color": "bg-orange-600" },
    "Argentina": { "name": "Argentina", "color": "bg-cyan-600" }
  }
}
```

### server.js contains:
```javascript
scores: { USA: 0, UK: 0, USSR: 0, France: 0, China: 0, India: 0, Argentina: 0 }
```

### styles.css contains:
```css
--orange-600: #ea580c;  /* India */
--cyan-600: #0891b2;    /* Argentina */
```

---

## 📋 Deployment Checklist

- [ ] Extract bretton-woods-complete.zip
- [ ] Run `node test-countries.js` to verify
- [ ] Upload to Render (replace ALL files)
- [ ] Restart Render service
- [ ] Hard refresh browser (Ctrl+Shift+R)
- [ ] See all 7 countries in lobby

---

## 🎯 After Deployment

You will see in the lobby:

1. **United States** (blue)
2. **United Kingdom** (red)
3. **Soviet Union** (purple)
4. **France** (orange)
5. **China** (green)
6. **India (British Raj)** (orange) ← Will appear!
7. **Argentina** (cyan) ← Will appear!

---

## 💡 Pro Tip

Before deploying to Render, test locally first:
```bash
cd bretton-woods-complete
npm install
npm start
```

Visit http://localhost:65002 and verify you see all 7 countries.

Once confirmed locally, deploy to Render.

---

## ❓ Still Only See 5 Countries?

1. **Check you extracted the RIGHT zip:** bretton-woods-complete.zip
2. **Run the test:** `node test-countries.js`
3. **Clear browser cache:** Ctrl+Shift+R
4. **Check Render logs:** Make sure new files uploaded
5. **Try incognito mode:** Fresh browser session

---

The countries ARE in the package - you just need to deploy it!
