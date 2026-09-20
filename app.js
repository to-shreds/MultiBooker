(() => {
  'use strict';

  const PROD_API = 'https://multibooker-api.jonathanjablon.workers.dev';
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
  const API_BASE = LOCAL_HOSTS.has(location.hostname) ? 'http://127.0.0.1:8787' : PROD_API;
  const STATUS_ORDER = [null, 'yes', 'maybe', 'no'];
  const STATUS_LABELS = {
    yes: 'Available',
    maybe: 'Maybe',
    no: 'Unavailable',
    unknown: 'Not answered',
  };

  const app = document.querySelector('#app');
  const refreshButton = document.querySelector('#refreshButton');
  const brandButton = document.querySelector('#brandButton');
  const toastEl = document.querySelector('#toast');
  const modal = document.querySelector('#modal');
  const modalContent = document.querySelector('#modalContent');

  let state = null;
  let activeDate = null;
  let currentCode = null;
  let toastTimer = null;
  let availabilityTimer = null;
  let pendingUpdates = {};
  let availabilitySaving = false;

  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function toast(message, kind = '') {
    clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.className = `toast show ${kind}`.trim();
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3000);
  }

  function showLoading(message = 'Loading…') {
    app.innerHTML = `<div class="card"><span class="spinner"></span> ${esc(message)}</div>`;
  }

  function showError(message, retry = null) {
    app.innerHTML = `
      <div class="card error-card">
        <h2>Something went wrong</h2>
        <p>${esc(message)}</p>
        ${retry ? '<button class="primary" id="retryButton" type="button">Try again</button>' : '<button class="primary" id="goHomeButton" type="button">Back home</button>'}
      </div>`;
    document.querySelector('#retryButton')?.addEventListener('click', retry);
    document.querySelector('#goHomeButton')?.addEventListener('click', goHome);
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {}),
      },
    });
    let data = {};
    try { data = await response.json(); } catch { /* ignore */ }
    if (!response.ok) {
      const error = new Error(data.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function identityKey(code) { return `multibooker.identity.${code}`; }
  function pinKey(code) { return `multibooker.organizerPin.${code}`; }

  function getIdentity(code) {
    try { return JSON.parse(localStorage.getItem(identityKey(code)) || 'null'); } catch { return null; }
  }

  function saveIdentity(code, participantId, name) {
    localStorage.setItem(identityKey(code), JSON.stringify({ participantId, name }));
  }

  function getOrganizerPin(code) { return localStorage.getItem(pinKey(code)) || ''; }
  function saveOrganizerPin(code, pin) { localStorage.setItem(pinKey(code), pin); }

  function setGroupUrl(code) {
    const url = new URL(location.href);
    url.search = '';
    if (code) url.searchParams.set('group', code);
    history.pushState({}, '', url);
  }

  function goHome() {
    state = null;
    currentCode = null;
    pendingUpdates = {};
    clearTimeout(availabilityTimer);
    setGroupUrl(null);
    renderHome();
  }

  function generateCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    return [...bytes].map((n) => alphabet[n % alphabet.length]).join('');
  }

  function generatePin() {
    const data = new Uint32Array(1);
    crypto.getRandomValues(data);
    return String(100000 + (data[0] % 900000));
  }

  function localDate(offsetDays = 0) {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function selectedDays(form) {
    return [...form.querySelectorAll('[name="allowedDay"]:checked')].map((input) => Number(input.value));
  }

  function dayCheckboxes(selected = [0, 1, 2, 3, 4, 5, 6]) {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return labels.map((label, index) => `
      <label class="day-checkbox">
        <input type="checkbox" name="allowedDay" value="${index}" ${selected.includes(index) ? 'checked' : ''}>
        <span>${label}</span>
      </label>`).join('');
  }

  function renderHome() {
    refreshButton.classList.add('hidden');
    app.innerHTML = `
      <div class="home-shell">
        <section class="hero">
          <div class="eyebrow">Group scheduling without the group text</div>
          <h1>Find the time that actually works.</h1>
          <p class="lead">Create a booking group, share one code, and let everyone mark each time as available, maybe, or unavailable. MultiBooker sorts the overlap for you.</p>
        </section>
        <section class="home-actions">
          <div class="card home-choice">
            <div>
              <h2>Create a group</h2>
              <p>Choose the date window, time limits, activity length, and how many people you need.</p>
            </div>
            <button class="primary" id="createButton" type="button">Create a group</button>
          </div>
          <div class="card home-choice">
            <div>
              <h2>Join a group</h2>
              <p>Got a code? Enter it with your name and fill out your availability.</p>
            </div>
            <button class="secondary" id="joinButton" type="button">Join with a code</button>
          </div>
        </section>
      </div>`;
    document.querySelector('#createButton').addEventListener('click', renderCreateForm);
    document.querySelector('#joinButton').addEventListener('click', renderJoinForm);
  }

  function renderCreateForm() {
    const code = generateCode();
    const pin = generatePin();
    app.innerHTML = `
      <div class="home-shell">
        <button class="link-button" id="backHome" type="button">← Back</button>
        <div class="card" style="margin-top:14px">
          <h1 style="font-size:32px">Create a group</h1>
          <p class="muted">These settings define the current booking window. You can reuse the same group for the next match later.</p>
          <form id="createForm">
            <div class="form-grid">
              <div class="field full">
                <label for="groupName">Group name</label>
                <input id="groupName" name="groupName" maxlength="40" placeholder="Saturday Padel" required>
              </div>
              <div class="field">
                <label for="organizerName">Your name</label>
                <input id="organizerName" name="organizerName" maxlength="40" autocomplete="name" required>
              </div>
              <div class="field">
                <label for="requiredPeople">People needed</label>
                <input id="requiredPeople" name="requiredPeople" type="number" min="1" max="30" value="4" required>
                <span class="help">You can invite more people than this.</span>
              </div>
              <div class="field">
                <label for="groupCode">Group code</label>
                <div class="inline-input">
                  <input id="groupCode" name="groupCode" value="${code}" maxlength="20" autocapitalize="characters" required>
                  <button class="ghost" id="newCodeButton" type="button">New</button>
                </div>
              </div>
              <div class="field">
                <label for="pin">Organizer PIN</label>
                <div class="inline-input">
                  <input id="pin" name="pin" type="text" inputmode="numeric" pattern="[0-9]{4,8}" value="${pin}" required>
                  <button class="ghost" id="newPinButton" type="button">New</button>
                </div>
                <span class="help">Needed to confirm a time or start the next booking.</span>
              </div>
            </div>

            <div class="section-divider"></div>
            <h2>Booking window</h2>
            <div class="form-grid">
              <div class="field">
                <label for="startDate">Start date</label>
                <input id="startDate" name="startDate" type="date" value="${localDate(0)}" required>
              </div>
              <div class="field">
                <label for="endDate">End date</label>
                <input id="endDate" name="endDate" type="date" value="${localDate(14)}" required>
              </div>
              <div class="field">
                <label for="duration">Activity length</label>
                <select id="duration" name="duration">
                  ${[30,60,90,120,150,180,240,300,360].map((m) => `<option value="${m}" ${m === 90 ? 'selected' : ''}>${durationLabel(m)}</option>`).join('')}
                </select>
              </div>
              <div class="field full">
                <span class="field-label">Days that can work</span>
                <div class="day-checkboxes">${dayCheckboxes()}</div>
              </div>
              <div class="field">
                <label for="weekdayStart">Weekday earliest</label>
                <input id="weekdayStart" name="weekdayStart" type="time" step="1800" value="18:00" required>
              </div>
              <div class="field">
                <label for="weekdayEnd">Weekday latest</label>
                <input id="weekdayEnd" name="weekdayEnd" type="time" step="1800" value="22:00" required>
              </div>
              <div class="field">
                <label for="weekendStart">Weekend earliest</label>
                <input id="weekendStart" name="weekendStart" type="time" step="1800" value="08:00" required>
              </div>
              <div class="field">
                <label for="weekendEnd">Weekend latest</label>
                <input id="weekendEnd" name="weekendEnd" type="time" step="1800" value="20:00" required>
              </div>
            </div>
            <div class="form-actions">
              <button class="ghost" id="cancelCreate" type="button">Cancel</button>
              <button class="primary" id="submitCreate" type="submit">Create group</button>
            </div>
          </form>
        </div>
      </div>`;

    document.querySelector('#backHome').addEventListener('click', renderHome);
    document.querySelector('#cancelCreate').addEventListener('click', renderHome);
    document.querySelector('#newCodeButton').addEventListener('click', () => { document.querySelector('#groupCode').value = generateCode(); });
    document.querySelector('#newPinButton').addEventListener('click', () => { document.querySelector('#pin').value = generatePin(); });
    document.querySelector('#groupCode').addEventListener('input', (event) => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
    });
    document.querySelector('#createForm').addEventListener('submit', createGroup);
  }

  async function createGroup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = document.querySelector('#submitCreate');
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner"></span> Creating';
    const data = new FormData(form);
    const pin = String(data.get('pin') || '');
    const body = {
      code: String(data.get('groupCode') || ''),
      name: String(data.get('groupName') || ''),
      organizerName: String(data.get('organizerName') || ''),
      requiredPeople: Number(data.get('requiredPeople')),
      pin,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      round: {
        startDate: String(data.get('startDate') || ''),
        endDate: String(data.get('endDate') || ''),
        durationMinutes: Number(data.get('duration')),
        weekdayStart: String(data.get('weekdayStart') || ''),
        weekdayEnd: String(data.get('weekdayEnd') || ''),
        weekendStart: String(data.get('weekendStart') || ''),
        weekendEnd: String(data.get('weekendEnd') || ''),
        allowedDays: selectedDays(form),
      },
    };
    try {
      const created = await api('/api/groups', { method: 'POST', body: JSON.stringify(body) });
      currentCode = created.code;
      saveOrganizerPin(created.code, pin);
      saveIdentity(created.code, created.participantId, body.organizerName.trim());
      state = created;
      activeDate = state.schedule[0]?.date || null;
      setGroupUrl(created.code);
      renderGroup();
      toast(`Group ${created.code} created.`);
    } catch (error) {
      toast(error.message, 'error');
      submit.disabled = false;
      submit.textContent = 'Create group';
    }
  }

  function renderJoinForm(prefillCode = '') {
    app.innerHTML = `
      <div class="home-shell">
        <button class="link-button" id="backHome" type="button">← Back</button>
        <div class="card" style="margin-top:14px">
          <h1 style="font-size:32px">Join a group</h1>
          <p class="muted">Enter the shared group code and your name.</p>
          <form id="joinForm">
            <div class="form-grid">
              <div class="field full">
                <label for="joinCode">Group code</label>
                <input id="joinCode" name="code" value="${esc(prefillCode)}" maxlength="20" autocapitalize="characters" required>
              </div>
              <div class="field full">
                <label for="joinName">Your name</label>
                <input id="joinName" name="name" maxlength="40" autocomplete="name" required>
              </div>
            </div>
            <div class="form-actions">
              <button class="primary" id="submitJoin" type="submit">Join group</button>
            </div>
          </form>
        </div>
      </div>`;
    document.querySelector('#backHome').addEventListener('click', renderHome);
    document.querySelector('#joinCode').addEventListener('input', (event) => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
    });
    document.querySelector('#joinForm').addEventListener('submit', joinGroup);
  }

  async function joinGroup(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = String(data.get('code') || '').trim().toUpperCase();
    const name = String(data.get('name') || '').trim();
    const button = document.querySelector('#submitJoin');
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Joining';
    try {
      const joined = await api(`/api/groups/${encodeURIComponent(code)}/participants`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      currentCode = joined.code;
      saveIdentity(joined.code, joined.participantId, name);
      state = joined;
      activeDate = state.schedule[0]?.date || null;
      setGroupUrl(joined.code);
      renderGroup();
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
      button.textContent = 'Join group';
    }
  }

  async function loadGroup(code, { showSpinner = true } = {}) {
    currentCode = String(code || '').trim().toUpperCase();
    if (showSpinner) showLoading('Loading group…');
    refreshButton.classList.remove('hidden');
    try {
      state = await api(`/api/groups/${encodeURIComponent(currentCode)}`);
      if (!activeDate || !state.schedule.some((day) => day.date === activeDate)) activeDate = state.schedule[0]?.date || null;
      const identity = getIdentity(currentCode);
      const participantStillExists = identity && state.participants.some((p) => p.id === identity.participantId);
      if (!participantStillExists) return renderJoinGroupIdentity();
      renderGroup();
    } catch (error) {
      if (error.status === 404) showError('That group does not exist. Check the code and try again.');
      else showError(error.message, () => loadGroup(currentCode));
    }
  }

  function renderJoinGroupIdentity() {
    app.innerHTML = `
      <div class="home-shell">
        <button class="link-button" id="backHome" type="button">← Home</button>
        <div class="card" style="margin-top:14px">
          <div class="eyebrow">Group ${esc(currentCode)}</div>
          <h1 style="font-size:32px">${esc(state?.name || 'Join group')}</h1>
          <p class="muted">Enter your name to add or reopen your availability.</p>
          <form id="identityForm">
            <div class="field">
              <label for="identityName">Your name</label>
              <input id="identityName" name="name" maxlength="40" autocomplete="name" required autofocus>
            </div>
            <div class="form-actions"><button class="primary" id="identitySubmit" type="submit">Continue</button></div>
          </form>
        </div>
      </div>`;
    document.querySelector('#backHome').addEventListener('click', goHome);
    document.querySelector('#identityForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = document.querySelector('#identitySubmit');
      button.disabled = true;
      const name = new FormData(event.currentTarget).get('name');
      try {
        const joined = await api(`/api/groups/${encodeURIComponent(currentCode)}/participants`, {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        saveIdentity(currentCode, joined.participantId, String(name).trim());
        state = joined;
        renderGroup();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  }

  function formatDate(dateString, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
    return new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(`${dateString}T12:00:00Z`));
  }

  function formatTime(time) {
    const [hour, minute] = String(time).split(':').map(Number);
    const date = new Date(Date.UTC(2020, 0, 1, hour, minute));
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date);
  }

  function formatSlot(slotKey) {
    const [date, time] = slotKey.split('T');
    return `${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' })} at ${formatTime(time)}`;
  }

  function durationLabel(minutes) {
    if (minutes < 60) return `${minutes} min`;
    if (minutes % 60 === 0) return `${minutes / 60} hr${minutes === 60 ? '' : 's'}`;
    return `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  }

  function namesFor(ids) {
    const map = new Map(state.participants.map((p) => [p.id, p.name]));
    return ids.map((id) => map.get(id)).filter(Boolean);
  }

  function candidateSummary(candidate) {
    const yes = namesFor(candidate.yesIds);
    const maybe = namesFor(candidate.maybeIds);
    const unknown = namesFor(candidate.unknownIds);
    const bits = [];
    if (yes.length) bits.push(`${yes.length} available: ${yes.join(', ')}`);
    if (maybe.length) bits.push(`${maybe.length} maybe: ${maybe.join(', ')}`);
    if (unknown.length) bits.push(`${unknown.length} unanswered`);
    return bits.join(' · ');
  }

  function candidateBadge(candidate) {
    if (candidate.classification === 'ready') {
      return state.participants.length === state.requiredPeople ? 'Everyone available' : 'Enough people available';
    }
    if (candidate.classification === 'possible') return 'Works if maybes confirm';
    if (candidate.classification === 'waiting') return 'Waiting on responses';
    return 'Conflict';
  }

  function bestCandidates() {
    const meaningful = state.candidates.filter((candidate) => candidate.classification !== 'conflict');
    return (meaningful.length ? meaningful : state.candidates).slice(0, 8);
  }

  function renderConfirmed() {
    const confirmed = state.round.confirmed;
    if (!confirmed) return '';
    return `
      <section class="confirmed-banner ${confirmed.needsAttention ? 'attention' : ''}">
        <div class="eyebrow" style="color:rgba(255,255,255,.76)">${confirmed.needsAttention ? 'Confirmed time needs attention' : 'Booked'}</div>
        <h2>${esc(formatSlot(confirmed.startKey))}</h2>
        <p>${esc(durationLabel(state.round.durationMinutes))} · ends ${esc(formatTime(confirmed.endKey.split('T')[1]))}</p>
        <div class="confirmed-roster">${esc(confirmed.participantNames.join(', '))}</div>
        ${confirmed.needsAttention ? '<p style="margin-top:10px;margin-bottom:0">Someone on the confirmed roster is now unavailable or has cleared part of this time.</p>' : ''}
      </section>`;
  }

  function renderCandidates() {
    const candidates = bestCandidates();
    if (!candidates.length) {
      return '<div class="card empty-state">No candidate start times exist inside this booking window.</div>';
    }
    const organizer = Boolean(getOrganizerPin(currentCode));
    return `<div class="candidate-list">${candidates.map((candidate) => `
      <article class="candidate ${candidate.classification}">
        <div>
          <div class="candidate-time">${esc(formatSlot(candidate.startKey))}</div>
          <div class="candidate-summary">${esc(candidateSummary(candidate) || 'Nobody has answered this time yet.')}</div>
          <span class="candidate-badge">${esc(candidateBadge(candidate))}</span>
        </div>
        ${candidate.classification === 'ready' || candidate.classification === 'possible'
          ? `<button class="${candidate.classification === 'ready' ? 'primary' : 'secondary'} confirm-candidate" data-start="${esc(candidate.startKey)}" type="button">${organizer ? 'Confirm this time' : 'Organizer can confirm'}</button>`
          : ''}
      </article>`).join('')}</div>`;
  }

  function renderParticipants() {
    return state.participants.map((participant) => {
      const complete = participant.totalSlots > 0 && participant.answered === participant.totalSlots;
      return `<span class="person-chip"><strong>${esc(participant.name)}</strong><span class="${complete ? 'progress-complete' : ''}">${participant.answered}/${participant.totalSlots}</span></span>`;
    }).join('');
  }

  function slotStatus(participantId, slotKey) {
    return state.availability?.[participantId]?.[slotKey] || null;
  }

  function slotButton(day, slotKey, participantId) {
    const status = slotStatus(participantId, slotKey);
    const time = slotKey.split('T')[1];
    const css = status || 'unknown';
    const label = status ? STATUS_LABELS[status] : STATUS_LABELS.unknown;
    const icon = status === 'yes' ? '✓' : status === 'maybe' ? '?' : status === 'no' ? '×' : '○';
    return `<button class="slot-button ${css}" data-slot="${slotKey}" type="button"><span>${esc(formatTime(time))}</span><span class="slot-state">${icon} ${esc(label)}</span></button>`;
  }

  function renderAvailability() {
    const identity = getIdentity(currentCode);
    const day = state.schedule.find((item) => item.date === activeDate) || state.schedule[0];
    if (!identity || !day) return '<div class="card empty-state">There are no editable time slots.</div>';
    activeDate = day.date;
    return `
      <div class="card availability-card">
        <div class="availability-toolbar">
          <strong>Your availability</strong>
          <div class="muted small">Tap a time to cycle through the four states. Your changes save automatically.</div>
          <div class="legend">
            <span class="legend-item"><span class="legend-dot yes"></span> Available</span>
            <span class="legend-item"><span class="legend-dot maybe"></span> Maybe</span>
            <span class="legend-item"><span class="legend-dot no"></span> Unavailable</span>
            <span class="legend-item"><span class="legend-dot unknown"></span> Not answered</span>
          </div>
        </div>
        <div class="date-strip">
          ${state.schedule.map((item) => `<button type="button" class="date-tab ${item.date === activeDate ? 'active' : ''}" data-date="${item.date}"><strong>${esc(formatDate(item.date, { weekday: 'short' }))}</strong>${esc(formatDate(item.date, { month: 'short', day: 'numeric' }))}</button>`).join('')}
        </div>
        <div class="day-editor">
          <div class="day-editor-head">
            <div>
              <h3>${esc(formatDate(day.date, { weekday: 'long', month: 'long', day: 'numeric' }))}</h3>
              <div class="muted small">${day.weekend ? 'Weekend' : 'Weekday'} booking window</div>
            </div>
            <div class="bulk-actions">
              <button type="button" data-bulk="yes">All available</button>
              <button type="button" data-bulk="maybe">All maybe</button>
              <button type="button" data-bulk="no">All unavailable</button>
              <button type="button" data-bulk="clear">Clear</button>
            </div>
          </div>
          <div class="slot-list">
            ${day.slots.map((slotKey) => slotButton(day, slotKey, identity.participantId)).join('')}
          </div>
        </div>
      </div>`;
  }

  function renderGroup() {
    if (!state) return;
    refreshButton.classList.remove('hidden');
    const identity = getIdentity(currentCode);
    const me = state.participants.find((participant) => participant.id === identity?.participantId);
    if (!me) return renderJoinGroupIdentity();
    const period = `${formatDate(state.round.startDate, { month: 'short', day: 'numeric' })} to ${formatDate(state.round.endDate, { month: 'short', day: 'numeric' })}`;
    app.innerHTML = `
      <section class="group-head">
        <div class="group-title">
          <div class="eyebrow">${esc(period)}</div>
          <h1>${esc(state.name)}</h1>
          <div class="group-meta">
            <span class="code-chip">Code ${esc(state.code)}</span>
            <span>${state.requiredPeople} needed</span>
            <span>·</span>
            <span>${esc(durationLabel(state.round.durationMinutes))}</span>
          </div>
        </div>
        <div class="share-row">
          <button class="ghost" id="copyCodeButton" type="button">Copy code</button>
          <button class="secondary" id="shareButton" type="button">Share group</button>
        </div>
      </section>

      ${renderConfirmed()}

      <section class="section">
        <div class="section-head">
          <div>
            <h2>Best times</h2>
            <p class="muted small">Automatically ranked from everyone's current answers.</p>
          </div>
        </div>
        ${renderCandidates()}
      </section>

      <section class="section">
        <div class="section-head">
          <div>
            <h2>People</h2>
            <p class="muted small">${state.participants.length} participant${state.participants.length === 1 ? '' : 's'} · ${state.requiredPeople} needed to book</p>
          </div>
        </div>
        <div class="participants">${renderParticipants()}</div>
      </section>

      <section class="section">
        <div class="section-head"><div><h2>Fill out your times</h2><p class="muted small">You are editing as ${esc(me.name)}.</p></div></div>
        ${renderAvailability()}
      </section>

      <div class="organizer-row"><button class="ghost" id="organizerButton" type="button">Organizer controls</button></div>`;

    bindGroupEvents();
  }

  function bindGroupEvents() {
    document.querySelector('#copyCodeButton')?.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(state.code);
      toast('Group code copied.');
    });
    document.querySelector('#shareButton')?.addEventListener('click', shareGroup);
    document.querySelectorAll('.date-tab').forEach((button) => button.addEventListener('click', () => {
      activeDate = button.dataset.date;
      renderGroupPreservingScroll();
    }));
    document.querySelectorAll('.slot-button').forEach((button) => button.addEventListener('click', () => cycleSlot(button)));
    document.querySelectorAll('[data-bulk]').forEach((button) => button.addEventListener('click', () => bulkAvailability(button.dataset.bulk)));
    document.querySelectorAll('.confirm-candidate').forEach((button) => button.addEventListener('click', () => openConfirm(button.dataset.start)));
    document.querySelector('#organizerButton')?.addEventListener('click', openOrganizer);
  }

  async function shareGroup() {
    const shareUrl = new URL(location.href);
    shareUrl.search = '';
    shareUrl.searchParams.set('group', state.code);
    const payload = {
      title: `MultiBooker: ${state.name}`,
      text: `Join ${state.name} with group code ${state.code}`,
      url: shareUrl.toString(),
    };
    if (navigator.share) {
      try { await navigator.share(payload); return; } catch (error) { if (error.name === 'AbortError') return; }
    }
    await navigator.clipboard?.writeText(`${payload.text}\n${payload.url}`);
    toast('Group link copied.');
  }

  function renderGroupPreservingScroll() {
    const y = window.scrollY;
    renderGroup();
    requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
  }

  function cycleSlot(button) {
    const slotKey = button.dataset.slot;
    const identity = getIdentity(currentCode);
    if (!identity) return;
    const current = slotStatus(identity.participantId, slotKey);
    const index = STATUS_ORDER.indexOf(current);
    const next = STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
    if (!state.availability[identity.participantId]) state.availability[identity.participantId] = {};
    if (next) state.availability[identity.participantId][slotKey] = next;
    else delete state.availability[identity.participantId][slotKey];
    updateSlotButtonVisual(button, next);
    queueAvailability({ [slotKey]: next });
  }

  function updateSlotButtonVisual(button, status) {
    button.classList.remove('yes', 'maybe', 'no', 'unknown');
    const css = status || 'unknown';
    button.classList.add(css);
    const label = status ? STATUS_LABELS[status] : STATUS_LABELS.unknown;
    const icon = status === 'yes' ? '✓' : status === 'maybe' ? '?' : status === 'no' ? '×' : '○';
    const stateSpan = button.querySelector('.slot-state');
    if (stateSpan) stateSpan.textContent = `${icon} ${label}`;
  }

  function bulkAvailability(value) {
    const day = state.schedule.find((item) => item.date === activeDate);
    const identity = getIdentity(currentCode);
    if (!day || !identity) return;
    const status = value === 'clear' ? null : value;
    const updates = {};
    for (const slotKey of day.slots) {
      updates[slotKey] = status;
      if (status) state.availability[identity.participantId][slotKey] = status;
      else delete state.availability[identity.participantId][slotKey];
    }
    document.querySelectorAll('.slot-button').forEach((button) => updateSlotButtonVisual(button, status));
    queueAvailability(updates, 120);
  }

  function queueAvailability(updates, delay = 350) {
    Object.assign(pendingUpdates, updates);
    clearTimeout(availabilityTimer);
    availabilityTimer = setTimeout(flushAvailability, delay);
  }

  async function flushAvailability() {
    if (availabilitySaving || !Object.keys(pendingUpdates).length) return;
    const identity = getIdentity(currentCode);
    if (!identity) return;
    availabilitySaving = true;
    const updates = pendingUpdates;
    pendingUpdates = {};
    try {
      const updated = await api(`/api/groups/${encodeURIComponent(currentCode)}/availability`, {
        method: 'PUT',
        body: JSON.stringify({ participantId: identity.participantId, roundId: state.round.id, updates }),
      });
      state = updated;
      renderGroupPreservingScroll();
    } catch (error) {
      Object.assign(pendingUpdates, updates);
      toast(error.message, 'error');
      try { state = await api(`/api/groups/${encodeURIComponent(currentCode)}`); renderGroupPreservingScroll(); } catch { /* keep current screen */ }
    } finally {
      availabilitySaving = false;
      if (Object.keys(pendingUpdates).length) availabilityTimer = setTimeout(flushAvailability, 100);
    }
  }

  function openModal(html) {
    modalContent.innerHTML = `<div class="modal-inner">${html}</div>`;
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    modalContent.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
  }

  function closeModal() {
    if (typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  }

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal();
  });

  async function requireOrganizerPin() {
    const saved = getOrganizerPin(currentCode);
    if (saved) return saved;
    return new Promise((resolve) => {
      openModal(`
        <div class="modal-head"><div><div class="eyebrow">Organizer</div><h2>Enter organizer PIN</h2></div><button class="modal-close" data-close-modal type="button">×</button></div>
        <form id="pinForm">
          <div class="field"><label for="organizerPin">PIN</label><input id="organizerPin" inputmode="numeric" pattern="[0-9]{4,8}" required autofocus></div>
          <div class="form-actions"><button class="primary" type="submit">Continue</button></div>
        </form>`);
      document.querySelector('#pinForm').addEventListener('submit', (event) => {
        event.preventDefault();
        const pin = document.querySelector('#organizerPin').value.trim();
        closeModal();
        resolve(pin);
      }, { once: true });
      modal.addEventListener('close', () => resolve(''), { once: true });
    });
  }

  async function openConfirm(startKey) {
    const candidate = state.candidates.find((item) => item.startKey === startKey);
    if (!candidate) return toast('That time is no longer available. Refresh and try again.', 'error');
    const pin = await requireOrganizerPin();
    if (!pin) return;
    const eligible = [
      ...candidate.yesIds.map((id) => ({ id, status: 'yes' })),
      ...candidate.maybeIds.map((id) => ({ id, status: 'maybe' })),
    ];
    const nameMap = new Map(state.participants.map((p) => [p.id, p.name]));
    const autoCheck = candidate.yesIds.length === state.requiredPeople ? new Set(candidate.yesIds) : new Set();
    openModal(`
      <div class="modal-head"><div><div class="eyebrow">Confirm booking</div><h2>${esc(formatSlot(startKey))}</h2><p class="muted">Choose exactly ${state.requiredPeople} participant${state.requiredPeople === 1 ? '' : 's'} for this booking.</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
      <form id="confirmForm">
        <div class="roster-list">
          ${eligible.map(({ id, status }) => `<label class="roster-option"><input type="checkbox" name="roster" value="${esc(id)}" ${autoCheck.has(id) ? 'checked' : ''}><span>${esc(nameMap.get(id) || 'Participant')}</span><span class="status-pill ${status}">${STATUS_LABELS[status]}</span></label>`).join('')}
        </div>
        <div class="help" id="rosterCount"></div>
        <div class="form-actions"><button class="ghost" data-close-modal type="button">Cancel</button><button class="primary" id="confirmBookingButton" type="submit">Confirm time</button></div>
      </form>`);
    const form = document.querySelector('#confirmForm');
    const updateCount = () => {
      const count = form.querySelectorAll('[name="roster"]:checked').length;
      document.querySelector('#rosterCount').textContent = `${count} of ${state.requiredPeople} selected`;
      document.querySelector('#confirmBookingButton').disabled = count !== state.requiredPeople;
    };
    form.addEventListener('change', updateCount);
    updateCount();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const participantIds = [...form.querySelectorAll('[name="roster"]:checked')].map((input) => input.value);
      const button = document.querySelector('#confirmBookingButton');
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Confirming';
      try {
        const updated = await api(`/api/groups/${encodeURIComponent(currentCode)}/confirm`, {
          method: 'POST',
          body: JSON.stringify({ pin, roundId: state.round.id, startKey, participantIds }),
        });
        saveOrganizerPin(currentCode, pin);
        state = updated;
        closeModal();
        renderGroup();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('Booking confirmed.');
      } catch (error) {
        if (error.status === 401) localStorage.removeItem(pinKey(currentCode));
        toast(error.message, 'error');
        button.disabled = false;
        button.textContent = 'Confirm time';
      }
    });
  }

  async function openOrganizer() {
    const pin = await requireOrganizerPin();
    if (!pin) return;
    const confirmed = state.round.confirmed;
    openModal(`
      <div class="modal-head"><div><div class="eyebrow">Organizer</div><h2>Group controls</h2></div><button class="modal-close" data-close-modal type="button">×</button></div>
      <div class="card soft">
        <h3>Current booking</h3>
        <p class="muted small">${confirmed ? esc(formatSlot(confirmed.startKey)) : 'No time has been confirmed yet.'}</p>
        ${confirmed ? '<button class="danger" id="unconfirmButton" type="button">Cancel confirmed time</button>' : ''}
      </div>
      <div class="card soft">
        <h3>Schedule the next one</h3>
        <p class="muted small">Keeps this group and its people, archives the current result, and clears availability for a fresh booking window.</p>
        <button class="secondary" id="newRoundButton" type="button">Start another booking</button>
      </div>
      <div class="card soft">
        <h3>Participants</h3>
        <div class="organizer-list">
          ${state.participants.map((participant) => `<div class="organizer-person"><span>${esc(participant.name)}</span><button class="danger remove-participant" data-id="${esc(participant.id)}" data-name="${esc(participant.name)}" type="button">Remove</button></div>`).join('')}
        </div>
      </div>`);

    document.querySelector('#unconfirmButton')?.addEventListener('click', () => unconfirm(pin));
    document.querySelector('#newRoundButton')?.addEventListener('click', () => openNewRound(pin));
    document.querySelectorAll('.remove-participant').forEach((button) => button.addEventListener('click', () => removeParticipant(pin, button.dataset.id, button.dataset.name)));
  }

  async function unconfirm(pin) {
    if (!confirm('Cancel the confirmed time and reopen this booking?')) return;
    try {
      state = await api(`/api/groups/${encodeURIComponent(currentCode)}/unconfirm`, {
        method: 'POST', body: JSON.stringify({ pin }),
      });
      saveOrganizerPin(currentCode, pin);
      closeModal();
      renderGroup();
      toast('Confirmed time canceled.');
    } catch (error) {
      if (error.status === 401) localStorage.removeItem(pinKey(currentCode));
      toast(error.message, 'error');
    }
  }

  function openNewRound(pin) {
    const round = state.round;
    openModal(`
      <div class="modal-head"><div><div class="eyebrow">Reuse ${esc(state.code)}</div><h2>Start another booking</h2><p class="muted">The current round moves into history. Participants stay in the group.</p></div><button class="modal-close" data-close-modal type="button">×</button></div>
      <form id="newRoundForm">
        <div class="form-grid">
          <div class="field"><label>Start date</label><input name="startDate" type="date" value="${localDate(0)}" required></div>
          <div class="field"><label>End date</label><input name="endDate" type="date" value="${localDate(14)}" required></div>
          <div class="field"><label>Activity length</label><select name="duration">${[30,60,90,120,150,180,240,300,360].map((m) => `<option value="${m}" ${m === round.durationMinutes ? 'selected' : ''}>${durationLabel(m)}</option>`).join('')}</select></div>
          <div class="field full"><span class="field-label">Days that can work</span><div class="day-checkboxes">${dayCheckboxes(round.allowedDays)}</div></div>
          <div class="field"><label>Weekday earliest</label><input name="weekdayStart" type="time" step="1800" value="${esc(round.weekdayStart)}" required></div>
          <div class="field"><label>Weekday latest</label><input name="weekdayEnd" type="time" step="1800" value="${esc(round.weekdayEnd)}" required></div>
          <div class="field"><label>Weekend earliest</label><input name="weekendStart" type="time" step="1800" value="${esc(round.weekendStart)}" required></div>
          <div class="field"><label>Weekend latest</label><input name="weekendEnd" type="time" step="1800" value="${esc(round.weekendEnd)}" required></div>
        </div>
        <div class="form-actions"><button class="ghost" data-close-modal type="button">Cancel</button><button class="primary" id="startRoundButton" type="submit">Start new booking</button></div>
      </form>`);
    document.querySelector('#newRoundForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const button = document.querySelector('#startRoundButton');
      button.disabled = true;
      const body = {
        pin,
        round: {
          startDate: String(data.get('startDate')),
          endDate: String(data.get('endDate')),
          durationMinutes: Number(data.get('duration')),
          weekdayStart: String(data.get('weekdayStart')),
          weekdayEnd: String(data.get('weekdayEnd')),
          weekendStart: String(data.get('weekendStart')),
          weekendEnd: String(data.get('weekendEnd')),
          allowedDays: selectedDays(form),
        },
      };
      try {
        state = await api(`/api/groups/${encodeURIComponent(currentCode)}/rounds`, { method: 'POST', body: JSON.stringify(body) });
        saveOrganizerPin(currentCode, pin);
        activeDate = state.schedule[0]?.date || null;
        closeModal();
        renderGroup();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('New booking window started.');
      } catch (error) {
        if (error.status === 401) localStorage.removeItem(pinKey(currentCode));
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
  }

  async function removeParticipant(pin, participantId, name) {
    if (!confirm(`Remove ${name} from this group? Their availability will be deleted.`)) return;
    try {
      state = await api(`/api/groups/${encodeURIComponent(currentCode)}/participants/${encodeURIComponent(participantId)}`, {
        method: 'DELETE',
        body: JSON.stringify({ pin }),
      });
      saveOrganizerPin(currentCode, pin);
      const identity = getIdentity(currentCode);
      if (identity?.participantId === participantId) localStorage.removeItem(identityKey(currentCode));
      closeModal();
      renderGroup();
      toast(`${name} removed.`);
    } catch (error) {
      if (error.status === 401) localStorage.removeItem(pinKey(currentCode));
      toast(error.message, 'error');
    }
  }

  async function refreshGroup() {
    if (!currentCode) return;
    const y = window.scrollY;
    try {
      state = await api(`/api/groups/${encodeURIComponent(currentCode)}`);
      renderGroup();
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
      toast('Group refreshed.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  brandButton.addEventListener('click', goHome);
  refreshButton.addEventListener('click', refreshGroup);
  window.addEventListener('popstate', () => boot());
  window.addEventListener('beforeunload', () => {
    if (Object.keys(pendingUpdates).length) {
      const identity = getIdentity(currentCode);
      if (identity && state) {
        const body = JSON.stringify({ participantId: identity.participantId, roundId: state.round.id, updates: pendingUpdates });
        fetch(`${API_BASE}/api/groups/${encodeURIComponent(currentCode)}/availability`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    }
  });

  async function boot() {
    const code = new URL(location.href).searchParams.get('group');
    if (code) {
      setGroupUrlSilently(code.toUpperCase());
      await loadGroup(code);
    } else {
      renderHome();
    }
  }

  function setGroupUrlSilently(code) {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('group', code);
    history.replaceState({}, '', url);
  }

  boot();
})();
