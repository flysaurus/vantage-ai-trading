# Vantage E2E Test Checklist

> **Last verified deploy:** `cdba98c` — 2026-06-25 22:43
> **Production URL:** `https://vantage-ai-trading.vercel.app`
> **Alias → canonical:** 308 redirect confirmed ✅

---

## ✅ Automated (Verified via Playwright Headless Chromium)

These pass every deploy. No human needed.

| # | Test | Cmd | Status |
|---|------|-----|--------|
| A1 | All 7 routes return 200 | `curl -sL -o /dev/null -w "%{http_code}" $URL` | ✅ |
| A2 | Onboarding renders at `/` | Playwright innerText check | ✅ |
| A3 | Login form renders at `/login` | Playwright innerText check | ✅ |
| A4 | Forgot password renders at `/auth/forgot-password` | Playwright innerText check | ✅ |
| A5 | Reset password renders at `/auth/reset` | Playwright innerText check | ✅ |
| A6 | Create-account redirects to onboarding (no data) | Playwright URL check | ✅ |
| A7 | Alias 308→canonical | `curl -sI $ALIAS` | ✅ |
| A8 | React #310 — zero hook errors | Playwright console listener | ✅ |
| A9 | CSP — no Google Fonts blocks | Playwright console listener | ✅ |
| A10 | `tsc --noEmit` → 0 errors | `npx tsc --noEmit` | ✅ |
| A11 | `npm run build` → passes | `npx next build` | ✅ |

Run script: `xvfb-run node /tmp/e2e-v2.cjs` (requires Playwright + Chromium)

---

## 🖐️ Manual (Requires Human + Browser)

### TEST A — New User Full Onboarding

**Setup:** Open fresh incognito/private window.

| Step | Action | Expected Result |
|------|--------|-----------------|
| A.1 | Navigate to `https://vantage-ai-trading.vercel.app` | Boot splash (Vantage orb, "VANTAGE", 1.5s) |
| A.2 | Wait for transition | Feature splash (3 slides with progress bar) |
| A.3 | Wait / tap through | Arrival screen ("Find my style" CTA) |
| A.4 | Tap "Find my style →" | Quiz Q1 — "HOW YOU THINK · 1 OF 5" |
| A.5 | Tap any answer card on Q1 | Advances to Q2 |
| A.6 | Complete Q2–Q5 | Answer cards stack vertically, progress bar fills |
| A.7 | After Q5 | Name capture screen ("What should we call you?") |
| A.8 | Enter first name + last name | Inputs accept text |
| A.9 | Tap "See my results →" | Style reveal (emoji burst, typewriter headline, trait name, risk badge) |
| A.10 | Verify style matches answers | Cross-reference with quiz scoring logic in `lib/onboarding/quiz-logic.ts` |
| A.11 | Tap override pill | Toast: "Updated to [Style]" — headline/description update |
| A.12 | Tap "Create your account →" | Create account page with name + style pre-filled |
| A.13 | Enter email, password, confirm password | Strength meter animates, requirements check off |
| A.14 | Tap password eye toggle | Password text reveals/hides |
| A.15 | Tap "Create account →" | Lands on Portfolio tab (MainApp) |
| A.16 | Check PlayerStatusBar | Shows correct investor style trait name |
| A.17 | Check greeting | Uses first name |
| A.18 | Check Supabase | `user_profiles` row exists with all fields (id, email, first_name, last_name, investor_style, risk, created_at) |

### TEST B — Returning User

**Setup:** Use same email from Test A (already signed in).

| Step | Action | Expected Result |
|------|--------|-----------------|
| B.1 | Navigate to `https://vantage-ai-trading.vercel.app` | Boot splash (1.5s) |
| B.2 | After boot | Lands on Portfolio tab (MainApp) |
| B.3 | Verify | NO quiz, NO onboarding screens |
| B.4 | Check PlayerStatusBar | Correct style displayed |

### TEST C — Wrong Password

| Step | Action | Expected Result |
|------|--------|-----------------|
| C.1 | Navigate to `/login` | Login form visible |
| C.2 | Enter correct email, wrong password | Form accepts input |
| C.3 | Tap "Sign in" | Red banner: "Incorrect email or password." |
| C.4 | Check password field | Cleared |
| C.5 | Check email field | Still filled (not cleared) |

### TEST D — Forgot Password Flow

| Step | Action | Expected Result |
|------|--------|-----------------|
| D.1 | Navigate to `/login` | Login form visible |
| D.2 | Tap "Forgot password?" | Navigates to `/auth/forgot-password` |
| D.3 | See form | "Reset your password." headline, email input, "Send reset link" CTA |
| D.4 | Enter email, tap "Send reset link" | Transitions to "Check your inbox." state (mail icon, email shown, spam note, resend button with 60s cooldown) |
| D.5 | Check inbox | Email received with branded content + reset link |
| D.6 | Click reset link | Navigates to `/auth/reset?code=...` |
| D.7 | See form | "Choose a new password." headline, new password + confirm inputs, strength meter |
| D.8 | Enter new password + confirm | Strength meter works, match indicator shows ✓ |
| D.9 | Tap "Update password" | "Password updated." success state with CheckCircle |
| D.10 | Wait 2 seconds | Auto-redirects to main app (Portfolio tab) |

### TEST E — React #310

**Setup:** Open DevTools Console before starting ANY test.

| Step | Action | Expected Result |
|------|--------|-----------------|
| E.1 | Watch console during Tests A–D | ZERO instances of "Minified React error #310" |
| E.2 | Watch console during Tests A–D | ZERO instances of "Rendered more hooks than during the previous render" |
| E.3 | Watch console during Tests A–D | ZERO React hook warnings of any kind |

### TEST F — Alias Domain Redirect

| Step | Action | Expected Result |
|------|--------|-----------------|
| F.1 | Navigate to `https://vantage-ai-trading-flysaurus-projects.vercel.app` | Browser redirected to `https://vantage-ai-trading.vercel.app` |
| F.2 | Check app loads | App functions normally on canonical domain |

### TEST G — Create Account Edge Cases

| Step | Action | Expected Result |
|------|--------|-----------------|
| G.1 | Leave all fields empty, tap "Create account" | Button disabled, nothing happens |
| G.2 | Enter invalid email (e.g. "notanemail") | Shows validation error on blur |
| G.3 | Enter mismatched passwords | Confirm field shows ✗ indicator |
| G.4 | Enter weak password | Strength meter shows "Weak" |
| G.5 | Enter existing email, submit | Error banner with "Sign in instead" link → `/login` |
| G.6 | Enter strong password + match | All 5 requirements check off, CTA enables |

### TEST H — Onboarding Back Navigation

| Step | Action | Expected Result |
|------|--------|-----------------|
| H.1 | During quiz, tap ← in top bar | Goes to previous question |
| H.2 | During NameCapture, tap ← | Goes back to Q5 |
| H.3 | During StyleReveal, tap "Back" | Goes back to NameCapture |
| H.4 | During ArrivalScreen, tap "I have an account ›" | Goes to `/login` |

---

## 🧪 Quick Smoke Check (After Every Deploy)

```bash
# Routes
for path in / /login /create-account /onboarding /auth/forgot-password /auth/reset /auth/complete; do
  echo "$path → $(curl -sL -o /dev/null -w '%{http_code}' https://vantage-ai-trading.vercel.app$path)"
done

# Alias redirect
curl -sI https://vantage-ai-trading-flysaurus-projects.vercel.app/ | grep -E "HTTP|location"

# Build
cd /root/.openclaw/workspace/projects/vantage && npx tsc --noEmit && npx next build

# Browser test
xvfb-run node /tmp/e2e-v2.cjs
```

---

## 📝 Maintenance Notes

- **Last human test run:** _not yet performed_
- **Playwright test script:** `/tmp/e2e-v2.cjs` (update when new routes/pages added)
- **AuthGuard PUBLIC_PATHS:** Must include all pre-auth routes. Current: `'/', '/onboarding', '/share', '/login', '/create-account', '/auth/forgot-password', '/auth/reset', '/auth/complete'`
- **Create-account redirect:** Page depends on `sessionStorage('vantage_onboarding_data')` — direct access without onboarding flow will redirect to `/onboarding`
- **Supabase project ref:** `ixjnuoslbzytubpplkot` — verify user_profiles table after Test A
