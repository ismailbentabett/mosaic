// Life import: fills the app with a starting set of facts (data/demo-seed.json: Sam, the demo persona).
// Idempotent: every step looks for what exists first, so a second run changes nothing.
// Never overwrites his own answers (profilePropose keeps user facts) or area visions he edited.
// Low-confidence facts that the app asks about are left for the asks queue, so the app asks, not the chat.
// No secrets: goal text is checked by createGoal, people by addPerson.
import { addDays, lifeToday } from '../time.ts';
import { all, one, run } from './util.ts';
import { addAsk, profilePropose } from './profile/store.ts';
import type { AskSeed } from './profile/store.ts';
import { addHabit, ensureProject, updateProject } from './tasks/store.ts';
import { addOccasion, addPerson, listOccasions } from './people/store.ts';
import { addSavingsGoal, listSavingsGoals } from './money/store.ts';
import { DEFAULT_AREAS, addArea, addMilestone, createGoal, goalFromTemplate, linkGoal, listAreas, updateArea } from './grades/store.ts';
import type { GoalInput } from './grades/store.ts';

export type LifeSeed = {
  version: number;
  facts?: { key: string; value: string; confidence: number }[];
  asks?: AskSeed[];
  areas?: { key?: string; name?: string; emoji?: string; vision: string }[];
  savings_goals?: { name: string; target_usd: number; target_date?: string }[];
  projects?: { name: string; area?: string }[];
  habits?: { name: string; target_per_week: number; area?: string }[];
  goals?: (GoalInput & { name: string; seed_key: string; template?: string; milestones?: [string, string | null][]; links?: ['habit' | 'project', string][] })[];
  people?: { name: string; relation: string; cadence_days?: number; note?: string }[];
  occasions?: { name: string; kind: string; date: string; lead_days?: number; note?: string }[];
};

type Count = { added: number; kept: number; skipped: number };

/** Seed dates may be relative to the import day: "+90d" = 90 days from today. Absolute YYYY-MM-DD passes through. */
export const seedDate = <T extends string | null | undefined>(v: T, today: string): T => {
  const m = typeof v === 'string' ? /^\+(\d{1,4})d$/.exec(v) : null;
  return (m ? addDays(today, Number(m[1])) : v) as T;
};
const c = (): Count => ({ added: 0, kept: 0, skipped: 0 });

/** Area id by key or name (case-insensitive), or null. */
const areaId = (ref?: string) => {
  if (!ref) return null;
  const a = listAreas().find((x) => x.key === ref || String(x.name).toLowerCase() === ref.toLowerCase());
  return a ? String(a.id) : null;
};

export const importLife = (seed: LifeSeed, dryRun = false, today = lifeToday()) => {
  if (!seed || typeof seed !== 'object' || seed.version !== 1) throw new Error('life seed must have version 1');
  const r = { facts: c(), asks: c(), areas: c(), savings_goals: c(), projects: c(), habits: c(), goals: c(),
    milestones: c(), links: c(), people: c(), occasions: c(), errors: [] as string[], dryRun };
  const err = (what: string, e: unknown) => r.errors.push(`${what}: ${(e as Error).message}`);
  run('BEGIN');
  try {
    // 1. Asks first, so facts for those keys are coerced to the right type (or left for the app to ask).
    for (const a of seed.asks ?? []) {
      try {
        const had = one(`SELECT 1 AS x FROM asks WHERE key = ?`, a.key);
        addAsk(a); had ? r.asks.kept++ : r.asks.added++;
      } catch (e) { r.asks.skipped++; err(`ask ${a.key}`, e); }
    }
    // 2. Facts. Skip keys the app asks about unless the fact is solid (>= 0.8).
    for (const f of seed.facts ?? []) {
      const asked = one(`SELECT 1 AS x FROM asks WHERE key = ?`, f.key);
      if (asked && f.confidence < 0.8) { r.facts.skipped++; continue; }
      const cur = one<{ source: string }>(`SELECT source FROM profile_facts WHERE key = ?`, f.key);
      if (cur && cur.source !== 'claude') { r.facts.kept++; continue; } // his answer, or already imported
      try {
        const res = profilePropose(f.key, f.value, 'import', f.confidence) as { stored: boolean };
        res.stored ? r.facts.added++ : r.facts.kept++;
      } catch { r.facts.skipped++; }
    }
    // 3. Areas: only replace a vision still at its default text; add new areas by name.
    const defaults = new Map<string, string>(DEFAULT_AREAS.map((d) => [d.key, d.vision]));
    for (const a of seed.areas ?? []) {
      try {
        const cur = listAreas().find((x) => (a.key && x.key === a.key) || (a.name && String(x.name).toLowerCase() === a.name.toLowerCase()));
        if (!cur) { addArea({ name: a.name ?? a.key!, emoji: a.emoji, vision: a.vision }); r.areas.added++; continue; }
        const isDefault = !cur.vision || (cur.key && defaults.get(String(cur.key)) === cur.vision);
        if (isDefault && cur.vision !== a.vision) { updateArea(String(cur.id), { vision: a.vision }); r.areas.added++; } else r.areas.kept++;
      } catch (e) { r.areas.skipped++; err(`area ${a.key ?? a.name}`, e); }
    }
    // 4. Savings goals by name.
    for (const s of seed.savings_goals ?? []) {
      try {
        if (listSavingsGoals(today).some((g) => String(g.name).toLowerCase() === s.name.toLowerCase())) { r.savings_goals.kept++; continue; }
        addSavingsGoal({ ...s, target_date: seedDate(s.target_date, today) }); r.savings_goals.added++;
      } catch (e) { r.savings_goals.skipped++; err(`savings ${s.name}`, e); }
    }
    // 5. Projects (ensureProject is idempotent by name); set the area only when none is set.
    for (const p of seed.projects ?? []) {
      try {
        const had = one(`SELECT 1 AS x FROM projects WHERE deleted_at IS NULL AND lower(name) = lower(?)`, p.name);
        const row = ensureProject(p.name) as { id: string; area_id: string | null };
        const aid = areaId(p.area);
        if (aid && !row.area_id) updateProject(row.id, { area_id: aid });
        had ? r.projects.kept++ : r.projects.added++;
      } catch (e) { r.projects.skipped++; err(`project ${p.name}`, e); }
    }
    // 6. Habits by name; set the area only when none is set.
    for (const h of seed.habits ?? []) {
      try {
        const cur = one<{ id: string; area_id: string | null }>(`SELECT id, area_id FROM habits WHERE deleted_at IS NULL AND lower(name) = lower(?)`, h.name);
        const id = cur?.id ?? String((addHabit(h.name, Math.min(7, Math.max(1, h.target_per_week))) as { id: string }).id);
        const aid = areaId(h.area);
        if (aid && !cur?.area_id) run(`UPDATE habits SET area_id = ?, updated_at = ? WHERE id = ?`, aid, new Date().toISOString(), id);
        cur ? r.habits.kept++ : r.habits.added++;
      } catch (e) { r.habits.skipped++; err(`habit ${h.name}`, e); }
    }
    // 7. Goals (seed_key makes them idempotent), then milestones and links.
    for (const g of seed.goals ?? []) {
      try {
        const had = one(`SELECT 1 AS x FROM goals WHERE seed_key = ? AND deleted_at IS NULL`, g.seed_key);
        const { template, milestones, links, ...rest } = g;
        const f = { ...rest, ...(rest.target_date !== undefined ? { target_date: seedDate(rest.target_date, today) } : {}) };
        const goal = template ? goalFromTemplate(template, f, today) : createGoal(f, today);
        had ? r.goals.kept++ : r.goals.added++;
        for (const [name, due] of milestones ?? []) {
          const ex = one(`SELECT 1 AS x FROM goal_milestones WHERE goal_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL`, goal.id, name);
          if (ex) { r.milestones.kept++; continue; }
          addMilestone(goal.id, name, seedDate(due, today)); r.milestones.added++;
        }
        for (const [kind, ref] of links ?? []) {
          try {
            const before = all(`SELECT 1 AS x FROM goal_links WHERE goal_id = ? AND deleted_at IS NULL`, goal.id).length;
            linkGoal(goal.id, kind, ref);
            const after = all(`SELECT 1 AS x FROM goal_links WHERE goal_id = ? AND deleted_at IS NULL`, goal.id).length;
            after > before ? r.links.added++ : r.links.kept++;
          } catch (e) { r.links.skipped++; err(`link ${g.seed_key} ${kind} ${ref}`, e); }
        }
      } catch (e) { r.goals.skipped++; err(`goal ${g.name}`, e); }
    }
    // 8. People by name.
    for (const p of seed.people ?? []) {
      try {
        if (one(`SELECT 1 AS x FROM people WHERE deleted_at IS NULL AND lower(name) = lower(?)`, p.name)) { r.people.kept++; continue; }
        addPerson(p); r.people.added++;
      } catch (e) { r.people.skipped++; err(`person ${p.name}`, e); }
    }
    // 9. Occasions by name.
    for (const o of seed.occasions ?? []) {
      try {
        if (listOccasions().some((x) => x.name.toLowerCase() === o.name.toLowerCase())) { r.occasions.kept++; continue; }
        addOccasion({ ...o, date: seedDate(o.date, today) }); r.occasions.added++;
      } catch (e) { r.occasions.skipped++; err(`occasion ${o.name}`, e); }
    }
    run(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    run('ROLLBACK');
    throw e;
  }
  return r;
};
