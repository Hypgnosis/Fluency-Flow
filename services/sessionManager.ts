import {
    collection,
    addDoc,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    Timestamp,
    updateDoc,
    increment
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { TranscriptionEntry } from '../types';

export interface SessionData {
    timestamp: Timestamp;
    language: string;
    duration: number;
    transcriptionSummary: string;
    transcriptions: TranscriptionEntry[];
    averagePronunciationScore: number;
    totalUtterances: number;
}

export interface MistakeData {
    word: string;
    incorrectForm: string;
    correctForm: string;
    category: 'pronunciation' | 'grammar' | 'vocabulary';
    timestamp: Timestamp;
    timesRepeated: number;
    resolved: boolean;
    language: string;
}

/**
 * Saves a conversation session to Firestore
 */
export async function saveSession(
    transcriptions: TranscriptionEntry[],
    language: string,
    duration: number
): Promise<string | null> {
    if (!auth || !db) {
        console.warn('[GLOSSOS-DB] Firebase not configured, session not saved');
        return null;
    }
    const userId = auth.currentUser?.uid;
    if (!userId) {
        console.warn('[GLOSSOS-DB] No authenticated user, session not saved');
        return null;
    }

    console.log(`[GLOSSOS-DB] Saving session: ${transcriptions.length} entries, ${duration}s, language=${language}`);

    try {
        // Calculate average pronunciation score
        const scoresWithValues = transcriptions.filter(t =>
            t.pronunciationScore !== undefined && t.pronunciationScore !== null
        );

        const avgScore = scoresWithValues.length > 0
            ? scoresWithValues.reduce((sum, t) => sum + (t.pronunciationScore || 0), 0) / scoresWithValues.length
            : 0;

        // Strip non-serializable, oversized, and undefined fields from transcriptions.
        // Firestore rejects ANY field with value `undefined`.
        // - audioUrl: blob URLs are not valid after page unload
        // - phoneticAnalysis: deeply nested non-serializable object
        // - sceneImageUrl: base64 data URLs can exceed Firestore's 1 MiB doc limit
        // - isGeneratingImage: transient UI state
        const cleanTranscriptions = transcriptions.map(t => {
            const { audioUrl, phoneticAnalysis, sceneImageUrl, isGeneratingImage, ...rest } = t as any;
            // JSON round-trip strips all `undefined` values (Firestore requirement)
            return JSON.parse(JSON.stringify(rest));
        });

        const sessionData: SessionData = {
            timestamp: Timestamp.now(),
            language,
            duration,
            transcriptionSummary: transcriptions
                .map(t => `${t.speaker}: ${t.text}`)
                .join('\n'),
            transcriptions: cleanTranscriptions,
            averagePronunciationScore: avgScore,
            totalUtterances: transcriptions.filter(t => t.speaker === 'You').length
        };

        console.log(`[GLOSSOS-DB] Document payload size: ~${JSON.stringify(sessionData).length} bytes`);

        const docRef = await addDoc(
            collection(db, `users/${userId}/sessions`),
            sessionData
        );

        console.log(`[GLOSSOS-DB] [OK] Session saved: ${docRef.id}`);
        return docRef.id;
    } catch (error) {
        console.error('[GLOSSOS-DB] [ERROR] Error saving session:', error);
        // Re-throw so the caller can surface the error to the user
        throw error;
    }
}

/**
 * Loads the most recent sessions for a user
 */
export async function loadRecentSessions(
    userId: string,
    count: number = 5
): Promise<SessionData[]> {
    if (!db) return [];
    try {
        const sessionsQuery = query(
            collection(db, `users/${userId}/sessions`),
            orderBy('timestamp', 'desc'),
            limit(count)
        );

        const snapshot = await getDocs(sessionsQuery);
        return snapshot.docs.map(doc => doc.data() as SessionData);
    } catch (error) {
        console.error('Error loading sessions:', error);
        return [];
    }
}

/**
 * Logs a mistake made by the user
 */
export async function logMistake(
    word: string,
    incorrectForm: string,
    correctForm: string,
    category: MistakeData['category'],
    language: string
): Promise<void> {
    if (!auth || !db) return;
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    try {
        // Check if this mistake already exists
        const mistakesQuery = query(
            collection(db, `users/${userId}/mistakes`),
            where('word', '==', word),
            where('language', '==', language),
            where('resolved', '==', false)
        );

        const existing = await getDocs(mistakesQuery);

        if (!existing.empty) {
            // Increment the count on existing mistake
            const mistakeDoc = existing.docs[0];
            await updateDoc(mistakeDoc.ref, {
                timesRepeated: increment(1),
                timestamp: Timestamp.now()
            });
        } else {
            // Create new mistake entry
            await addDoc(collection(db, `users/${userId}/mistakes`), {
                word,
                incorrectForm,
                correctForm,
                category,
                timestamp: Timestamp.now(),
                timesRepeated: 1,
                resolved: false,
                language
            });
        }
    } catch (error) {
        console.error('Error logging mistake:', error);
    }
}

/**
 * Loads user context including unresolved mistakes and recent progress
 */
export async function loadUserContext(userId: string): Promise<string> {
    if (!db) return '';
    try {
        console.log(`[GLOSSOS-DB] Loading user context for ${userId}`);

        let mistakesSnapshot;
        try {
            // Primary query: requires composite index (resolved + timesRepeated)
            const mistakesQuery = query(
                collection(db, `users/${userId}/mistakes`),
                where('resolved', '==', false),
                orderBy('timesRepeated', 'desc'),
                limit(10)
            );
            mistakesSnapshot = await getDocs(mistakesQuery);
        } catch (indexError: any) {
            // Fallback: if composite index is missing, query without orderBy
            console.warn('[GLOSSOS-DB] Composite index missing, falling back to unordered query:', indexError?.message);
            const fallbackQuery = query(
                collection(db, `users/${userId}/mistakes`),
                where('resolved', '==', false),
                limit(10)
            );
            mistakesSnapshot = await getDocs(fallbackQuery);
        }

        const mistakes = mistakesSnapshot.docs.map(doc => doc.data() as MistakeData);

        if (mistakes.length === 0) {
            console.log('[GLOSSOS-DB] No unresolved mistakes found');
            return '';
        }

        console.log(`[GLOSSOS-DB] Loaded ${mistakes.length} unresolved mistakes`);

        // Format context string
        const mistakesList = mistakes
            .map(m => `- "${m.incorrectForm}" → "${m.correctForm}" (${m.category}, repeated ${m.timesRepeated}x)`)
            .join('\n');

        return `
LEARNER PROFILE - Areas needing improvement:
${mistakesList}

Please adapt your teaching to address these recurring mistakes naturally during conversation.
    `.trim();
    } catch (error) {
        console.error('[GLOSSOS-DB] Error loading user context:', error);
        return '';
    }
}

/**
 * Marks a mistake as resolved
 */
export async function resolveMistake(mistakeId: string): Promise<void> {
    if (!auth || !db) return;
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    try {
        const mistakeRef = doc(db, `users/${userId}/mistakes/${mistakeId}`);
        await updateDoc(mistakeRef, {
            resolved: true
        });
    } catch (error) {
        console.error('Error resolving mistake:', error);
    }
}

/**
 * Gets user statistics
 */
export async function getUserStats(userId: string) {
    if (!db) return {
        totalSessions: 0,
        totalMinutes: 0,
        averagePronunciationScore: 0,
        unresolvedMistakes: 0
    };
    try {
        const sessionsSnapshot = await getDocs(collection(db, `users/${userId}/sessions`));

        // Mistakes query may fail if composite index doesn't exist yet
        let unresolvedCount = 0;
        try {
            const mistakesSnapshot = await getDocs(query(
                collection(db, `users/${userId}/mistakes`),
                where('resolved', '==', false)
            ));
            unresolvedCount = mistakesSnapshot.size;
        } catch (mistakeErr: any) {
            if (mistakeErr?.code === 'failed-precondition') {
                console.warn('[GLOSSOS-DB] Mistakes index not yet created, defaulting to 0');
            } else {
                console.error('[GLOSSOS-DB] Error querying mistakes:', mistakeErr);
            }
        }

        const sessions = sessionsSnapshot.docs.map(doc => doc.data() as SessionData);
        const totalMinutes = sessions.reduce((sum, s) => sum + s.duration, 0) / 60;
        const avgScore = sessions.length > 0
            ? sessions.reduce((sum, s) => sum + s.averagePronunciationScore, 0) / sessions.length
            : 0;

        return {
            totalSessions: sessions.length,
            totalMinutes: Math.round(totalMinutes),
            averagePronunciationScore: Math.round(avgScore * 100) / 100,
            unresolvedMistakes: unresolvedCount
        };
    } catch (error) {
        console.error('[GLOSSOS-DB] Error getting stats:', error);
        return {
            totalSessions: 0,
            totalMinutes: 0,
            averagePronunciationScore: 0,
            unresolvedMistakes: 0
        };
    }
}
