import ICAL from 'ical.js';

const MAX_OCCURRENCES = 20_000;
export const MAX_FILE_BYTES = 2_000_000;

function parse(text) {
  let calendar;
  try {
    calendar = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error('This file is not a valid .ics calendar. Export it again from your calendar app.');
  }
  if (calendar.name !== 'vcalendar') throw new Error('Choose an iCalendar (.ics) file.');
  ICAL.TimezoneService.reset();
  for (const component of calendar.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone({ component });
    ICAL.TimezoneService.register(zone.tzid, zone);
  }
  const components = calendar.getAllSubcomponents('vevent');
  for (const component of components) {
    for (const property of component.getAllProperties()) {
      const zone = property.getParameter('tzid');
      if (zone && !ICAL.TimezoneService.has(zone)) throw new Error(`Missing time zone definition for ${zone}. Re-export with time zone data or UTC times.`);
    }
    for (const rule of component.getAllProperties('rrule')) {
      if (['SECONDLY', 'MINUTELY', 'HOURLY'].includes(rule.getFirstValue().freq)) throw new Error('Hourly or more frequent repeating events are not supported.');
    }
  }
  return components;
}

export function readCalendar(text, rangeStart, rangeEnd, sourceId = 'calendar') {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Choose a calendar smaller than 2 MB.');
  const components = parse(text);
  const events = new Map();
  let iterations = 0;
  function add(item, startDate, endDate, recurrenceId) {
    if (item.component.getFirstPropertyValue('status') === 'CANCELLED' || item.component.getFirstPropertyValue('transp') === 'TRANSPARENT') return;
    if (!startDate) throw new Error('A calendar event is missing its start date.');
    const start = +startDate.toJSDate();
    const end = +endDate.toJSDate();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('A calendar event has invalid dates.');
    if (start >= +rangeEnd || end <= +rangeStart || start === end) return;
    const studyId = item.uid?.endsWith('@margin.local') ? item.uid.slice(0, -'@margin.local'.length) : null;
    const id = studyId || `${sourceId}:${item.uid}:${recurrenceId || start}`;
    const entry = { id, title: item.summary || 'Busy', start, end, allDay: startDate.isDate, location: item.location || '', sourceId };
    if (studyId) Object.assign(entry, { title: entry.title.replace(/^Study: /, ''), status: 'planned', context: 'unspecified', reason: 'Imported study session' });
    events.set(id, entry);
  }
  for (const component of components) {
    if (component.hasProperty('recurrence-id') || component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const event = new ICAL.Event(component);
    if (!event.startDate) throw new Error('A calendar event is missing its start date.');
    if (!event.isRecurring()) {
      add(event, event.startDate, event.endDate);
      continue;
    }
    const iterator = event.iterator();
    let occurrence;
    while ((occurrence = iterator.next())) {
      if (++iterations > MAX_OCCURRENCES) throw new Error('This calendar has too many repetitions. Export a shorter date range.');
      if (+occurrence.toJSDate() >= +rangeEnd) break;
      const details = event.getOccurrenceDetails(occurrence);
      add(details.item, details.startDate, details.endDate, occurrence.toString());
    }
  }
  // Include exceptions moved into the window from outside it; Map removes duplicates.
  for (const component of components.filter(item => item.hasProperty('recurrence-id'))) {
    if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
    const event = new ICAL.Event(component);
    add(event, event.startDate, event.endDate, event.recurrenceId.toString());
  }
  return [...events.values()].sort((a, b) => a.start - b.start);
}

export function exportCalendar(sessions, now = new Date()) {
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//Margin//Study planner//EN');
  calendar.updatePropertyWithValue('calscale', 'GREGORIAN');
  for (const session of sessions.filter(item => item.status !== 'skipped')) {
    const component = new ICAL.Component('vevent');
    const event = new ICAL.Event(component);
    event.uid = `${session.id}@margin.local`;
    event.summary = `Study: ${session.title}`;
    event.startDate = ICAL.Time.fromJSDate(new Date(session.start), true);
    event.endDate = ICAL.Time.fromJSDate(new Date(session.end), true);
    event.description = session.reason || 'Study time planned with Margin.';
    if (session.context !== 'unspecified') event.location = session.context;
    component.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(now, true));
    calendar.addSubcomponent(component);
  }
  return calendar.toString() + '\r\n';
}

export function sampleCalendar(monday) {
  const blocks = [[0, 9, 90, 'Design studio'], [0, 13, 60, 'Lunch with Maya'], [1, 10, 90, 'Computer science'], [1, 15, 60, 'Team project'], [2, 9, 90, 'Design studio'], [2, 14, 60, 'Office hours'], [3, 12, 90, 'Research seminar'], [3, 17, 60, 'Gym'], [4, 9, 90, 'Design studio'], [4, 14, 90, 'Weekly review']];
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//Margin//Sample calendar//EN');
  for (const [index, hour, minutes, title] of blocks) {
    const start = new Date(monday);
    start.setDate(start.getDate() + index);
    start.setHours(hour, 0, 0, 0);
    const component = new ICAL.Component('vevent');
    const event = new ICAL.Event(component);
    event.uid = `sample-${index}-${hour}`;
    event.summary = title;
    event.startDate = ICAL.Time.fromJSDate(start);
    event.endDate = ICAL.Time.fromJSDate(new Date(+start + minutes * 60_000));
    component.updatePropertyWithValue('rrule', ICAL.Recur.fromString('FREQ=WEEKLY;COUNT=12'));
    calendar.addSubcomponent(component);
  }
  return calendar.toString();
}
