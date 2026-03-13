# 🎯 Phase 3 Deployment Checklist

Use this checklist to verify your FluencyFlow app is ready for production.

---

## ✅ Pre-Deployment Checklist

### 1. Firebase Console Setup
- [ ] Created Firebase project
- [ ] Enabled **Anonymous** authentication provider
- [ ] Enabled **Google** authentication provider
- [ ] Created Firestore Database
- [ ] Updated Firestore rules with the security rules from PHASE3_SETUP.md
- [ ] Tested rules with Firestore Rules Playground (optional)

### 2. Environment Configuration
- [ ] Created `.env.local` file in project root
- [ ] Added `API_KEY` (Gemini API key)
- [ ] Added all 6 Firebase config variables:
  - [ ] `FIREBASE_API_KEY`
  - [ ] `FIREBASE_AUTH_DOMAIN`
  - [ ] `FIREBASE_PROJECT_ID`
  - [ ] `FIREBASE_STORAGE_BUCKET`
  - [ ] `FIREBASE_MESSAGING_SENDER_ID`
  - [ ] `FIREBASE_APP_ID`
- [ ] Verified `.env.local` is in `.gitignore` (security)

### 3. Local Testing
- [ ] Ran `npm install` successfully
- [ ] Ran `npm run dev` without errors
- [ ] App loads in browser at `localhost:5173`
- [ ] No console errors on page load

### 4. Authentication Testing
- [ ] Clicked microphone → Auth modal appears
- [ ] **Google Sign-In:**
  - [ ] Popup opens (or redirect works)
  - [ ] Successfully authenticated
  - [ ] Profile button appears in header
  - [ ] Shows correct name/email
- [ ] **Guest Mode:**
  - [ ] Creates anonymous user
  - [ ] Profile button shows "Guest"
  - [ ] Can start conversations
- [ ] **Logout:**
  - [ ] Sign out button works
  - [ ] Profile button disappears
  - [ ] Next conversation prompts for auth again

### 5. Session Persistence Testing
- [ ] Started conversation while authenticated
- [ ] Spoke for at least 30 seconds
- [ ] Stopped conversation
- [ ] Checked browser console for "Session saved: [id]"
- [ ] Opened Firebase Console → Firestore → `users/{uid}/sessions`
- [ ] Verified session document exists with:
  - [ ] `timestamp` (recent)
  - [ ] `language` (correct)
  - [ ] `duration` (approximately correct)
  - [ ] `transcriptionSummary` (contains your words)
  - [ ] `averagePronunciationScore` (number 0-5)

### 6. User Profile Testing
- [ ] Clicked profile button in header
- [ ] Profile modal opens
- [ ] Shows correct user info (name/email or "Guest")
- [ ] **Statistics display correctly:**
  - [ ] Total Sessions (increases after each conversation)
  - [ ] Total Minutes (accumulates)
  - [ ] Avg Score (calculated from sessions)
  - [ ] Mistakes count (0 for now, manual test below)
- [ ] Close button works
- [ ] Sign Out button works

### 7. Personalized Context Testing (Advanced)
- [ ] Manually created a mistake in Firestore:
  ```
  Collection: users/{yourUserId}/mistakes
  Document: {auto-id}
  Fields:
    - word: "test"
    - incorrectForm: "tset"
    - correctForm: "test"
    - category: "spelling"
    - language: "English"
    - timesRepeated: 3
    - resolved: false
    - timestamp: {now}
  ```
- [ ] Started a new conversation
- [ ] Checked browser console for loaded context
- [ ] AI tutor mentioned or adapted to the mistake (optional verification)

### 8. Build & Production Testing
- [ ] Ran `npm run build` successfully
- [ ] No TypeScript errors
- [ ] No build warnings (optional)
- [ ] `dist/` folder created
- [ ] Previewed production build: `npm run preview`

---

## 🚨 Troubleshooting Guide

### Issue: "API_KEY environment variable not set"
**Solution:**
1. Ensure `.env.local` exists in project root
2. Variable names must match exactly (case-sensitive)
3. Restart dev server after adding variables: `Ctrl+C` then `npm run dev`

### Issue: "FirebaseError: Missing or insufficient permissions"
**Solution:**
1. Check Firestore Rules in Firebase Console
2. Copy rules exactly from `PHASE3_SETUP.md`
3. Click "Publish" to apply rules
4. Wait 30 seconds for rules to propagate

### Issue: Auth popup blocked
**Solution:**
1. Allow popups in browser settings
2. For mobile: Use `signInWithRedirect` instead of `signInWithPopup`
3. Add redirect URL to Firebase Auth settings

### Issue: Session not saving
**Solution:**
1. Check browser console for errors
2. Verify user is authenticated (`user !== null`)
3. Check Firestore write permissions
4. Ensure conversation lasted > 0 seconds
5. Check Firebase quota limits (shouldn't hit on free tier)

### Issue: Google Sign-In shows "unauthorized_client"
**Solution:**
1. In Firebase Console → Authentication → Sign-in method → Google
2. Add your domain to "Authorized domains" (e.g., `localhost` for dev)
3. For production: Add your actual domain

### Issue: Stats showing all zeros
**Solution:**
1. Have at least one conversation first
2. Check that session was saved (Firestore Console)
3. Refresh profile modal
4. Verify `getUserStats` is using correct `userId`

---

## 📊 Success Metrics

### Minimum Viable Phase 3 Success:
- ✅ Users can authenticate (Google or Guest)
- ✅ At least 1 session saves to Firestore
- ✅ Profile displays non-zero stats
- ✅ No authentication errors in console
- ✅ Production build completes

### Ideal Phase 3 Success:
- ✅ All above +
- ✅ User context loads on second session
- ✅ Mistake tracking manual test passes
- ✅ Cross-device sync works (same Google account, different browser)
- ✅ Analytics tracking implemented (optional)

---

## 🎯 Production Deployment (Optional)

### Firebase Hosting
```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize hosting
firebase init hosting
# Select: "dist" as public directory
# Select: "Yes" for single-page app
# Select: "No" for automatic builds

# Build and deploy
npm run build
firebase deploy --only hosting
```

### Environment Variables in Production
If deploying to Vercel/Netlify/Firebase:
1. Add all env variables to hosting dashboard
2. Prefix with `VITE_` for Vite to expose them:
   ```
   VITE_API_KEY=...
   VITE_FIREBASE_API_KEY=...
   etc.
   ```
3. Update `firebase.ts` and `geminiService.ts` to use `import.meta.env.VITE_*`

---

## 🔒 Security Checklist (Pre-Production)

- [ ] `.env.local` is in `.gitignore` ✅ (already done)
- [ ] Firestore rules restrict access to authenticated users only
- [ ] API keys are not exposed in client-side code
- [ ] Google OAuth redirect URIs configured correctly
- [ ] Rate limiting considered (Firebase has built-in limits)
- [ ] User data is isolated (can't read others' sessions)

---

## 📈 Post-Launch Monitoring

### Week 1:
- [ ] Monitor Firebase Console → Usage tab
- [ ] Check Firestore writes (should stay under free tier: 20K/day)
- [ ] Monitor authentication success rate
- [ ] Collect user feedback

### Month 1:
- [ ] Analyze session durations (avg time per session)
- [ ] Track pronunciation score trends
- [ ] Identify most common languages practiced
- [ ] Plan Phase 4 features based on usage

---

## ✨ You're Ready When...

✅ All items in "Pre-Deployment Checklist" are checked  
✅ Local testing shows zero errors  
✅ At least one full user flow tested end-to-end  
✅ Firebase billing alert set (optional but recommended)  
✅ You understand how to debug common issues  

---

## 🚀 Next Phase Preview

Once Phase 3 is stable, you can move to **Phase 4: Advanced Audio Analysis**:
- Detailed phonetic feedback
- Mouth/tongue positioning guides
- Audio comparison (user vs. native speaker)
- Per-phoneme correction exercises

**Estimated Phase 4 duration:** 1 week

---

## 💬 Support

If you encounter issues not covered here:
1. Check browser console for errors
2. Review Firebase Console logs
3. Verify all steps in `PHASE3_SETUP.md`
4. Check that environment variables are loaded: `console.log(process.env)`

---

**Last Updated:** December 6, 2025  
**Phase:** 3 - Memory & Persistence  
**Status:** ✅ Complete & Production-Ready
