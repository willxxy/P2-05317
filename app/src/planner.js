export const MINUTE = 60_000;
export const BUFFER = 15 * MINUTE;
export const defaults = { hours: 6, duration: 60, preferred: 'morning', startHour: 8, endHour: 21, days: [1, 2, 3, 4, 5] };
export const bands = ['morning', 'afternoon', 'evening'];

export function weekStart(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return start;
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function dayKey(date) {
  return new Date(date).toLocaleDateString('en-CA');
}

export function band(date) {
  const hour = new Date(date).getHours();
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

export function overlaps(a, b, buffer = 0) {
  return a.start < b.end + buffer && a.end > b.start - buffer;
}

export function validateSettings(settings) {
  if (!Number.isFinite(settings.hours) || settings.hours < .5 || settings.hours > 30) throw new Error('Choose a goal between 0.5 and 30 hours.');
  if (![30, 45, 60, 90].includes(settings.duration)) throw new Error('Choose a supported session length.');
  if (!bands.includes(settings.preferred)) throw new Error('Choose a preferred study time.');
  if (!Number.isInteger(settings.startHour) || !Number.isInteger(settings.endHour) || settings.startHour < 0 || settings.endHour > 23 || settings.endHour <= settings.startHour) throw new Error('Your finish time must be after your start time, on the same day.');
  if ((settings.endHour - settings.startHour) * 60 < settings.duration) throw new Error('Allow enough time for one full session.');
  if (!Array.isArray(settings.days) || !settings.days.length || settings.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Choose at least one study day.');
  return settings;
}

// Two prior observations keep a single check-in from dominating the plan.
function rate(history, prior = .5) {
  return (2 * prior + history.filter(item => item.status === 'completed').length) / (2 + history.length);
}

export function scoreTime(start, settings, history, context) {
  const period = band(start);
  const outcomes = history.filter(item => ['completed', 'skipped'].includes(item.status));
  const sameTime = outcomes.filter(item => band(item.start) === period);
  const sameDay = outcomes.filter(item => new Date(item.start).getDay() === new Date(start).getDay());
  const samePlace = sameTime.filter(item => context !== 'unspecified' && item.context === context);
  const time = rate(sameTime, settings.preferred === period ? .7 : .45);
  return .7 * time + .2 * rate(sameDay) + .1 * rate(samePlace);
}

export function freeWindows(events, start, settings, now = Date.now()) {
  const windows = [];
  for (let index = 0; index < 7; index++) {
    const day = addDays(start, index);
    if (!settings.days.includes(day.getDay())) continue;
    const from = new Date(day).setHours(settings.startHour, 0, 0, 0);
    const until = new Date(day).setHours(settings.endHour, 0, 0, 0);
    let cursor = Math.max(from, now);
    const busy = events.filter(item => item.end + BUFFER > cursor && item.start - BUFFER < until).sort((a, b) => a.start - b.start);
    for (const item of busy) {
      const end = Math.min(until, item.start - BUFFER);
      if (end > cursor) windows.push({ start: cursor, end });
      cursor = Math.max(cursor, item.end + BUFFER);
    }
    if (cursor < until) windows.push({ start: cursor, end: until });
  }
  return windows;
}

export function planWeek({ events, history, settings, start, context = 'unspecified', reserved = [], now = Date.now() }) {
  validateSettings(settings);
  const end = +addDays(start, 7);
  const weekHistory = history.filter(item => item.start >= +start && item.start < end);
  const completed = [...weekHistory.filter(item => item.status === 'completed'), ...reserved];
  const completedMinutes = completed.reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0);
  const windows = freeWindows([...events, ...completed], start, settings, now);
  const candidates = [];
  const duration = settings.duration * MINUTE;
  for (const window of windows) {
    // Align to local quarter-hours, including time zones with half-hour offsets.
    const first = new Date(window.start);
    first.setMinutes(Math.ceil((first.getMinutes() + first.getSeconds() / 60 + first.getMilliseconds() / 60_000) / 15) * 15, 0, 0);
    for (let time = +first; time + duration <= window.end; time += 15 * MINUTE) {
      const candidate = { start: time, end: time + duration };
      if (!weekHistory.some(item => item.status === 'skipped' && overlaps(candidate, item))) candidates.push(candidate);
    }
  }
  const planned = [];
  let remaining = settings.hours * 60 - completedMinutes;
  while (remaining >= settings.duration && candidates.length) {
    const rank = item => scoreTime(item.start, settings, history, context) - .08 * [...completed, ...planned].filter(other => dayKey(other.start) === dayKey(item.start)).length;
    candidates.sort((a, b) => rank(b) - rank(a) || a.start - b.start);
    const next = candidates.shift();
    const samples = history.filter(item => band(item.start) === band(next.start)).length;
    planned.push({ ...next, id: `study-${next.start}-${settings.duration}`, title: 'Focused study', status: 'planned', context, reason: samples ? `Shaped by ${samples} ${band(next.start)} check-in${samples === 1 ? '' : 's'}` : band(next.start) === settings.preferred ? `Fits your ${settings.preferred} preference` : 'Fits a free block in your calendar' });
    remaining -= settings.duration;
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (overlaps(candidates[i], next, BUFFER)) candidates.splice(i, 1);
    }
  }
  return { sessions: planned.sort((a, b) => a.start - b.start), remainingMinutes: Math.max(0, remaining), freeMinutes: windows.reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0) };
}

export function recordOutcome(history, session, status, context) {
  if (!['completed', 'skipped'].includes(status)) throw new Error('Choose completed or skipped.');
  return [...history.filter(item => item.id !== session.id), { ...session, status, context }];
}

export function distance(a, b) {
  const radians = value => value * Math.PI / 180;
  const lat = radians(b.latitude - a.latitude);
  const lon = radians(b.longitude - a.longitude);
  const arc = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}
