/**
 * Skill registry: which skills are on, how live skills are declared to Gemini Live, how tool calls
 * run, and how review skills act on the post-exchange review.
 *
 * Gallery puts only skill names and descriptions in the prompt and loads full instructions on
 * demand, because on-device context is small. Gemini's context is large, so each live skill's
 * instructions go straight into its function declaration instead.
 */

import type { LiveFunctionCall, LiveFunctionResponse, SkillAttachment, SkillContext, TutorSkill } from './types';
import { BUILT_IN_SKILLS } from './skills';
import { reviewTurn, type ReviewWants, type TurnReview } from './turnReview';

const PREFS_KEY = 'glossos_tutor_skills';

export type SkillPrefs = Record<string, boolean>;

export function loadSkillPrefs(): SkillPrefs {
    try {
        const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function saveSkillPrefs(prefs: SkillPrefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch { /* storage unavailable */ }
}

export function isSkillEnabled(skill: TutorSkill, prefs: SkillPrefs): boolean {
    return prefs[skill.name] ?? skill.defaultEnabled;
}

export function enabledSkills(prefs: SkillPrefs, all: TutorSkill[] = BUILT_IN_SKILLS): TutorSkill[] {
    return all.filter(s => isSkillEnabled(s, prefs));
}

// ─── Live skills (Gemini Live function calling) ────────────────────────────

/** Function declarations for the Live API setup message (live skills only). */
export function buildFunctionDeclarations(skills: TutorSkill[]) {
    return skills
        .filter(s => s.mode === 'live')
        .map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));
}

/** System-prompt addendum that tells the tutor how to use its live tools. */
export function buildSkillsInstruction(skills: TutorSkill[]): string {
    const live = skills.filter(s => s.mode === 'live');
    if (live.length === 0) return '';
    return [
        'TOOLS:',
        'You can call these tools while you teach. Never mention the tools by name, and never repeat what you already '
        + 'said after a tool result. Keep talking naturally.',
        ...live.map(s => `- ${s.name}: ${s.description}`),
    ].join('\n');
}

/** Gallery-style name lookup: case-insensitive, with '-', '_' and spaces treated the same. */
function findSkill(name: string, skills: TutorSkill[]): TutorSkill | undefined {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '_');
    return skills.find(s => norm(s.name) === norm(name));
}

export interface ToolCallOutcome {
    responses: LiveFunctionResponse[];
    attachments: SkillAttachment[];
}

/** Runs a batch of calls against the given skills. Never throws: failures become error responses. */
export async function executeToolCalls(
    calls: LiveFunctionCall[],
    skills: TutorSkill[],
    ctx: SkillContext,
): Promise<ToolCallOutcome> {
    const outcomes = await Promise.all(calls.map(async call => {
        const skill = findSkill(call.name, skills);
        if (!skill) {
            return { response: { id: call.id, name: call.name, response: { error: `Unknown tool: ${call.name}` } } };
        }
        try {
            const result = await skill.run(call.args ?? {}, ctx);
            return { response: { id: call.id, name: call.name, response: result.response }, attachment: result.attachment };
        } catch (err) {
            console.warn(`[GLOSSOS-SKILLS] ${call.name} failed:`, err);
            return { response: { id: call.id, name: call.name, response: { error: (err as Error).message || 'Tool failed' } } };
        }
    }));
    return {
        responses: outcomes.map(o => o.response),
        attachments: outcomes.flatMap(o => ('attachment' in o && o.attachment ? [o.attachment] : [])),
    };
}

// ─── Review skills (after each exchange) ───────────────────────────────────

/** What was already handled this session, so nothing is logged, saved or shown twice. */
export interface ReviewMemory {
    mistakes: Set<string>;
    fixed: Set<string>;
    words: Set<string>;
    cards: Set<string>;
}

export function newReviewMemory(): ReviewMemory {
    return { mistakes: new Set(), fixed: new Set(), words: new Set(), cards: new Set() };
}

const key = (s: string) => s.trim().toLocaleLowerCase().replace(/[¡!¿?.,;:"'“”«»]+/g, '').replace(/\s+/g, ' ');

export function reviewWants(skills: TutorSkill[]): ReviewWants {
    const on = (name: string) => skills.some(s => s.mode === 'review' && s.name === name);
    return { mistakes: on('log_mistake'), fixed: on('mark_mistake_fixed'), words: on('save_vocabulary'), card: on('show_card') };
}

/** Turns a review into skill calls, skipping anything already handled this session. */
export function reviewToCalls(review: TurnReview, memory: ReviewMemory, wants: ReviewWants): LiveFunctionCall[] {
    const calls: LiveFunctionCall[] = [];
    const id = () => `review-${calls.length}-${Math.random().toString(36).slice(2, 8)}`;
    if (wants.mistakes) {
        for (const m of review.mistakes) {
            if (memory.mistakes.has(key(m.incorrect))) continue;
            memory.mistakes.add(key(m.incorrect));
            calls.push({ id: id(), name: 'log_mistake', args: { ...m } });
        }
    }
    if (wants.fixed) {
        for (const f of review.fixed) {
            if (memory.fixed.has(key(f))) continue;
            memory.fixed.add(key(f));
            calls.push({ id: id(), name: 'mark_mistake_fixed', args: { incorrect: f } });
        }
    }
    if (wants.words) {
        for (const w of review.new_words) {
            if (memory.words.has(key(w.word))) continue;
            memory.words.add(key(w.word));
            calls.push({ id: id(), name: 'save_vocabulary', args: { ...w } });
        }
    }
    if (wants.card && review.phrase_card && !memory.cards.has(key(review.phrase_card.title))) {
        memory.cards.add(key(review.phrase_card.title));
        calls.push({ id: id(), name: 'show_card', args: { ...review.phrase_card } });
    }
    return calls;
}

export interface TurnReviewRequest {
    learnerText: string;
    tutorText: string;
    skills: TutorSkill[];
    ctx: SkillContext;
    /** Unresolved mistakes from the learner profile. */
    profileMistakes: { incorrect: string; correct: string }[];
    memory: ReviewMemory;
    review?: typeof reviewTurn;
}

/** Reviews one finished exchange and runs the enabled review skills. Never throws. */
export async function runTurnReview(req: TurnReviewRequest): Promise<SkillAttachment[]> {
    const wants = reviewWants(req.skills);
    const learner = req.learnerText.trim();
    if (!learner || learner.split(/\s+/).length < 2 || !req.tutorText.trim()) return [];
    if (!wants.mistakes && !wants.fixed && !wants.words && !wants.card) return [];
    try {
        const review = await (req.review ?? reviewTurn)({
            learnerText: learner,
            tutorText: req.tutorText.trim(),
            nativeLanguage: req.ctx.nativeLanguage,
            learnLanguage: req.ctx.learnLanguage,
            level: req.ctx.level,
            profileMistakes: req.profileMistakes.filter(m => !req.memory.fixed.has(key(m.incorrect))),
            knownWords: [...req.memory.words],
            shownCards: [...req.memory.cards],
            wants,
        });
        const calls = reviewToCalls(review, req.memory, wants);
        if (calls.length === 0) return [];
        return (await executeToolCalls(calls, req.skills, req.ctx)).attachments;
    } catch (err) {
        console.warn('[GLOSSOS-SKILLS] Turn review failed:', err);
        return [];
    }
}
