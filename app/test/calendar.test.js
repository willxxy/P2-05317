import test from 'node:test';
import assert from 'node:assert/strict';
import { readCalendar, exportCalendar, sampleCalendar } from '../src/calendar.js';

const from = new Date('2026-09-21T00:00:00Z');
const until = new Date('2026-09-28T00:00:00Z');
const wrap = body => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n${body}\r\nEND:VCALENDAR`;
const event = body => `BEGIN:VEVENT\r\nUID:test\r\n${body}\r\nEND:VEVENT`;

test('expands recurring events, honoring exclusions and moved exceptions', () => {
  const raw=wrap(event('DTSTART:20260921T090000Z\r\nDTEND:20260921T100000Z\r\nRRULE:FREQ=DAILY;COUNT=5\r\nEXDATE:20260922T090000Z\r\nSUMMARY:Class')+'\r\n'+event('RECURRENCE-ID:20260923T090000Z\r\nDTSTART:20260923T140000Z\r\nDTEND:20260923T150000Z\r\nSUMMARY:Moved class'));
  const events=readCalendar(raw,from,until);
  assert.equal(events.length,4);
  assert.equal(events[1].start,Date.parse('2026-09-23T14:00:00Z'));
  assert.equal(events[1].title,'Moved class');
});

test('ignores cancelled occurrences and transparent events', () => {
  const raw=wrap(event('DTSTART:20260921T090000Z\r\nDTEND:20260921T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3')+'\r\n'+event('RECURRENCE-ID:20260922T090000Z\r\nDTSTART:20260922T090000Z\r\nDTEND:20260922T100000Z\r\nSTATUS:CANCELLED')+'\r\n'+event('DTSTART:20260924T090000Z\r\nDTEND:20260924T100000Z\r\nTRANSP:TRANSPARENT'));
  assert.equal(readCalendar(raw,from,until).length,2);
});

test('all-day dates use exclusive end dates in local time', () => {
  const raw=wrap(event('DTSTART;VALUE=DATE:20260922\r\nDTEND;VALUE=DATE:20260924\r\nSUMMARY:Away'));
  const [item]=readCalendar(raw,from,until);
  assert.ok(item.allDay);
  assert.equal(new Date(item.start).getDate(),22);
  assert.equal(new Date(item.end).getDate(),24);
  assert.equal(new Date(item.start).getHours(),0);
});

test('unfolds and unescapes text without treating it as HTML', () => {
  const raw=wrap(event('DTSTART:20260922T090000Z\r\nDTEND:20260922T100000Z\r\nSUMMARY:Long title\\, with\r\n  a folded line <script>'));
  assert.equal(readCalendar(raw,from,until)[0].title,'Long title, with a folded line <script>');
});

test('resolves VTIMEZONE transitions, including DST', () => {
  const zone='BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700308T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nDTSTART:19701101T020000\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nEND:STANDARD\r\nEND:VTIMEZONE';
  const raw=wrap(zone+'\r\n'+event('DTSTART;TZID=America/New_York:20261030T090000\r\nDTEND;TZID=America/New_York:20261030T100000\r\nRRULE:FREQ=DAILY;COUNT=4'));
  const events=readCalendar(raw,new Date('2026-10-30'),new Date('2026-11-04'));
  assert.equal(events.length,4);
  assert.equal(events[0].start,Date.parse('2026-10-30T13:00:00Z'));
  assert.equal(events[2].start,Date.parse('2026-11-01T14:00:00Z'));
});

test('rejects missing zones, malformed files, and excessive-frequency rules', () => {
  assert.throws(()=>readCalendar('not a calendar',from,until), /not a valid \.ics calendar/);
  assert.throws(()=>readCalendar(wrap(event('DTSTART;TZID=Missing/Zone:20260922T090000\r\nDTEND;TZID=Missing/Zone:20260922T100000')),from,until),/Missing time zone/);
  assert.throws(()=>readCalendar(wrap(event('DTSTART:20260922T090000Z\r\nDTEND:20260922T100000Z\r\nRRULE:FREQ=SECONDLY')),from,until),/not supported/);
});

test('an exception moved in from after the window is retained once', () => {
  const raw=wrap(event('DTSTART:20260921T090000Z\r\nDTEND:20260921T100000Z\r\nRRULE:FREQ=WEEKLY;COUNT=2')+'\r\n'+event('RECURRENCE-ID:20260928T090000Z\r\nDTSTART:20260925T140000Z\r\nDTEND:20260925T150000Z'));
  assert.equal(readCalendar(raw,from,until).length,2);
});

test('export/import round trip preserves UTC times, stable IDs and escaped text', () => {
  const sessions=[{id:'stable',title:'Math, proofs; practice',start:Date.parse('2026-09-22T09:00:00Z'),end:Date.parse('2026-09-22T10:00:00Z'),status:'planned',context:'library',reason:'First line\nSecond line'},{id:'skip',title:'Skipped',start:+from,end:+from+3600000,status:'skipped'}];
  const raw=exportCalendar(sessions);
  const events=readCalendar(raw,from,until);
  assert.equal(events.length,1);
  assert.equal(events[0].start,sessions[0].start);
  assert.equal(events[0].end,sessions[0].end);
  assert.equal(events[0].title,'Study: Math, proofs; practice');
  assert.match(raw,/UID:stable@margin.local/);
  assert.match(raw,/DTSTAMP:/);
});

test('sample calendar works without a network or account', () => {
  assert.equal(readCalendar(sampleCalendar(new Date(2026,8,21)),from,until).length,10);
});
