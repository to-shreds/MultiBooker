import { DurableObject } from 'cloudflare:workers';

import {
  CODE_RE,
  buildSchedule,
  cleanName,
  computeCandidates,
  confirmedNeedsAttention,
  normalizeCode,
  validateAvailabilityUpdates,
  validateCandidateSelection,
  validateRoundSettings,
} from './core.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

function errorResponse(message, status = 400) {
  return json({ error: message }, status);
}

async function readJson(request, maxBytes = 64 * 1024) {
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('Request is too large.');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function randomHex(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

function validatePin(pin) {
  const value = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(value)) throw new Error('Organizer PIN must be 4 to 8 digits.');
  return value;
}

function validateRequiredPeople(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 30) throw new Error('Number of people needed must be between 1 and 30.');
  return count;
}

function validateTimezone(value) {
  const timezone = String(value || 'America/New_York').trim().slice(0, 64);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return 'America/New_York';
  }
}

function makeRound(settings, id = crypto.randomUUID()) {
  return {
    id,
    ...validateRoundSettings(settings),
    createdAt: new Date().toISOString(),
    confirmed: null,
  };
}

function participantNameMap(state) {
  return new Map(state.participants.map((participant) => [participant.id, participant.name]));
}

function publicState(state) {
  const schedule = buildSchedule(state.round);
  const candidates = computeCandidates(
    state.participants,
    state.availability,
    state.round,
    state.requiredPeople,
  );
  const totalSlots = schedule.reduce((sum, day) => sum + day.slots.length, 0);
  const participants = state.participants.map((participant) => {
    const answered = Object.values(state.availability[participant.id] || {}).filter(Boolean).length;
    return {
      id: participant.id,
      name: participant.name,
      createdAt: participant.createdAt,
      updatedAt: participant.updatedAt,
      answered,
      totalSlots,
    };
  });
  const names = participantNameMap(state);
  const confirmed = state.round.confirmed
    ? {
        ...state.round.confirmed,
        participantNames: state.round.confirmed.participantIds.map((id) => names.get(id) || 'Removed participant'),
        needsAttention: confirmedNeedsAttention(state),
      }
    : null;

  return {
    schemaVersion: 1,
    code: state.code,
    name: state.name,
    timezone: state.timezone,
    requiredPeople: state.requiredPeople,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    participants,
    availability: state.availability,
    round: { ...state.round, confirmed },
    schedule,
    candidates,
    history: state.history || [],
  };
}

async function verifyOrganizer(state, pin) {
  const candidate = String(pin || '').trim();
  if (!candidate) return false;
  const hash = await hashPin(candidate, state.pinSalt);
  return safeEqual(hash, state.pinHash);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const configured = String(env.ALLOWED_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (configured.includes('*')) return '*';
  return configured.includes(origin) ? origin : false;
}

function addCors(response, origin) {
  const headers = new Headers(response.headers);
  if (origin) headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  headers.set('access-control-allow-headers', 'content-type');
  headers.set('access-control-max-age', '86400');
  headers.set('vary', 'Origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function forwardToGroup(env, code, path, method, body) {
  const id = env.BOOKING_GROUPS.idFromName(code);
  const stub = env.BOOKING_GROUPS.get(id);
  const init = { method, headers: JSON_HEADERS };
  if (body !== undefined) init.body = JSON.stringify(body);
  return stub.fetch(`https://multibooker.internal${path}`, init);
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (origin === false) return errorResponse('Origin is not allowed.', 403);
    if (request.method === 'OPTIONS') return addCors(new Response(null, { status: 204 }), origin);

    const url = new URL(request.url);
    let response;
    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        response = json({ ok: true, service: 'multibooker-api', version: '0.1.0' });
      } else if (url.pathname === '/api/groups' && request.method === 'POST') {
        const body = await readJson(request);
        const code = normalizeCode(body.code);
        if (!CODE_RE.test(code)) throw new Error('Group code must be 4 to 20 letters, numbers, or hyphens.');
        response = await forwardToGroup(env, code, '/create', 'POST', body);
      } else {
        const match = /^\/api\/groups\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
        if (!match) {
          response = errorResponse('Not found.', 404);
        } else {
          const code = normalizeCode(decodeURIComponent(match[1]));
          if (!CODE_RE.test(code)) throw new Error('Invalid group code.');
          const tail = match[2] || '';
          let path = '/state';
          let body;
          let method = request.method;

          if (request.method === 'GET' && !tail) {
            path = '/state';
          } else if (request.method === 'POST' && tail === 'participants') {
            path = '/participants';
            body = await readJson(request);
          } else if (request.method === 'PUT' && tail === 'availability') {
            path = '/availability';
            body = await readJson(request, 256 * 1024);
          } else if (request.method === 'POST' && tail === 'confirm') {
            path = '/confirm';
            body = await readJson(request);
          } else if (request.method === 'POST' && tail === 'unconfirm') {
            path = '/unconfirm';
            body = await readJson(request);
          } else if (request.method === 'POST' && tail === 'rounds') {
            path = '/rounds';
            body = await readJson(request);
          } else if (request.method === 'DELETE' && /^participants\/[^/]+$/.test(tail)) {
            path = `/${tail}`;
            body = await readJson(request);
          } else {
            response = errorResponse('Not found.', 404);
          }

          if (!response) response = await forwardToGroup(env, code, path, method, body);
        }
      }
    } catch (error) {
      response = errorResponse(error?.message || 'Request failed.', 400);
    }
    return addCors(response, origin);
  },
};

export class BookingGroup extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async load() {
    return this.ctx.storage.get('state');
  }

  async save(state) {
    state.updatedAt = new Date().toISOString();
    await this.ctx.storage.put('state', state);
  }

  async requireState() {
    const state = await this.load();
    if (!state) throw Object.assign(new Error('Group not found.'), { status: 404 });
    return state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/create') return this.create(request);
      if (request.method === 'GET' && url.pathname === '/state') return this.getState();
      if (request.method === 'POST' && url.pathname === '/participants') return this.join(request);
      if (request.method === 'PUT' && url.pathname === '/availability') return this.updateAvailability(request);
      if (request.method === 'POST' && url.pathname === '/confirm') return this.confirm(request);
      if (request.method === 'POST' && url.pathname === '/unconfirm') return this.unconfirm(request);
      if (request.method === 'POST' && url.pathname === '/rounds') return this.newRound(request);
      const participantMatch = /^\/participants\/([^/]+)$/.exec(url.pathname);
      if (request.method === 'DELETE' && participantMatch) return this.removeParticipant(request, decodeURIComponent(participantMatch[1]));
      return errorResponse('Not found.', 404);
    } catch (error) {
      return errorResponse(error?.message || 'Request failed.', error?.status || 400);
    }
  }

  async create(request) {
    const body = await readJson(request);
    const code = normalizeCode(body.code);
    if (!CODE_RE.test(code)) throw new Error('Group code must be 4 to 20 letters, numbers, or hyphens.');
    const name = cleanName(body.name);
    if (!name) throw new Error('Give the group a name.');
    const organizerName = cleanName(body.organizerName);
    if (!organizerName) throw new Error('Enter your name.');
    const requiredPeople = validateRequiredPeople(body.requiredPeople);
    const pin = validatePin(body.pin);
    const timezone = validateTimezone(body.timezone);
    const round = makeRound(body.round || {});
    const pinSalt = randomHex(16);
    const pinHash = await hashPin(pin, pinSalt);
    const existing = await this.load();
    if (existing) return errorResponse('That group code is already in use.', 409);
    const now = new Date().toISOString();
    const participant = {
      id: crypto.randomUUID(),
      name: organizerName,
      createdAt: now,
      updatedAt: now,
    };
    const state = {
      schemaVersion: 1,
      code,
      name,
      timezone,
      requiredPeople,
      pinSalt,
      pinHash,
      participants: [participant],
      availability: { [participant.id]: {} },
      round,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.ctx.storage.put('state', state);
    return json({ ...publicState(state), participantId: participant.id }, 201);
  }

  async getState() {
    const state = await this.requireState();
    return json(publicState(state));
  }

  async join(request) {
    const body = await readJson(request);
    const name = cleanName(body.name);
    if (!name) throw new Error('Enter your name.');
    const state = await this.requireState();
    let participant = state.participants.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const now = new Date().toISOString();
    if (!participant) {
      if (state.participants.length >= 30) throw new Error('This group already has the maximum number of participants.');
      participant = { id: crypto.randomUUID(), name, createdAt: now, updatedAt: now };
      state.participants.push(participant);
      state.availability[participant.id] = {};
      await this.save(state);
    }
    return json({ ...publicState(state), participantId: participant.id });
  }

  async updateAvailability(request) {
    const body = await readJson(request, 256 * 1024);
    const state = await this.requireState();
    if (String(body.roundId || '') !== state.round.id) return errorResponse('This booking window changed. Refresh and try again.', 409);
    const participantId = String(body.participantId || '');
    const participant = state.participants.find((item) => item.id === participantId);
    if (!participant) return errorResponse('Participant not found.', 404);
    const updates = validateAvailabilityUpdates(state.round, body.updates || {});
    const next = { ...(state.availability[participantId] || {}) };
    for (const [slotKey, value] of Object.entries(updates)) {
      if (value == null) delete next[slotKey];
      else next[slotKey] = value;
    }
    state.availability[participantId] = next;
    participant.updatedAt = new Date().toISOString();
    await this.save(state);
    return json(publicState(state));
  }

  async confirm(request) {
    const body = await readJson(request);
    const pinState = await this.requireState();
    if (!(await verifyOrganizer(pinState, body.pin))) return errorResponse('Organizer PIN is incorrect.', 401);
    const state = await this.requireState();
    if (String(body.roundId || '') !== state.round.id) return errorResponse('This booking window changed. Refresh and try again.', 409);
    const startKey = String(body.startKey || '');
    const participantIds = validateCandidateSelection(state, startKey, body.participantIds);
    const [date, startTime] = startKey.split('T');
    const [hours, minutes] = startTime.split(':').map(Number);
    const total = hours * 60 + minutes + state.round.durationMinutes;
    state.round.confirmed = {
      startKey,
      endKey: `${date}T${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`,
      participantIds,
      confirmedAt: new Date().toISOString(),
    };
    await this.save(state);
    return json(publicState(state));
  }

  async unconfirm(request) {
    const body = await readJson(request);
    const pinState = await this.requireState();
    if (!(await verifyOrganizer(pinState, body.pin))) return errorResponse('Organizer PIN is incorrect.', 401);
    const state = await this.requireState();
    state.round.confirmed = null;
    await this.save(state);
    return json(publicState(state));
  }

  async newRound(request) {
    const body = await readJson(request);
    const pinState = await this.requireState();
    if (!(await verifyOrganizer(pinState, body.pin))) return errorResponse('Organizer PIN is incorrect.', 401);
    const nextRound = makeRound(body.round || {});
    const state = await this.requireState();
    const names = participantNameMap(state);
    const archived = {
      id: state.round.id,
      startDate: state.round.startDate,
      endDate: state.round.endDate,
      durationMinutes: state.round.durationMinutes,
      confirmed: state.round.confirmed
        ? {
            ...state.round.confirmed,
            participantNames: state.round.confirmed.participantIds.map((id) => names.get(id) || 'Removed participant'),
          }
        : null,
      archivedAt: new Date().toISOString(),
    };
    state.history = [archived, ...(state.history || [])].slice(0, 20);
    state.round = nextRound;
    state.availability = Object.fromEntries(state.participants.map((participant) => [participant.id, {}]));
    await this.save(state);
    return json(publicState(state));
  }

  async removeParticipant(request, participantId) {
    const body = await readJson(request);
    const pinState = await this.requireState();
    if (!(await verifyOrganizer(pinState, body.pin))) return errorResponse('Organizer PIN is incorrect.', 401);
    const state = await this.requireState();
    const index = state.participants.findIndex((participant) => participant.id === participantId);
    if (index < 0) return errorResponse('Participant not found.', 404);
    if (state.participants.length <= 1) return errorResponse('A group must have at least one participant.', 409);
    state.participants.splice(index, 1);
    delete state.availability[participantId];
    await this.save(state);
    return json(publicState(state));
  }

}
