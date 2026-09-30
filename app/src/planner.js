export const MINUTE = 60_000;
export const BUFFER = 15 * MINUTE;
export const defaults = { hours: 6, duration: 60, preferred: 'morning', startHour: 8, endHour: 21, days: [1, 2, 3, 4, 5], bufferMinutes: 15, learning: 'adaptive' };
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
  if (!Number.isInteger(settings.bufferMinutes) || settings.bufferMinutes < 0 || settings.bufferMinutes > 180) throw new Error('Choose a transition break between 0 and 180 minutes.');
  if (!['adaptive', 'stated'].includes(settings.learning)) throw new Error('Choose how preferences are applied.');
  return settings;
}

export function learningHistory(history, settings) {
  if (settings.learning === 'stated') return [];
  return history.filter(item => (item.learning ?? (item.status === 'completed' ? 'use' : 'ignore')) === 'use');
}

// Two prior observations keep a single check-in from dominating the plan.
function rate(history, prior = .5) {
  return (2 * prior + history.filter(item => item.status === 'completed').length) / (2 + history.length);
}

export function scoreTime(start, settings, history, context) {
  const period = band(start);
  const outcomes = learningHistory(history, settings);
  const sameTime = outcomes.filter(item => band(item.start) === period);
  const sameDay = outcomes.filter(item => new Date(item.start).getDay() === new Date(start).getDay());
  const samePlace = sameTime.filter(item => context !== 'unspecified' && item.context === context);
  const time = rate(sameTime, settings.preferred === period ? .7 : .45);
  return .7 * time + .2 * rate(sameDay) + .1 * rate(samePlace);
}

export function freeWindows(events, start, settings, now = Date.now()) {
  const windows = [];
  const buffer = settings.bufferMinutes * MINUTE;
  for (let index = 0; index < 7; index++) {
    const day = addDays(start, index);
    if (!settings.days.includes(day.getDay())) continue;
    const from = new Date(day).setHours(settings.startHour, 0, 0, 0);
    const until = new Date(day).setHours(settings.endHour, 0, 0, 0);
    let cursor = Math.max(from, now);
    const busy = events.filter(item => item.end + buffer > cursor && item.start - buffer < until).sort((a, b) => a.start - b.start);
    for (const item of busy) {
      const end = Math.min(until, item.start - buffer);
      if (end > cursor) windows.push({ start: cursor, end });
      cursor = Math.max(cursor, item.end + buffer);
    }
    if (cursor < until) windows.push({ start: cursor, end: until });
  }
  return windows;
}

export function canSchedule(session, events, start, settings) {
  return freeWindows(events.filter(item => item.id !== session.id), start, settings, session.start)
    .some(window => session.start >= window.start && session.end <= window.end);
}

// Equal-length candidates stay in time order, so earliest finishes give maximum capacity.
function sessionCapacity(candidates, buffer) {
  let count = 0;
  let end = -Infinity;
  for (const item of candidates) {
    if (item.start < end + buffer) continue;
    count++;
    end = item.end;
  }
  return count;
}

export function planWeek({ events, history, settings, start, context = 'unspecified', reserved = [], now = Date.now() }) {
  validateSettings(settings);
  const buffer = settings.bufferMinutes * MINUTE;
  const end = +addDays(start, 7);
  const weekHistory = history.filter(item => item.start >= +start && item.start < end);
  const imported = [];
  const known = new Set([...weekHistory, ...reserved].map(item => item.id));
  for (const item of events) {
    if (item.status !== 'planned' || item.start < +start || item.start >= end || known.has(item.id)) continue;
    if (!canSchedule(item, [...events, ...reserved], start, settings)) continue;
    imported.push(item);
    known.add(item.id);
  }
  const fixed = [...weekHistory.filter(item => item.status === 'completed'), ...reserved.filter(item => item.end > now), ...imported.filter(item => item.end > now)];
  const fixedMinutes = fixed.reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0);
  const windows = freeWindows([...events, ...fixed], start, settings, now);
  const candidates = [];
  const duration = settings.duration * MINUTE;
  for (const window of windows) {
    // Align to local quarter-hours, including time zones with half-hour offsets.
    const first = new Date(window.start);
    first.setMinutes(Math.ceil((first.getMinutes() + first.getSeconds() / 60 + first.getMilliseconds() / 60_000) / 15) * 15, 0, 0);
    for (let time = +first; time + duration <= window.end; time += 15 * MINUTE) {
      const candidate = { start: time, end: time + duration };
      if (!weekHistory.some(item => ['skipped', 'moved'].includes(item.status) && overlaps(candidate, item))) candidates.push(candidate);
    }
  }
  const planned = [];
  let remaining = settings.hours * 60 - fixedMinutes;
  while (remaining >= settings.duration && candidates.length) {
    const rank = item => scoreTime(item.start, settings, history, context) - .08 * [...fixed, ...planned].filter(other => dayKey(other.start) === dayKey(item.start)).length;
    const ranked = [...candidates].sort((a, b) => rank(b) - rank(a) || a.start - b.start);
    const needed = Math.min(Math.floor(remaining / settings.duration), sessionCapacity(candidates, buffer));
    const next = ranked.find(candidate => {
      const available = candidates.filter(item => !overlaps(item, candidate, buffer));
      return sessionCapacity(available, buffer) >= needed - 1;
    });
    const samples = learningHistory(history, settings).filter(item => band(item.start) === band(next.start)).length;
    planned.push({ ...next, id: `study-${next.start}-${settings.duration}`, title: 'Focused study', status: 'planned', context, reason: samples ? `Shaped by ${samples} ${band(next.start)} check-in${samples === 1 ? '' : 's'}` : band(next.start) === settings.preferred ? `Fits your ${settings.preferred} preference` : 'Fits a free block in your calendar' });
    remaining -= settings.duration;
    for (let i = candidates.length - 1; i >= 0; i--) {
      if (overlaps(candidates[i], next, buffer)) candidates.splice(i, 1);
    }
  }
  return { sessions: [...imported, ...planned].sort((a, b) => a.start - b.start), remainingMinutes: Math.max(0, remaining), freeMinutes: windows.reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0) };
}

export function recordOutcome(history, session, status, context, changeReason = '') {
  if (!['completed', 'skipped', 'moved'].includes(status)) throw new Error('Choose completed, skipped, or moved.');
  const learning = status === 'completed' || changeReason === 'preference' ? 'use' : 'ignore';
  return [...history.filter(item => item.id !== session.id), { ...session, status, context, changeReason, learning }];
}

export function distance(a, b) {
  const radians = value => value * Math.PI / 180;
  const lat = radians(b.latitude - a.latitude);
  const lon = radians(b.longitude - a.longitude);
  const arc = Math.sin(lat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(lon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}
