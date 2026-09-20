import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSchedule,
  computeCandidates,
  normalizeCode,
  participantCandidateStatus,
  validateCandidateSelection,
  validateRoundSettings,
} from '../src/core.js';

test('normalizes group codes', () => {
  assert.equal(normalizeCode(' padel 4!! '), 'PADEL4');
});

test('builds weekday and weekend slots with 30-minute granularity', () => {
  const round = validateRoundSettings({
    startDate: '2026-09-21',
    endDate: '2026-09-27',
    durationMinutes: 90,
    weekdayStart: '18:00',
    weekdayEnd: '20:00',
    weekendStart: '08:00',
    weekendEnd: '10:00',
    allowedDays: [0, 1, 2, 3, 4, 5, 6],
  });
  const schedule = buildSchedule(round);
  assert.equal(schedule.length, 7);
  assert.deepEqual(schedule[0].slots, [
    '2026-09-21T18:00',
    '2026-09-21T18:30',
    '2026-09-21T19:00',
    '2026-09-21T19:30',
  ]);
  assert.deepEqual(schedule[0].starts, ['2026-09-21T18:00', '2026-09-21T18:30']);
  assert.equal(schedule[5].slots[0], '2026-09-26T08:00');
});

test('candidate status requires the full activity duration', () => {
  const availability = {
    '2026-09-21T18:00': 'yes',
    '2026-09-21T18:30': 'yes',
    '2026-09-21T19:00': 'maybe',
  };
  assert.equal(participantCandidateStatus(availability, '2026-09-21T18:00', 90), 'maybe');
  delete availability['2026-09-21T19:00'];
  assert.equal(participantCandidateStatus(availability, '2026-09-21T18:00', 90), 'unknown');
  availability['2026-09-21T19:00'] = 'no';
  assert.equal(participantCandidateStatus(availability, '2026-09-21T18:00', 90), 'no');
});

test('ranks an all-available time ahead of a maybe time', () => {
  const round = validateRoundSettings({
    startDate: '2026-09-21',
    endDate: '2026-09-21',
    durationMinutes: 60,
    weekdayStart: '18:00',
    weekdayEnd: '20:00',
    weekendStart: '08:00',
    weekendEnd: '10:00',
    allowedDays: [1],
  });
  const participants = ['A', 'B', 'C', 'D'].map((name) => ({ id: name, name }));
  const availability = Object.fromEntries(participants.map(({ id }) => [id, {
    '2026-09-21T18:00': 'yes',
    '2026-09-21T18:30': 'yes',
    '2026-09-21T19:00': id === 'D' ? 'maybe' : 'yes',
    '2026-09-21T19:30': id === 'D' ? 'maybe' : 'yes',
  }]));
  const candidates = computeCandidates(participants, availability, round, 4);
  assert.equal(candidates[0].startKey, '2026-09-21T18:00');
  assert.equal(candidates[0].classification, 'ready');
  assert.equal(candidates.find((c) => c.startKey === '2026-09-21T19:00').classification, 'possible');
});

test('confirmation requires exactly the configured player count and no unanswered slots', () => {
  const round = validateRoundSettings({
    startDate: '2026-09-21',
    endDate: '2026-09-21',
    durationMinutes: 60,
    weekdayStart: '18:00',
    weekdayEnd: '20:00',
    weekendStart: '08:00',
    weekendEnd: '10:00',
    allowedDays: [1],
  });
  const state = {
    requiredPeople: 2,
    round,
    participants: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    availability: {
      A: { '2026-09-21T18:00': 'yes', '2026-09-21T18:30': 'yes' },
      B: { '2026-09-21T18:00': 'maybe', '2026-09-21T18:30': 'yes' },
      C: { '2026-09-21T18:00': 'yes' },
    },
  };
  assert.deepEqual(validateCandidateSelection(state, '2026-09-21T18:00', ['A', 'B']), ['A', 'B']);
  assert.throws(() => validateCandidateSelection(state, '2026-09-21T18:00', ['A']), /exactly 2/);
  assert.throws(() => validateCandidateSelection(state, '2026-09-21T18:00', ['A', 'C']), /Available or Maybe/);
});
