export const SLOT_MINUTES = 30;
export const STATUS_VALUES = new Set(['yes', 'maybe', 'no']);
export const CODE_RE = /^[A-Z0-9][A-Z0-9-]{3,19}$/;

export function normalizeCode(value = '') {
  return String(value).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
}

export function cleanName(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').slice(0, 40);
}

export function parseTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatTime(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function addMinutesToSlot(slotKey, minutes) {
  const [date, time] = String(slotKey).split('T');
  const start = parseTime(time);
  if (!date || start == null) return null;
  return `${date}T${formatTime(start + minutes)}`;
}

export function validDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function daysBetween(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86400000);
}

export function validateRoundSettings(input = {}) {
  const startDate = String(input.startDate || '');
  const endDate = String(input.endDate || '');
  const durationMinutes = Number(input.durationMinutes || 90);
  const weekdayStart = String(input.weekdayStart || '18:00');
  const weekdayEnd = String(input.weekdayEnd || '22:00');
  const weekendStart = String(input.weekendStart || '08:00');
  const weekendEnd = String(input.weekendEnd || '20:00');
  const allowedDays = Array.isArray(input.allowedDays)
    ? [...new Set(input.allowedDays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [0, 1, 2, 3, 4, 5, 6];

  if (!validDateString(startDate) || !validDateString(endDate)) {
    throw new Error('Choose a valid start and end date.');
  }
  const span = daysBetween(startDate, endDate);
  if (span < 0) throw new Error('The end date cannot be before the start date.');
  if (span > 60) throw new Error('A booking window can cover at most 61 days.');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 360 || durationMinutes % SLOT_MINUTES !== 0) {
    throw new Error('Duration must be between 30 and 360 minutes in 30-minute increments.');
  }
  if (allowedDays.length === 0) throw new Error('Select at least one day of the week.');

  const windows = [
    ['Weekday', weekdayStart, weekdayEnd, allowedDays.some((day) => day >= 1 && day <= 5)],
    ['Weekend', weekendStart, weekendEnd, allowedDays.includes(0) || allowedDays.includes(6)],
  ];
  for (const [label, start, end, used] of windows) {
    const startMin = parseTime(start);
    const endMin = parseTime(end);
    if (startMin == null || endMin == null) throw new Error(`${label} times are invalid.`);
    if (endMin <= startMin) throw new Error(`${label} end time must be later than the start time.`);
    if (used && endMin - startMin < durationMinutes) throw new Error(`${label} time window must be at least as long as the activity.`);
    if (startMin % SLOT_MINUTES !== 0 || endMin % SLOT_MINUTES !== 0) {
      throw new Error(`${label} times must use 30-minute increments.`);
    }
  }

  const normalized = {
    startDate,
    endDate,
    durationMinutes,
    weekdayStart,
    weekdayEnd,
    weekendStart,
    weekendEnd,
    allowedDays: allowedDays.sort((a, b) => a - b),
  };
  if (buildSchedule(normalized).length === 0) throw new Error('The selected date range does not contain any enabled days.');
  return normalized;
}

function dateRange(startDate, endDate) {
  const result = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return result;
}

export function buildSchedule(round) {
  const days = [];
  for (const date of dateRange(round.startDate, round.endDate)) {
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (!round.allowedDays.includes(dayOfWeek)) continue;
    const weekend = dayOfWeek === 0 || dayOfWeek === 6;
    const startMin = parseTime(weekend ? round.weekendStart : round.weekdayStart);
    const endMin = parseTime(weekend ? round.weekendEnd : round.weekdayEnd);
    const slots = [];
    for (let minute = startMin; minute + SLOT_MINUTES <= endMin; minute += SLOT_MINUTES) {
      slots.push(`${date}T${formatTime(minute)}`);
    }
    const starts = [];
    for (let minute = startMin; minute + round.durationMinutes <= endMin; minute += SLOT_MINUTES) {
      starts.push(`${date}T${formatTime(minute)}`);
    }
    days.push({ date, dayOfWeek, weekend, slots, starts });
  }
  return days;
}

export function slotKeysForCandidate(startKey, durationMinutes) {
  const keys = [];
  for (let offset = 0; offset < durationMinutes; offset += SLOT_MINUTES) {
    keys.push(addMinutesToSlot(startKey, offset));
  }
  return keys;
}

export function participantCandidateStatus(availability = {}, startKey, durationMinutes) {
  const keys = slotKeysForCandidate(startKey, durationMinutes);
  const values = keys.map((key) => availability[key]);
  if (values.some((value) => value === 'no')) return 'no';
  if (values.some((value) => !STATUS_VALUES.has(value))) return 'unknown';
  if (values.every((value) => value === 'yes')) return 'yes';
  return 'maybe';
}

function scoreCandidate(candidate, requiredPeople) {
  const yes = candidate.yesIds.length;
  const maybe = candidate.maybeIds.length;
  const unknown = candidate.unknownIds.length;
  let tier = 3;
  if (yes >= requiredPeople) tier = 0;
  else if (yes + maybe >= requiredPeople) tier = 1;
  else if (yes + maybe + unknown >= requiredPeople) tier = 2;
  return [tier, -yes, maybe, unknown, candidate.startKey];
}

function compareScore(a, b, requiredPeople) {
  const sa = scoreCandidate(a, requiredPeople);
  const sb = scoreCandidate(b, requiredPeople);
  for (let i = 0; i < sa.length; i += 1) {
    if (sa[i] < sb[i]) return -1;
    if (sa[i] > sb[i]) return 1;
  }
  return 0;
}

export function computeCandidates(participants, availability, round, requiredPeople, limit = 80) {
  const candidates = [];
  const schedule = buildSchedule(round);
  for (const day of schedule) {
    for (const startKey of day.starts) {
      const candidate = {
        startKey,
        endKey: addMinutesToSlot(startKey, round.durationMinutes),
        yesIds: [],
        maybeIds: [],
        noIds: [],
        unknownIds: [],
      };
      for (const participant of participants) {
        const status = participantCandidateStatus(availability[participant.id] || {}, startKey, round.durationMinutes);
        candidate[`${status}Ids`].push(participant.id);
      }
      const yes = candidate.yesIds.length;
      const maybe = candidate.maybeIds.length;
      const unknown = candidate.unknownIds.length;
      candidate.classification = yes >= requiredPeople
        ? 'ready'
        : yes + maybe >= requiredPeople
          ? 'possible'
          : yes + maybe + unknown >= requiredPeople
            ? 'waiting'
            : 'conflict';
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => compareScore(a, b, requiredPeople));
  return candidates.slice(0, limit);
}

export function validateAvailabilityUpdates(round, updates = {}) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('Availability updates are invalid.');
  const validSlots = new Set(buildSchedule(round).flatMap((day) => day.slots));
  const entries = Object.entries(updates);
  if (entries.length > 600) throw new Error('Too many availability changes at once.');
  const cleaned = {};
  for (const [slotKey, value] of entries) {
    if (!validSlots.has(slotKey)) throw new Error('One or more availability slots are outside this booking window.');
    if (value === null || value === '') cleaned[slotKey] = null;
    else if (STATUS_VALUES.has(value)) cleaned[slotKey] = value;
    else throw new Error('Availability must be available, maybe, unavailable, or blank.');
  }
  return cleaned;
}

export function validateCandidateSelection(state, startKey, participantIds) {
  const round = state.round;
  const schedule = buildSchedule(round);
  const validStarts = new Set(schedule.flatMap((day) => day.starts));
  if (!validStarts.has(startKey)) throw new Error('That start time is outside this booking window.');
  if (!Array.isArray(participantIds)) throw new Error('Choose the players for this booking.');
  const unique = [...new Set(participantIds.map(String))];
  if (unique.length !== state.requiredPeople) throw new Error(`Choose exactly ${state.requiredPeople} participant${state.requiredPeople === 1 ? '' : 's'}.`);
  const participantSet = new Set(state.participants.map((participant) => participant.id));
  for (const id of unique) {
    if (!participantSet.has(id)) throw new Error('One of the selected participants is no longer in this group.');
    const status = participantCandidateStatus(state.availability[id] || {}, startKey, round.durationMinutes);
    if (status !== 'yes' && status !== 'maybe') {
      throw new Error('Every selected participant must have answered Available or Maybe for the entire booking time.');
    }
  }
  return unique;
}

export function confirmedNeedsAttention(state) {
  if (!state.round?.confirmed) return false;
  const { startKey, participantIds } = state.round.confirmed;
  const participantSet = new Set(state.participants.map((participant) => participant.id));
  return participantIds.some((id) => {
    if (!participantSet.has(id)) return true;
    const status = participantCandidateStatus(state.availability[id] || {}, startKey, state.round.durationMinutes);
    return status === 'no' || status === 'unknown';
  });
}
