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
        console.warn('Firebase not configured, session not saved');
        return null;
    }
    const userId = auth.currentUser?.uid;
    if (!userId) {
        console.warn('No authenticated user, session not saved');
        return null;
    }

    try {
        // Calculate average pronunciation score
        const scoresWithValues = transcriptions.filter(t =>
            t.pronunciationScore !== undefined && t.pronunciationScore !== null
        );

        const avgScore = scoresWithValues.length > 0
            ? scoresWithValues.reduce((sum, t) => sum + (t.pronunciationScore || 0), 0) / scoresWithValues.length
            : 0;

        const sessionData: SessionData = {
            timestamp: Timestamp.now(),
            language,
            duration,
            transcriptionSummary: transcriptions
                .map(t => `${t.speaker}: ${t.text}`)
                .join('\n'),
            transcriptions: transcriptions.map(t => ({
                ...t,
                audioUrl: undefined // Don't save blob URLs to Firestore
            })),
            averagePronunciationScore: avgScore,
            totalUtterances: transcriptions.filter(t => t.speaker === 'You').length
        };

        const docRef = await addDoc(
            collection(db, `users/${userId}/sessions`),
            sessionData
        );

        console.log('Session saved:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error saving session:', error);
        return null;
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
        // Fetch unresolved mistakes
        const mistakesQuery = query(
            collection(db, `users/${userId}/mistakes`),
            where('resolved', '==', false),
            orderBy('timesRepeated', 'desc'),
            limit(10)
        );

        const mistakesSnapshot = await getDocs(mistakesQuery);
        const mistakes = mistakesSnapshot.docs.map(doc => doc.data() as MistakeData);

        if (mistakes.length === 0) {
            return '';
        }

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
        console.error('Error loading user context:', error);
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
        const [sessionsSnapshot, mistakesSnapshot] = await Promise.all([
            getDocs(collection(db, `users/${userId}/sessions`)),
            getDocs(query(
                collection(db, `users/${userId}/mistakes`),
                where('resolved', '==', false)
            ))
        ]);

        const sessions = sessionsSnapshot.docs.map(doc => doc.data() as SessionData);
        const totalMinutes = sessions.reduce((sum, s) => sum + s.duration, 0) / 60;
        const avgScore = sessions.length > 0
            ? sessions.reduce((sum, s) => sum + s.averagePronunciationScore, 0) / sessions.length
            : 0;

        return {
            totalSessions: sessions.length,
            totalMinutes: Math.round(totalMinutes),
            averagePronunciationScore: Math.round(avgScore * 100) / 100,
            unresolvedMistakes: mistakesSnapshot.size
        };
    } catch (error) {
        console.error('Error getting stats:', error);
        return {
            totalSessions: 0,
            totalMinutes: 0,
            averagePronunciationScore: 0,
            unresolvedMistakes: 0
        };
    }
}
