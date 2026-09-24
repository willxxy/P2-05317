import './style.css';
import { defaults, bands, weekStart, addDays, dayKey, band, planWeek, freeWindows, scoreTime, recordOutcome, distance, validateSettings, MINUTE } from './planner.js';
import { readCalendar, exportCalendar, sampleCalendar, MAX_FILE_BYTES } from './calendar.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const format = (date, options) => new Date(date).toLocaleDateString('en-US', options);
const time = date => new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const hours = minutes => Number((minutes / 60).toFixed(1));
const capital = value => value.charAt(0).toUpperCase() + value.slice(1);
const contextNames = { unspecified: 'Not set', home: 'Home', library: 'Library', campus: 'Campus', other: 'Somewhere else' };
const STORAGE_KEY = 'margin.v1';
let week = weekStart();
let storageWarning = '';
let calendarError = '';
let offlineReady = false;
let watchId = null;
let position = null;
let toastTimer;

function freshState(withSample = false) {
  return { version: 1, settings: { ...defaults }, sources: withSample ? [{ id: 'sample', name: 'Sample calendar', text: sampleCalendar(weekStart()), sample: true }] : [], history: [], plans: {}, context: 'unspecified', places: [] };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState(true);
    const saved = JSON.parse(raw);
    validateSettings(saved.settings);
    if (saved.version !== 1 || !Array.isArray(saved.sources) || !Array.isArray(saved.history) || !Array.isArray(saved.places) || !saved.plans || typeof saved.plans !== 'object' || !Object.hasOwn(contextNames, saved.context)) throw new Error('Unrecognized saved data.');
    return saved;
  } catch {
    storageWarning = 'Saved data could not be loaded. This workspace is temporary; clear device data in Calendar connection to start again.';
    return freshState();
  }
}
let state = load();

function eventsFor(data, start) {
  return data.sources.flatMap(source => readCalendar(source.text, start, addDays(start, 7), source.id));
}

function rebuild(data, start) {
  const key = dayKey(start);
  const reserved = (data.plans[key] || []).filter(item => item.start < Date.now() && !data.history.some(outcome => outcome.id === item.id));
  const result = planWeek({ events: eventsFor(data, start), history: data.history, settings: data.settings, start, context: data.context, reserved });
  data.plans[key] = [...reserved, ...result.sessions];
  return result;
}

function save(data) {
  if (!storageWarning) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      throw new Error('Could not save changes. Free browser storage or remove a calendar, then try again.');
    }
  }
  state = data;
  render();
}

function update(change, scope = 'current') {
  try {
    const next = structuredClone(state);
    change(next);
    const weeks = scope === 'all' ? [...new Set([...Object.keys(next.plans), dayKey(week)])].map(key => new Date(`${key}T00:00:00`)) : [week];
    for (const start of weeks) {
      if (+addDays(start, 7) > Date.now()) rebuild(next, start);
    }
    save(next);
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}

function weekSessions() {
  return [...(state.plans[dayKey(week)] || []), ...state.history.filter(item => item.start >= +week && item.start < +addDays(week, 7))].sort((a, b) => a.start - b.start);
}

function render() {
  let events = [];
  calendarError = '';
  try { events = eventsFor(state, week); } catch (error) { calendarError = error.message; }
  const sessions = weekSessions();
  const completed = sessions.filter(item => item.status === 'completed');
  const active = sessions.filter(item => item.status !== 'skipped');
  const doneMinutes = completed.reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0);
  const plannedMinutes = active.reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0);
  const freeMinutes = freeWindows(events, week, state.settings).reduce((sum, item) => sum + (item.end - item.start) / MINUTE, 0);
  const best = [...bands].sort((a, b) => {
    const date = hour => new Date(week).setHours(hour);
    return scoreTime(date({morning:9, afternoon:14, evening:18}[b]), state.settings, state.history, state.context) - scoreTime(date({morning:9, afternoon:14, evening:18}[a]), state.settings, state.history, state.context);
  })[0];
  const goal = state.settings.hours;
  const stat = (label, value, note, symbol, progress) => `<div class="stat-card"><div class="stat-label">${label}</div><span class="stat-symbol" aria-hidden="true">${symbol}</span><div class="stat-value">${value}</div><p>${note}</p>${progress !== undefined ? `<div class="progress-track"><i style="width:${Math.min(100, progress)}%"></i></div>` : ''}</div>`;
  $('#overview').innerHTML = stat('Study this week', `${hours(doneMinutes)} <span>/ ${goal} hrs</span>`, `${hours(plannedMinutes)} hrs planned · ${completed.length} completed`, '◷', doneMinutes / (goal * 60) * 100) + stat('Room in your week', calendarError ? '—' : `${hours(freeMinutes)} <span>hrs free</span>`, 'Within your remaining study hours', '▦') + stat('Your best time', capital(best), state.history.length ? `Based on ${state.history.length} check-in${state.history.length === 1 ? '' : 's'}` : 'Your starting preference · still learning', '✧');
  $('#date-label').textContent = format(Date.now(), { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  $('#week-label').textContent = `${format(week, { month: 'short', day: 'numeric' })} – ${format(addDays(week, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;
  $('#timezone').textContent = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop().replaceAll('_', ' ');
  $('#context').value = state.context;
  $('#calendar-source').textContent = state.sources.length ? state.sources.some(source => source.sample) ? 'Sample calendar · device only' : `${state.sources.length} imported calendar${state.sources.length === 1 ? '' : 's'} · file snapshot` : 'No calendar imported';
  $('#plan-button').disabled = Boolean(calendarError) || +addDays(week, 7) <= Date.now();
  $('#export-button').disabled = !active.length || Boolean(calendarError);
  const messages = [storageWarning, calendarError, state.sources.some(source => source.sample) ? 'You’re exploring a sample calendar. Import yours to make this week your own.' : !state.sources.length ? 'No calendar imported. Plans assume your study hours are free.' : '', plannedMinutes < goal * 60 && +addDays(week, 7) > Date.now() && !calendarError ? `${hours(goal * 60 - plannedMinutes)} hrs of your goal remain unplanned. Try shorter sessions or more study days.` : ''].filter(Boolean);
  $('#notice').hidden = !messages.length;
  $('#notice').textContent = messages.join(' ');
  renderCalendar(events.filter(item => !active.some(session => session.id === item.id)), active);
  renderSessions(sessions);
  renderNext(sessions);
  renderRhythm();
  $('#sources').innerHTML = state.sources.map(source => `<div class="source-row"><span>${escape(source.name)}</span><button class="text-button danger" data-remove="${escape(source.id)}">Remove</button></div>`).join('');
  $('#offline-status').textContent = storageWarning ? 'Temporary workspace · storage unavailable' : `Saved on this device${offlineReady ? ' · ready offline' : ''}`;
}

function renderCalendar(events, sessions) {
  const from = Math.min(8, state.settings.startHour);
  const until = Math.max(20, state.settings.endHour);
  const span = until - from;
  const today = dayKey(Date.now());
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const headings = '<div class="day-heading"></div>' + days.map(date => `<div class="day-heading ${dayKey(date) === today ? 'today' : ''}">${format(date, {weekday:'short'}).toUpperCase()}<b>${date.getDate()}</b></div>`).join('');
  const labels = `<div class="time-column">${Array.from({length: span}, (_, i) => `<span class="time-label" style="top:${i / span * 100}%">${(i + from) % 12 || 12}${i + from < 12 ? 'a' : 'p'}</span>`).join('')}</div>`;
  const columns = days.map(date => {
    const dayStart = new Date(date).setHours(from, 0, 0, 0);
    const dayEnd = new Date(date).setHours(until, 0, 0, 0);
    const items = [...events, ...sessions].filter(item => item.start < dayEnd && item.end > dayStart).sort((a, b) => a.start - b.start || b.end - a.end);
    const groups = [];
    for (const item of items) {
      let group = groups.at(-1);
      if (!group || item.start >= group.end) { group = { end: item.end, items: [], lanes: [] }; groups.push(group); }
      let lane = group.lanes.findIndex(end => end <= item.start);
      if (lane < 0) lane = group.lanes.length;
      group.lanes[lane] = item.end;
      group.end = Math.max(group.end, item.end);
      group.items.push({ ...item, lane });
    }
    const blocks = groups.map(group => group.items.map(item => {
      const start = Math.max(dayStart, item.start);
      const end = Math.min(dayEnd, item.end);
      const top = (start - dayStart) / (dayEnd - dayStart) * 100;
      const height = (end - start) / (dayEnd - dayStart) * 100;
      const label = `${item.title}, ${item.allDay ? 'all day' : `${time(item.start)} to ${time(item.end)}`}`;
      return `<button class="calendar-event ${item.status ? 'study' : ''} ${item.status === 'completed' ? 'completed' : ''} ${item.end < Date.now() && !item.status ? 'past' : ''}" data-event="${escape(item.id)}" aria-label="${escape(label)}" title="${escape(label)}" style="top:${top}%;height:calc(${height}% - 2px);left:calc(${item.lane / group.lanes.length * 100}% + 3px);width:calc(${100 / group.lanes.length}% - 6px)"><strong>${escape(item.title)}</strong>${height > 5 ? `<small>${item.allDay ? 'All day' : time(item.start)}</small>` : ''}</button>`;
    }).join('')).join('');
    return `<div class="day-column ${dayKey(date) === today ? 'today' : ''}" style="--hours:${span}">${blocks}</div>`;
  }).join('');
  $('#calendar').innerHTML = headings + labels + columns;
}

function outcomeButtons(item) {
  if (item.status !== 'planned') return `<span class="status-label ${item.status}">${capital(item.status)}</span><button class="text-button" data-undo="${escape(item.id)}">Undo</button>`;
  return `<button class="text-button" data-outcome="skipped" data-id="${escape(item.id)}">Skip</button><button class="button" data-outcome="completed" data-id="${escape(item.id)}">Mark done</button>`;
}

function renderSessions(sessions) {
  $('#session-count').textContent = `${sessions.filter(item => item.status === 'planned').length} planned`;
  $('#sessions').innerHTML = sessions.length ? sessions.map(item => `<article class="session-row"><div class="session-day">${format(item.start,{weekday:'short'}).toUpperCase()}<b>${new Date(item.start).getDate()}</b></div><div class="session-info"><strong>${escape(item.title)}</strong><p>${time(item.start)} – ${time(item.end)} · ${(item.end-item.start)/MINUTE} min${item.context !== 'unspecified' ? ` · ${escape(contextNames[item.context])}` : ''}${item.status === 'planned' && item.end < Date.now() ? ' · Awaiting check-in' : ''}</p></div><span class="session-reason">${escape(item.reason)}</span><div class="session-actions">${outcomeButtons(item)}</div></article>`).join('') : '<div class="empty">No study sessions this week.<br>Adjust your preferences or choose a future week to plan.</div>';
}

function renderNext(sessions) {
  const next = sessions.find(item => item.status === 'planned' && item.end > Date.now());
  $('#next-session').innerHTML = next ? `<h3>${escape(next.title)}</h3><p>${time(next.start)} – ${time(next.end)}</p><div class="session-date">${format(next.start, { weekday:'long', month:'short', day:'numeric' })} · ${(next.end-next.start)/MINUTE} minutes</div><button class="button primary" data-event="${escape(next.id)}">View session <span aria-hidden="true">↗</span></button><div class="reason"><span aria-hidden="true">✧</span>${escape(next.reason)}</div>` : '<h3>A little breathing room.</h3><p>No upcoming sessions in this week. Adjust your study preferences or explore next week.</p><button class="button" data-preferences>Adjust preferences</button>';
}

function renderRhythm() {
  $('#rhythm').innerHTML = '<p>' + (state.history.length ? 'Completed sessions by time of day. Skips also shape your next plan.' : 'Check in after a session. Your plan learns when you follow through.') + '</p>' + bands.map(period => {
    const history = state.history.filter(item => band(item.start) === period);
    const done = history.filter(item => item.status === 'completed').length;
    return `<div class="rhythm-row"><span>${capital(period)}</span><div class="rhythm-bar"><i style="width:${history.length ? done / history.length * 100 : 0}%"></i></div><b>${history.length ? `${done}/${history.length}` : '—'}</b></div>`;
  }).join('');
}

function showPreferences() {
  const form = $('#preferences-form');
  for (const [name, value] of Object.entries(state.settings)) {
    if (name === 'days') continue;
    form.elements[name].value = name.endsWith('Hour') ? `${String(value).padStart(2, '0')}:00` : value;
  }
  $('#study-days').innerHTML = [1,2,3,4,5,6,0].map(day => `<label><input type="checkbox" name="days" value="${day}" ${state.settings.days.includes(day) ? 'checked' : ''} /><span>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]}</span></label>`).join('');
  $('#preferences-dialog').showModal();
}

function showEvent(id) {
  let item = weekSessions().find(event => event.id === id);
  if (!item) {
    try { item = eventsFor(state, week).find(event => event.id === id); } catch (error) { toast(error.message); return; }
  }
  if (!item) return;
  $('#event-title').textContent = item.title;
  $('#event-detail').innerHTML = `<p>${format(item.start, {weekday:'long',month:'long',day:'numeric'})}<br>${item.allDay ? 'All day' : `${time(item.start)} – ${time(item.end)}`}</p>${item.status ? `<p>${escape(item.reason)}${item.context !== 'unspecified' ? `<br>Planned environment: ${escape(contextNames[item.context])}` : ''}</p><div class="session-actions">${outcomeButtons(item)}</div>` : `<p>${escape(item.location || 'Imported calendar event. This time is kept clear of study sessions.')}</p>`}`;
  $('#event-dialog').showModal();
}

function checkIn(id, status) {
  const session = weekSessions().find(item => item.id === id && item.status === 'planned');
  if (!session) throw new Error('This session is no longer planned.');
  if (!update(next => {
    next.history = recordOutcome(next.history, session, status, next.context);
    next.plans[dayKey(week)] = next.plans[dayKey(week)].filter(item => item.id !== id);
  }, 'all')) return false;
  $('#event-dialog').close();
  toast(status === 'completed' ? 'Session completed. Your next plan learns from it.' : 'Session skipped. We’ll look for another time.');
  return true;
}

$('#preferences-button').onclick = showPreferences;
for (const id of ['import-button', 'calendar-button']) $(`#${id}`).onclick = () => $('#calendar-dialog').showModal();
$('#choose-file').onclick = () => $('#calendar-file').click();
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => button.closest('dialog').close();
$('#preferences-form').onsubmit = event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const settings = { hours: Number(form.get('hours')), duration: Number(form.get('duration')), preferred: form.get('preferred'), startHour: Number(form.get('startHour').split(':')[0]), endHour: Number(form.get('endHour').split(':')[0]), days: form.getAll('days').map(Number) };
  try { validateSettings(settings); } catch (error) { toast(error.message); return; }
  if (update(next => { next.settings = settings; }, 'all')) { $('#preferences-dialog').close(); toast('Preferences saved. Your study plan is updated.'); }
};
$('#plan-button').onclick = () => { if (update(() => {})) toast('Study plan refreshed around your calendar.'); };
$('#context').onchange = event => { if (!update(next => { next.context = event.target.value; }, 'all')) $('#context').value = state.context; };

function navigate(start) {
  week = start;
  if (!Object.hasOwn(state.plans, dayKey(week)) && +addDays(week, 7) > Date.now()) update(() => {});
  else render();
}
$('#previous-week').onclick = () => navigate(addDays(week, -7));
$('#next-week').onclick = () => navigate(addDays(week, 7));
$('#today-button').onclick = () => navigate(weekStart());

$('#calendar-file').onchange = async event => {
  const files = [...event.target.files];
  event.target.value = '';
  if (!files.length) return;
  try {
    const sources = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: choose a file smaller than 2 MB.`);
      const text = await file.text();
      readCalendar(text, weekStart(), addDays(weekStart(), 84));
      sources.push({ id: crypto.randomUUID(), name: file.name, text });
    }
    if (update(next => {
      const wasSample = next.sources.some(source => source.sample);
      next.sources = [...next.sources.filter(source => !source.sample && !sources.some(item => item.name === source.name)), ...sources];
      if (wasSample) { next.history = []; next.plans = {}; }
      else {
        // New commitments invalidate stale plans, including already-started sessions.
        next.plans = Object.fromEntries(Object.keys(next.plans).map(key => [key, []]));
      }
    }, 'all')) { $('#calendar-dialog').close(); toast(`${files.length} calendar${files.length === 1 ? '' : 's'} imported. Study times updated.`); }
  } catch (error) { toast(`Import failed: ${error.message}`); }
};
$('#demo-button').onclick = () => {
  if (state.sources.some(source => !source.sample) || (state.history.length && !state.sources.some(source => source.sample))) { toast('Clear device data before trying the sample.'); return; }
  if (update(next => { next.sources = freshState(true).sources; }, 'all')) { $('#calendar-dialog').close(); toast('Sample calendar loaded.'); }
};
$('#export-button').onclick = () => {
  const sessions = weekSessions().filter(item => item.status !== 'skipped');
  if (!sessions.length) return;
  const url = URL.createObjectURL(new Blob([exportCalendar(sessions)], {type:'text/calendar;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = `margin-study-${dayKey(week)}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Study plan exported. Import the .ics file into Google or Apple Calendar.');
};
$('#clear-button').onclick = () => {
  if (!confirm('Clear calendars, study history, preferences, and saved places from this device? This cannot be undone.')) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    stopLocation();
    storageWarning = '';
    week = weekStart();
    const next = freshState();
    rebuild(next, week);
    save(next);
    $('#calendar-dialog').close();
    toast('Device data cleared.');
  } catch (error) { toast(error.message); }
};

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.event) showEvent(button.dataset.event);
  if (button.hasAttribute('data-preferences')) showPreferences();
  if (button.dataset.outcome) checkIn(button.dataset.id, button.dataset.outcome);
  if (button.dataset.undo && update(next => {
    const original = next.history.find(item => item.id === button.dataset.undo);
    next.history = next.history.filter(item => item.id !== button.dataset.undo);
    if (original) next.plans[dayKey(week)].push({ ...original, status: 'planned' });
  }, 'all')) { $('#event-dialog').close(); toast('Check-in undone.'); }
  if (button.dataset.remove) update(next => {
    if (next.sources.find(source => source.id === button.dataset.remove)?.sample) { next.history = []; next.plans = {}; }
    next.sources = next.sources.filter(source => source.id !== button.dataset.remove);
  }, 'all');
});

function stopLocation() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  position = null;
  $('#location-button').textContent = 'Enable location';
  $('#remember-place').hidden = true;
  $('#location-status').textContent = 'Location is off. Saved places stay on this device.';
}
$('#location-button').onclick = () => {
  if (watchId !== null) { stopLocation(); return; }
  if (!navigator.geolocation) { toast('Location is unavailable. Choose your environment manually.'); return; }
  $('#location-status').textContent = 'Waiting for location permission…';
  $('#location-button').textContent = 'Disable location';
  watchId = navigator.geolocation.watchPosition(result => {
    position = { latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy };
    $('#remember-place').hidden = false;
    const match = state.places.find(place => distance(place, position) + position.accuracy <= 250);
    $('#location-status').textContent = match ? `Near your saved ${contextNames[match.context].toLowerCase()} · accurate to ${Math.round(position.accuracy)} m` : `Location found · accurate to ${Math.round(position.accuracy)} m. Choose a place above, then remember it.`;
    if (match && match.context !== state.context) update(next => { next.context = match.context; }, 'all');
  }, error => {
    stopLocation();
    $('#location-status').textContent = error.code === 1 ? 'Permission denied. You can still choose a place manually.' : 'Location unavailable. Choose a place manually or try again.';
  }, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 });
};
$('#remember-place').onclick = () => {
  if (!position || state.context === 'unspecified') { toast('Choose a study environment first.'); return; }
  if (position.accuracy > 150) { toast('Location is too approximate to remember reliably. Try again near a window.'); return; }
  if (update(next => { next.places = [...next.places.filter(place => place.context !== next.context), { latitude: position.latitude, longitude: position.longitude, context: next.context }]; })) toast(`${contextNames[state.context]} saved on this device.`);
};
window.addEventListener('pagehide', stopLocation);
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { state = load(); render(); } });
function networkStatus() { $('#network-state').textContent = navigator.onLine ? 'Local workspace' : 'Working offline'; }
window.addEventListener('online', networkStatus);
window.addEventListener('offline', networkStatus);
networkStatus();

try {
  if (!Object.hasOwn(state.plans, dayKey(week))) { rebuild(state, week); save(state); }
  else render();
} catch (error) { storageWarning = error.message; render(); }

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => {
    offlineReady = true;
    render();
  }).catch(() => { $('#offline-status').textContent = 'Saved on this device · offline setup unavailable'; });
}
