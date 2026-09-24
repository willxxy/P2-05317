import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, MINUTE, BUFFER, weekStart, addDays, freeWindows, planWeek, recordOutcome, scoreTime, validateSettings, distance, overlaps } from '../src/planner.js';

const start = new Date(2026, 8, 21);
const at = (day, hour, minute = 0) => new Date(2026, 8, 21 + day, hour, minute).getTime();
const settings = { ...defaults, hours: 6, duration: 60 };
const run = overrides => planWeek({ events: [], history: [], settings, start, now: +start, ...overrides });

test('fills the target without overlaps or calendar conflicts, with buffers', () => {
  const events = [{ start: at(0, 9), end: at(0, 12) }, { start: at(1, 8), end: at(1, 21) }];
  const { sessions, remainingMinutes } = run({ events });
  assert.equal(sessions.length, 6);
  assert.equal(remainingMinutes, 0);
  sessions.forEach((session, index) => {
    assert.ok(!events.some(event => overlaps(session, event, BUFFER)));
    assert.ok(!sessions.slice(index + 1).some(event => overlaps(session, event, BUFFER)));
    assert.ok(new Date(session.start).getDay() >= 1 && new Date(session.start).getDay() <= 5);
  });
});

test('merges overlapping busy intervals and clips to study hours', () => {
  const windows = freeWindows([{start:at(0,7),end:at(0,10)}, {start:at(0,9),end:at(0,12)}, {start:at(0,19),end:at(1,2)}], start, {...settings,days:[1]}, +start);
  assert.deepEqual(windows, [{start:at(0,12,15),end:at(0,18,45)}]);
});

test('all-day and overnight events block affected time', () => {
  const events = [{start:at(0,0),end:at(1,0)}, {start:at(1,20),end:at(2,10)}];
  const {sessions} = run({events});
  assert.ok(sessions.every(session => !events.some(event => overlaps(session,event,BUFFER))));
});

test('never schedules in the past and reports insufficient capacity', () => {
  const {sessions,remainingMinutes} = run({now:at(4,20,30)});
  assert.equal(sessions.length,0);
  assert.equal(remainingMinutes,360);
});

test('quarter-hour alignment rounds seconds up', () => {
  const {sessions} = run({now:at(0,8)+1000});
  assert.ok(sessions.every(item => new Date(item.start).getMinutes() % 15 === 0));
  assert.ok(sessions.every(item => item.start >= at(0,8,15)));
});

test('feedback changes the preferred time and skipped slots stay excluded', () => {
  const history = Array.from({length:10},(_,i)=>({id:`history-${i}`,start:at(-14+i,9),end:at(-14+i,10),status:'skipped',context:'home'}));
  assert.ok(scoreTime(at(0,14),settings,history,'home') > scoreTime(at(0,9),settings,history,'home'));
  const skipped = {id:'skip',start:at(0,14),end:at(0,15),status:'skipped',context:'home'};
  const result = run({history:[...history,skipped]});
  assert.ok(result.sessions.every(item=>!overlaps(item,skipped)));
  assert.ok(result.sessions.some(item=>new Date(item.start).getHours() >= 12));
});

test('completed and reserved sessions count toward the goal', () => {
  const completed = {id:'complete',start:at(0,8),end:at(0,9),status:'completed'};
  const reserved = {id:'pending',start:at(0,10),end:at(0,11),status:'planned'};
  const result = run({history:[completed],reserved:[reserved],now:at(0,10,30)});
  assert.equal(result.sessions.length,4);
  assert.equal(result.remainingMinutes,0);
  assert.ok(result.sessions.every(item=>!overlaps(item,reserved,BUFFER)));
});

test('repeated feedback is idempotent and outcomes are validated', () => {
  const item={id:'same',start:at(0,8),end:at(0,9)};
  const once=recordOutcome([],item,'completed','home');
  const twice=recordOutcome(once,item,'completed','home');
  assert.equal(twice.length,1);
  assert.throws(()=>recordOutcome([],item,'unknown','home'));
});

test('a full calendar yields no sessions rather than conflicts', () => {
  const result=run({events:[{start:+start,end:+addDays(start,7)}]});
  assert.equal(result.sessions.length,0);
  assert.equal(result.freeMinutes,0);
});

test('validates settings and supports fractional goals without overshooting', () => {
  assert.throws(()=>validateSettings({...settings,days:[]}));
  assert.throws(()=>validateSettings({...settings,startHour:20,endHour:8}));
  assert.throws(()=>validateSettings({...settings,hours:NaN}));
  const result=run({settings:{...settings,hours:1.5,duration:60}});
  assert.equal(result.sessions.length,1);
  assert.equal(result.remainingMinutes,30);
});

test('calendar arithmetic preserves local dates across DST', () => {
  const sunday=new Date(2026,10,1,12);
  const monday=weekStart(sunday);
  assert.equal(monday.getDay(),1);
  assert.equal(monday.getHours(),0);
  assert.equal(addDays(monday,7).getHours(),0);
});

test('saved-place distances use meters', () => {
  assert.equal(distance({latitude:40,longitude:-74},{latitude:40,longitude:-74}),0);
  assert.ok(distance({latitude:40,longitude:-74},{latitude:40.001,longitude:-74})>100);
  assert.ok(distance({latitude:40,longitude:-74},{latitude:40.001,longitude:-74})<120);
});
