// Only compare sessions whose gameplay settings are equivalent, independently of plan name.
const common = ['mode', 'hand', 'unit', 'target', 'tolerance', 'workS', 'restS', 'reps', 'sets', 'setRestS'];
const extra = { tug: ['handMode', 'rival'], ship: ['river', 'wind'], climb: ['handMode'], scale: [] };
const defaults = { handMode: 'single', rival: 'medium', river: 'straight', wind: 0 };
export function sameGamePlan(a, b) {
  if (!a || !b || a.mode !== b.mode) return false;
  return [...common, ...(extra[a.mode] || [])].every(k => (a[k] ?? defaults[k]) === (b[k] ?? defaults[k]));
}
export function gameRecord(items, plan) {
  const scores = items.filter(m => !m.demo && m.training?.completed && Number.isFinite(m.training.points) && sameGamePlan(m.training.plan, plan)).map(m => m.training.points);
  return scores.length ? Math.max(...scores) : null;
}
