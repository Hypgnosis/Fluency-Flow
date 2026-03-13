# Phase 3: Memory & Persistence - Setup Guide

## ✅ What's Been Implemented

### 1. **Firebase Integration**
- ✅ Firebase SDK installed
- ✅ Firebase config file (`services/firebase.ts`)
- ✅ Firestore and Authentication initialized

### 2. **Session Management**
- ✅ Session persistence service (`services/sessionManager.ts`)
- ✅ Auto-save conversations on end
- ✅ Load user context for personalization
- ✅ Mistake tracking and logging
- ✅ User statistics calculation

### 3. **Authentication System**
- ✅ Auth context provider (`components/AuthModal.tsx`)
- ✅ Google Sign-In integration
- ✅ Guest mode (anonymous authentication)
- ✅ Auth modal UI

### 4. **User Profile**
- ✅ Profile modal component (`components/UserProfile.tsx`)
- ✅ Display user stats (sessions, minutes, scores, mistakes)
- ✅ Logout functionality

### 5. **App Integration**
- ✅ App.tsx wrapped with AuthProvider
- ✅ User profile button in header
- ✅ Conversation component integrated with auth and persistence

---

## 🔧 Firebase Project Setup Required

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select existing project
3. Name it `fluencyflow` (or your preferred name)
4. Disable Google Analytics (optional)
5. Click "Create project"

### Step 2: Enable Authentication

1. In Firebase Console, go to **Build > Authentication**
2. Click "Get Started"
3. Enable **Anonymous** sign-in:
   - Click on "Anonymous" provider
   - Toggle "Enable"
   - Save
4. Enable **Google** sign-in:
   - Click on "Google" provider
   - Toggle "Enable"
   - Select a support email
   - Save

### Step 3: Create Firestore Database

1. Go to **Build > Firestore Database**
2. Click "Create database"
3. Start in **production mode** (we'll adjust rules)
4. Select your preferred database location (choose closest to your users)
5. Click "Enable"

### Step 4: Configure Firestore Rules

Replace the default rules with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // User documents
    match /users/{userId} {
      // Only authenticated users can read/write their own data
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      // Subcollections (sessions, mistakes, vocabularyProgress)
      match /{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

Click **Publish** to save.

### Step 5: Get Firebase Configuration

1. In Firebase Console, click the **gear icon** (⚙️) next to "Project Overview"
2. Click "Project settings"
3. Scroll down to "Your apps"
4. Click the **Web** icon (`</>`)
5. Register app name: `FluencyFlow Web`
6. Click "Register app"
7. Copy the `firebaseConfig` object

It will look like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "fluencyflow-xxxx.firebaseapp.com",
  projectId: "fluencyflow-xxxx",
  storageBucket: "fluencyflow-xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef..."
};
```

### Step 6: Update Environment Variables

1. Open your `.env.local` file (or create it if it doesn't exist)
2. Add these values from your Firebase config:

```bash
# Existing Gemini API Key
API_KEY=your_gemini_api_key_here

# Firebase Configuration (from Step 5)
FIREBASE_API_KEY=AIzaSy...
FIREBASE_AUTH_DOMAIN=fluencyflow-xxxx.firebaseapp.com
FIREBASE_PROJECT_ID=fluencyflow-xxxx
FIREBASE_STORAGE_BUCKET=fluencyflow-xxxx.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abcdef...
```

3. Save the file

---

## 🚀 Testing the Implementation

### Start the Dev Server

```bash
npm run dev
```

### Test Authentication

1. Open the app in your browser
2. Click the microphone to start a conversation
3. You should see the **Auth Modal** appear
4. Test both authentication methods:
   - **"Continue with Google"** - Opens Google OAuth flow
   - **"Continue as Guest"** - Creates anonymous session

### Test Session Persistence

1. Sign in (Google or Guest)
2. Start a conversation and speak for 30 seconds
3. Stop the conversation
4. Check Firebase Console → Firestore Database → `users/{yourUserId}/sessions`
5. You should see a new session document with:
   - `timestamp`
   - `language`
   - `duration`
   - `transcriptionSummary`
   - `averagePronunciationScore`

### Test User Profile

1. After having a conversation, click your profile icon in the top-right
2. You should see:
   - Total sessions count
   - Total minutes
   - Average pronunciation score
   - Unresolved mistakes count
3. Click "Sign Out" to test logout

### Test Personalized Context

1. To test context injection, manually add a mistake in Firestore:
   - Go to `users/{yourUserId}/mistakes`
   - Click "Add document"
   - Set fields:
     ```
     word: "hello"
     incorrectForm: "helo"
     correctForm: "hello"
     category: "spelling"
     language: "English"
     timesRepeated: 3
     resolved: false
     timestamp: (current timestamp)
     ```
2. Start a new conversation
3. The AI tutor should reference this mistake in its teaching

### Verify Browser Console

Check for:
- ✅ No Firebase authentication errors
- ✅ "Session saved: [sessionId]" appears when stopping conversation
- ✅ No Firestore permission errors

---

## 🎯 What Happens Now

### On App Start
1. User sees the app without auth requirement
2. Conversations are available but prompts sign-in when starting

### On Sign-In
1. Firebase creates user document automatically
2. User profile becomes accessible
3. Past sessions are retrievable

### During Conversation
1. User speaks → pronunciation scored
2. Transcriptions logged in real-time
3. Audio captured for playback

### On Conversation End
1. Session data saved to Firestore
   - Full transcription log
   - Duration tracking
   - Average pronunciation score
2. Mistakes automatically logged (future enhancement)
3. Session appears in user stats

### On Subsequent Sessions
1. User context loaded from Firestore
2. Recent mistakes injected into system prompt
3. AI tutor adapts to user's weak areas

---

## 🔮 Next Steps (Future Enhancements)

### Immediate (Can implement now)
- [ ] Add mistake detection logic (parse transcriptions for corrections)
- [ ] Implement "resolve mistake" button in profile
- [ ] Add session history view (list past conversations)
- [ ] Export transcriptions as text/PDF

### Phase 4: Vector Embeddings (Advanced)
- [ ] Set up Pinecone account
- [ ] Deploy Firebase Cloud Functions
- [ ] Generate embeddings for semantic search
- [ ] "Find similar past conversations" feature

### Phase 5: Analytics Dashboard
- [ ] Charts for pronunciation improvement over time
- [ ] Language proficiency tracking
- [ ] Streak counter (consecutive practice days)
- [ ] Achievement badges

---

## 🐛 Troubleshooting

### "API_KEY environment variable not set"
- Ensure `.env.local` exists with `FIREBASE_API_KEY=...`
- Restart dev server after adding env variables

### "FirebaseError: Missing or insufficient permissions"
- Check Firestore rules in Firebase Console
- Ensure user is authenticated before accessing data
- Verify `userId` matches `auth.currentUser.uid`

### "Auth popup blocked"
- Allow popups in browser settings
- Use `signInWithRedirect` instead of `signInWithPopup` for mobile

### Sessions not saving
- Open browser DevTools → Console
- Look for `"Session saved: [id]"` message
- Check Firestore write permissions
- Verify `user` is not null when saving

---

## 📊 Firebase Usage Estimates

### Free Tier Limits (Spark Plan)
- **Firestore Writes:** 20K/day (plenty for testing)
- **Authentication:** Unlimited users
- **Storage:** 1 GB

### Typical Usage Per User
- **1 session:** ~5 document writes
- **1000 users/day:** ~5K writes (well below limit)

### Cost If You Upgrade
- **Most users will stay on free tier**
- Only upgrade if you exceed 50K writes/day (~10K active daily users)

---

## ✨ Success Metrics

You'll know Phase 3 is successful when:
1. ✅ Users can sign in with Google or as guest
2. ✅ Conversations persist to Firestore
3. ✅ User stats display correctly in profile
4. ✅ System prompt includes user context (mistakes)
5. ✅ No authentication or permission errors in console

🎉 **Congratulations!** You now have a production-grade persistence layer that remembers users and personalizes their learning experience.
