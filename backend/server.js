/**
 * Revive Bodywork — Booking Proxy + Dev Server
 *
 * Run:  npm start
 * Then: http://localhost:3001
 *
 * This server:
 *  1. Serves the widget files statically (so CORS never fires)
 *  2. Proxies Momence v1 read-only endpoints
 *  3. Returns smart availability slots sorted by gap-reduction score
 *  4. Handles auth and checkout (write operations)
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fetch    = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3001;

const HOST_ID        = process.env.MOMENCE_HOST_ID     || '37574';
const MOMENCE_TOKEN  = process.env.MOMENCE_TOKEN        || '35055b6efa';
const MOMENCE_CLIENT = process.env.MOMENCE_CLIENT_ID;
const MOMENCE_SECRET = process.env.MOMENCE_CLIENT_SECRET;
const MOMENCE_V1       = 'https://api.momence.com/api/v1';
const MOMENCE_V2       = 'https://api.momence.com';
const MOMENCE_READONLY = 'https://momence.com/_api/readonly';
// Support comma-separated list of allowed origins, e.g. "https://rbwdenver.com,https://scottaller.github.io"
const WIDGET_ORIGINS = (process.env.WIDGET_ORIGIN || '*')
  .split(',').map(o => o.trim()).filter(Boolean);
const CORS_ORIGIN = WIDGET_ORIGINS.length === 1 ? WIDGET_ORIGINS[0] : WIDGET_ORIGINS;

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

// Serve the widget root as static files so demo.html works at localhost:3001
app.use(express.static(path.join(__dirname, '..')));

// Serve widget.js — searches several candidate paths so it works in both
// Railway (where the build step copies it into backend/) and local dev
// (where it lives one level up). no-cache ensures browsers always get latest.
const fs = require('fs');
const WIDGET_CANDIDATES = [
  path.join(__dirname, 'widget.js'),                    // Railway: build copies it here
  path.join(__dirname, '..', 'widget.js'),              // local dev: repo root
  path.join(process.cwd(), 'widget.js'),                // fallback: cwd root
  path.join(process.cwd(), 'backend', 'widget.js'),     // fallback: cwd/backend
];
const WIDGET_PATH = WIDGET_CANDIDATES.find(p => { try { fs.accessSync(p); return true; } catch { return false; } }) || null;
app.get('/widget.js', (_req, res) => {
  if (!WIDGET_PATH) {
    return res.status(404).json({ error: 'widget.js not found', searched: WIDGET_CANDIDATES, cwd: process.cwd(), dir: __dirname });
  }
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(WIDGET_PATH);
});

// ─── Momence readonly helpers ──────────────────────────────────────────────
async function readonlyGet(path, params = {}) {
  const qs = Object.keys(params).length ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(MOMENCE_READONLY + path + qs);
  if (!res.ok) throw Object.assign(new Error(`Momence readonly ${res.status}`), { status: res.status });
  return res.json();
}

// All public boards with their services, cached 10 minutes.
// Signature Deep Tissue sorts first; remaining boards alphabetical.
let _boardsCache = null;
let _boardsCacheExpiry = 0;

async function getBoards() {
  if (_boardsCache && Date.now() < _boardsCacheExpiry) return _boardsCache;

  const all = await readonlyGet('/plugin/appointment-boards', { hostId: HOST_ID });
  const pub = all.filter(b => b.isPubliclyVisible);

  pub.sort((a, b) => {
    const sigA = a.name.toLowerCase().includes('signature');
    const sigB = b.name.toLowerCase().includes('signature');
    if (sigA && !sigB) return -1;
    if (!sigA && sigB) return 1;
    return a.name.replace(/^\W+/, '').localeCompare(b.name.replace(/^\W+/, ''));
  });

  const withServices = await Promise.all(pub.map(async board => {
    try {
      const raw = await readonlyGet(`/plugin/appointment-boards/${board.id}/services`, { hostId: HOST_ID });
      return {
        id: board.id,
        name: board.name,
        services: raw.map(s => ({
          id: s.id,
          appointmentServiceId: s.appointmentServiceId,
          name: s.appointmentService.name,
          description: s.appointmentService.description,
          priceInCurrency: s.appointmentService.priceInCurrency,
          minDurationInMinutes: s.appointmentService.minDurationInMinutes,
          addons: (s.appointmentService.addons || []).map(a => ({
            id: a.addon.id,
            name: a.addon.name,
            description: a.addon.description,
            priceInCurrency: parseFloat(a.addon.priceInCurrency),
            durationInMinutes: a.addon.durationInMinutes,
          })),
        })),
      };
    } catch {
      return { id: board.id, name: board.name, services: [] };
    }
  }));

  _boardsCache = withServices.filter(b => b.services.length);
  _boardsCacheExpiry = Date.now() + 10 * 60 * 1000;
  return _boardsCache;
}

// ─── Momence v1 helpers ────────────────────────────────────────────────────
async function v1Get(resource) {
  const url = `${MOMENCE_V1}/${resource}?hostId=${HOST_ID}&token=${MOMENCE_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`Momence v1 error ${res.status}`), { status: res.status });
  return res.json();
}

// ─── Momence v2 helpers ────────────────────────────────────────────────────
let _hostToken = null;
let _hostTokenExpiry = 0;
let _hostTokenPromise = null;

async function getHostToken() {
  if (_hostToken && Date.now() < _hostTokenExpiry) return _hostToken;
  if (!MOMENCE_CLIENT || !MOMENCE_SECRET) return null;
  if (_hostTokenPromise) return _hostTokenPromise;

  _hostTokenPromise = fetch(`${MOMENCE_V2}/api/v2/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: MOMENCE_CLIENT,
      client_secret: MOMENCE_SECRET,
    }),
  }).then(async res => {
    if (!res.ok) return null;
    const data = await res.json();
    _hostToken = data.access_token;
    _hostTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return _hostToken;
  }).finally(() => { _hostTokenPromise = null; });

  return _hostTokenPromise;
}

// Teachers list cached for 5 minutes — stable data, fetched on every availability request otherwise.
let _teachersCache = null;
let _teachersCacheExpiry = 0;

async function getTeachers() {
  if (_teachersCache && Date.now() < _teachersCacheExpiry) return _teachersCache;
  const all = await v1Get('Teachers');
  _teachersCache = all.filter(t => !t.isDeleted);
  _teachersCacheExpiry = Date.now() + 5 * 60 * 1000;
  return _teachersCache;
}

async function v2Get(path, token) {
  const res = await fetch(MOMENCE_V2 + path, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw Object.assign(new Error(`Momence v2 error ${res.status}`), { status: res.status });
  return res.json();
}

async function v2Post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(MOMENCE_V2 + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Momence v2 error ${res.status}`), { status: res.status });
  return data;
}

function apiError(res, err) {
  console.error('[RBW]', err.message);
  res.status(err.status || 500).json({ message: err.message });
}

function memberToken(req) {
  return (req.headers.authorization || '').replace('Bearer ', '');
}

// ─── Widget config (pricing lives here so it never needs a code deploy) ────
// Set PRICE_30, PRICE_60, PRICE_90, PRICE_120 in .env to override defaults.
app.get('/api/config', (_req, res) => {
  // Parse HIDDEN_PRODUCT_IDS from env — comma-separated Momence product IDs to exclude from upsells.
  // Default hides ICD10 billing codes and tips.
  const hiddenProductIds = (process.env.HIDDEN_PRODUCT_IDS || '292889,340291')
    .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));

  res.json({
    prices: {
      30:  parseInt(process.env.PRICE_30  || '75'),
      60:  parseInt(process.env.PRICE_60  || '120'),
      90:  parseInt(process.env.PRICE_90  || '180'),
      120: parseInt(process.env.PRICE_120 || '240'),
    },
    hiddenProductIds,
  });
});

// ─── v1 passthrough ────────────────────────────────────────────────────────
// Proxies Teachers, Products, Memberships etc. through the server
// so the browser never makes cross-origin calls directly.
app.get('/api/v1/:resource', async (req, res) => {
  try {
    const data = await v1Get(req.params.resource);
    res.json(data);
  } catch (err) {
    apiError(res, err);
  }
});

// ─── Smart Availability ────────────────────────────────────────────────────
/**
 * GET /api/availability?date=YYYY-MM-DD&duration=60&therapistId=optional&couples=true
 *
 * Returns available time slots sorted by gap-reduction score.
 * Each slot includes the therapist so the user picks time+therapist together.
 *
 * When couples=true, returns couplesSlots instead — time offsets where 2+
 * different therapists are simultaneously free.
 *
 * Gap-reduction scoring:
 *   +100  slot is directly adjacent to an existing booking (zero gap)
 *   +60   slot leaves a gap < 30 min (fills near-gap)
 *   +30   first slot of the day (anchors the morning block)
 *   +20   last slot before close (anchors the evening block)
 *   -30   slot creates an isolated gap of 60–90 min
 *   -60   slot creates an isolated gap > 90 min
 */
app.get('/api/availability', async (req, res) => {
  const { date, duration = 60, therapistId, couples } = req.query;
  if (!date) return res.status(400).json({ message: 'date is required' });

  const durMin  = parseInt(duration);
  const isCouples = couples === 'true';

  let teachers = [];
  try {
    teachers = await getTeachers();
  } catch {
    teachers = [];
  }

  // For individual bookings, optionally filter to a specific therapist
  if (!isCouples && therapistId) {
    teachers = teachers.filter(t => String(t.id) === String(therapistId));
  }

  // Build candidate slots in 30-min increments.
  // HOURS_OPEN / HOURS_CLOSE are in 24-hour format (9 = 9 AM, 19 = 7 PM).
  // Override via BUSINESS_OPEN / BUSINESS_CLOSE env vars.
  const OPEN  = parseInt(process.env.BUSINESS_OPEN  || '9')  * 60;
  const CLOSE = parseInt(process.env.BUSINESS_CLOSE || '19') * 60; // 7:00 PM
  const candidateOffsets = [];
  for (let m = OPEN; m + durMin <= CLOSE; m += 30) candidateOffsets.push(m);

  // Try to fetch existing reservations for gap scoring (requires v2 credentials)
  let existingBookings = [];
  try {
    const hostToken = await getHostToken();
    if (hostToken) {
      const startAfter  = new Date(date + 'T00:00:00Z').toISOString();
      const startBefore = new Date(date + 'T23:59:59Z').toISOString();
      const data = await v2Get(
        `/api/v2/host/appointments/reservations?page=0&pageSize=200&startAfter=${startAfter}&startBefore=${startBefore}&includeCancelled=false`,
        hostToken
      );
      existingBookings = (data.content || []).map(r => ({
        teacherId:   r.teacher?.id,
        startMinute: minutesFromISO(r.startsAt),
        endMinute:   minutesFromISO(r.startsAt) + (r.durationInMinutes || 60),
      }));
    }
  } catch {
    // v2 not configured — fall back to heuristic scoring only
  }

  // Helper: build the slot fields for a teacher at a given offset
  function buildSlotFields(teacher, offset) {
    const name = teacher.firstName
      ? `${teacher.firstName} ${(teacher.lastName || '').trim()}`.trim()
      : (teacher.name || 'Therapist');
    return {
      therapistId:        teacher.id,
      therapistName:      name,
      therapistPhoto:     teacher.profileImage || null,
      therapistSpecialty: teacher.specialty || teacher.title || 'Licensed Massage Therapist',
    };
  }

  // ── Couples mode: find offsets where 2+ therapists are free simultaneously ──
  if (isCouples) {
    // Compute free slots per teacher
    const freeByTeacher = teachers.map(teacher => {
      const teacherBookings = existingBookings.filter(b => b.teacherId === teacher.id);
      const freeOffsets = candidateOffsets.filter(offset => {
        const slotEnd = offset + durMin;
        return !teacherBookings.some(b => offset < b.endMinute && slotEnd > b.startMinute);
      });
      return { teacher, teacherBookings, freeOffsets };
    });

    // For each offset, collect all teachers who are free
    const couplesSlots = [];
    for (const offset of candidateOffsets) {
      const freeTeachers = freeByTeacher.filter(({ freeOffsets }) =>
        freeOffsets.includes(offset)
      );
      if (freeTeachers.length < 2) continue;

      // Pick the two highest-scored therapists for this offset
      const scored = freeTeachers.map(({ teacher, teacherBookings }) => ({
        teacher,
        score: scoreSlot(offset, offset + durMin, teacherBookings),
      }));
      scored.sort((a, b) => b.score - a.score);

      const t1 = scored[0].teacher;
      const t2 = scored[1].teacher;
      const combinedScore = scored[0].score + scored[1].score;

      couplesSlots.push({
        time:        minutesToLabel(offset),
        minuteOffset: offset,
        therapist1:  buildSlotFields(t1, offset),
        therapist2:  buildSlotFields(t2, offset),
        score:       combinedScore,
      });
    }

    // Sort by combined score desc, then time asc
    couplesSlots.sort((a, b) => b.score - a.score || a.minuteOffset - b.minuteOffset);

    return res.json({
      couples: true,
      couplesSlots,
      firstAvailable: couplesSlots[0] || null,
      date,
    });
  }

  // ── Standard (individual) mode ───────────────────────────────────────────
  const slots = [];
  for (const teacher of teachers) {
    const teacherBookings = existingBookings.filter(b => b.teacherId === teacher.id);

    for (const offset of candidateOffsets) {
      const slotEnd = offset + durMin;

      // Skip if conflicts with existing booking
      const conflicts = teacherBookings.some(b =>
        offset < b.endMinute && slotEnd > b.startMinute
      );
      if (conflicts) continue;

      const score = scoreSlot(offset, slotEnd, teacherBookings);

      slots.push({
        time:        minutesToLabel(offset),
        minuteOffset: offset,
        ...buildSlotFields(teacher, offset),
        score,
        available: true,
      });
    }
  }

  // Sort by score desc, then by time asc within same score tier
  slots.sort((a, b) => b.score - a.score || a.minuteOffset - b.minuteOffset);

  res.json({
    slots,
    firstAvailable: slots[0] || null,
    date,
  });
});

// ─── Gap-reduction scoring algorithm ──────────────────────────────────────
function scoreSlot(start, end, teacherBookings) {
  let score = 50; // baseline

  for (const b of teacherBookings) {
    const gapAfter  = start - b.endMinute;
    const gapBefore = b.startMinute - end;

    if (gapAfter === 0)        score += 100; // directly adjacent after
    if (gapBefore === 0)       score += 100; // directly adjacent before
    if (gapAfter > 0 && gapAfter < 30)   score += 60;
    if (gapBefore > 0 && gapBefore < 30) score += 60;

    // Penalise creating isolated gaps
    if (gapAfter > 60 && gapAfter < 180)    score -= 30;
    if (gapBefore > 60 && gapBefore < 180)  score -= 30;
    if (gapAfter >= 180 || gapBefore >= 180) score -= 60;
  }

  // No bookings yet — prefer anchoring to start or end of day
  if (!teacherBookings.length) {
    if (start <= 9 * 60 + 30)  score += 30;  // first morning slot (≤ 9:30 AM)
    if (end >= 18 * 60 + 30)   score += 20;  // end-of-day slot (ends ≥ 6:30 PM)
  }

  return score;
}

// Use local time (not UTC) so slot offsets match the server's timezone.
// The server should run in the same timezone as the business (Denver, MST/MDT).
function minutesFromISO(iso) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

function minutesToLabel(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

// ─── Auth ──────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required.' });
  if (!MOMENCE_CLIENT) return res.status(503).json({ message: 'Auth not configured — add MOMENCE_CLIENT_ID to .env' });

  try {
    const result = await v2Post('/api/v2/auth/token', {
      grant_type: 'password', client_id: MOMENCE_CLIENT,
      client_secret: MOMENCE_SECRET, username: email, password,
    }, null);
    res.json({ accessToken: result.access_token });
  } catch (err) {
    if (err.status === 401 || err.status === 400)
      return res.status(401).json({ message: 'Incorrect email or password.' });
    apiError(res, err);
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName || !email || !password)
    return res.status(400).json({ message: 'First name, email, and password are required.' });
  if (!MOMENCE_CLIENT) return res.status(503).json({ message: 'Auth not configured — add MOMENCE_CLIENT_ID to .env' });

  try {
    const hostToken = await getHostToken();
    await v2Post('/api/v2/host/members', { firstName, lastName: lastName || '', email, password }, hostToken);
    const auth = await v2Post('/api/v2/auth/token', {
      grant_type: 'password', client_id: MOMENCE_CLIENT,
      client_secret: MOMENCE_SECRET, username: email, password,
    }, null);
    res.json({ accessToken: auth.access_token });
  } catch (err) {
    if (err.status === 409)
      return res.status(409).json({ message: 'An account with this email already exists.' });
    apiError(res, err);
  }
});

// ─── Member profile ────────────────────────────────────────────────────────
app.get('/api/member/profile', async (req, res) => {
  const token = memberToken(req);
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const data = await v2Get('/api/v2/auth/profile', token);
    res.json(data);
  } catch (err) { apiError(res, err); }
});

// ─── Saved payment methods ─────────────────────────────────────────────────
// GET  → list member's saved cards
// POST → returns Momence-hosted add-card URL ({ url }) for popup flow
app.get('/api/payment-methods', async (req, res) => {
  const token = memberToken(req);
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const data = await v2Get('/api/v2/member/saved-payment-methods', token);
    res.json(data);
  } catch (err) { apiError(res, err); }
});

app.post('/api/payment-methods/setup', async (req, res) => {
  const token = memberToken(req);
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const data = await v2Post('/api/v2/member/saved-payment-methods', {}, token);
    res.json(data);
  } catch (err) { apiError(res, err); }
});

// ─── Active memberships ────────────────────────────────────────────────────
app.get('/api/memberships/active', async (req, res) => {
  const token = memberToken(req);
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const data = await v2Get('/api/v2/member/bought-memberships/active', token);
    res.json(data);
  } catch (err) { apiError(res, err); }
});

// ─── Checkout price preview ────────────────────────────────────────────────
app.post('/api/checkout/prices', async (req, res) => {
  const token = memberToken(req);
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    const data = await v2Post('/api/v2/member/checkout/prices', req.body, token);
    res.json(data);
  } catch (err) { apiError(res, err); }
});

// ─── Checkout ──────────────────────────────────────────────────────────────
// paymentMethods must be one of:
//   [{ type: 'saved_payment_method', savedPaymentMethodId: N }]
//   [{ type: 'membership', boughtMembershipId: N }]
app.post('/api/checkout', async (req, res) => {
  const token = memberToken(req);
  if (!token) return res.status(401).json({ message: 'Authentication required.' });

  try {
    const { duration, startsAt, therapistId, appointmentServiceId, addonIds, upsells, savedPaymentMethodId, boughtMembershipId } = req.body;

    const items = [];
    if (startsAt) {
      const appt = {
        type: 'appointment',
        startsAt,
        durationInMinutes: duration,
        teacherId: therapistId || null,
      };
      if (appointmentServiceId) appt.appointmentServiceId = appointmentServiceId;
      items.push(appt);
    }
    // Add-ons from the new service-addon flow
    (addonIds || []).forEach(id => items.push({ type: 'appointment-addon', appointmentAddonId: id }));
    // Legacy product upsells (kept for backwards compat)
    (upsells || []).forEach(id => items.push({ type: 'product', productId: id }));

    // Build paymentMethods — required by Momence v2 checkout
    const paymentMethods = [];
    if (savedPaymentMethodId) {
      paymentMethods.push({ type: 'saved_payment_method', savedPaymentMethodId });
    } else if (boughtMembershipId) {
      paymentMethods.push({ type: 'membership', boughtMembershipId });
    }

    const body = { items };
    if (paymentMethods.length) body.paymentMethods = paymentMethods;

    const result = await v2Post('/api/v2/member/checkout', body, token);
    res.json({ success: true, booking: result });
  } catch (err) {
    apiError(res, err);
  }
});

// ─── Promo / Discount Code Validation ─────────────────────────────────────
// Codes are stored in DISCOUNT_CODES env var as a JSON string.
// Format: { "CODE": "pct:10" } for 10% off, { "CODE": "flat:20" } for $20 off.
// Example: DISCOUNT_CODES='{"WELCOME10":"pct:10","SUMMER20":"flat:20"}'
app.post('/api/promo/validate', (req, res) => {
  const { code, subtotal } = req.body;
  if (!code || typeof subtotal !== 'number') {
    return res.status(400).json({ message: 'code and subtotal are required.' });
  }

  let discountMap = {};
  try {
    discountMap = JSON.parse(process.env.DISCOUNT_CODES || '{}');
  } catch {
    // Malformed env var — treat as empty
    discountMap = {};
  }

  const rule = discountMap[code.toUpperCase().trim()];
  if (!rule) {
    return res.status(404).json({ message: 'Invalid discount code.' });
  }

  const [type, rawAmount] = rule.split(':');
  const amount = parseFloat(rawAmount);

  let discount = 0;
  if (type === 'pct') {
    discount = Math.round(subtotal * (amount / 100) * 100) / 100;
  } else if (type === 'flat') {
    discount = Math.min(amount, subtotal);
  } else {
    return res.status(500).json({ message: 'Invalid discount rule configuration.' });
  }

  const final = Math.max(0, Math.round((subtotal - discount) * 100) / 100);

  res.json({
    valid:    true,
    code:     code.toUpperCase().trim(),
    type,
    amount,
    discount,
    final,
  });
});

// ─── Teachers (public — returns photos from v1 for widget UI) ─────────────
app.get('/api/teachers', async (_req, res) => {
  try {
    const teachers = await getTeachers();
    res.json(teachers.map(t => ({
      id:        t.id,
      firstName: (t.firstName || '').trim(),
      lastName:  (t.lastName  || '').trim(),
      bio:       t.bio       || null,
      photo:     t.profileImage || null,
      specialty: t.specialty || t.title || null,
    })));
  } catch (err) { apiError(res, err); }
});

// ─── Boards (real Momence data) ────────────────────────────────────────────
app.get('/api/boards', async (_req, res) => {
  try { res.json(await getBoards()); }
  catch (err) { apiError(res, err); }
});

// GET /api/boards/:boardId/staff?serviceId=X
// Cross-references v1 teachers to populate real profile photos.
app.get('/api/boards/:boardId/staff', async (req, res) => {
  const { boardId } = req.params;
  const { serviceId } = req.query;
  if (!serviceId) return res.status(400).json({ message: 'serviceId is required' });
  try {
    const [raw, teachers] = await Promise.all([
      readonlyGet(`/plugin/appointment-boards/${boardId}/staff`, { hostId: HOST_ID, serviceId }),
      getTeachers(),
    ]);
    const teacherMap = new Map(teachers.map(t => [t.id, t]));
    const staff = (Array.isArray(raw) ? raw : [])
      .filter(s => !s.isDeleted && s.isAvailable !== false)
      .map(s => {
        const t = teacherMap.get(s.teacherId);
        return {
          teacherId: s.teacherId,
          name: `${s.teacher?.firstName || t?.firstName || ''} ${s.teacher?.lastName || t?.lastName || ''}`.trim() || 'Therapist',
          photo: t?.profileImage || null,
          bio:   t?.bio          || null,
        };
      });
    res.json(staff);
  } catch (err) { apiError(res, err); }
});

// GET /api/boards/:boardId/available-times?serviceId=X&from=YYYY-MM-DD&to=YYYY-MM-DD&staffId=optional
app.get('/api/boards/:boardId/available-times', async (req, res) => {
  const { boardId } = req.params;
  const { serviceId, from, to, staffId } = req.query;
  if (!serviceId || !from || !to) return res.status(400).json({ message: 'serviceId, from, to are required' });
  const params = { hostId: HOST_ID, serviceId, from, to };
  if (staffId) params.staffId = staffId;
  try {
    const data = await readonlyGet(`/plugin/appointment-boards/${boardId}/available-times`, params);
    res.json(data);
  } catch (err) { apiError(res, err); }
});

// ─── Health ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', host: HOST_ID }));

app.listen(PORT, () => {
  console.log(`\n  🌿 RBW Booking Widget`);
  console.log(`  → Open: http://localhost:${PORT}`);
  console.log(`  → Momence host: ${HOST_ID}`);
  console.log(`  → v2 auth: ${MOMENCE_CLIENT ? '✓ configured' : '✗ not set (add to .env)'}\n`);
});
