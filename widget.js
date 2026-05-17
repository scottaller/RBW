/**
 * Revive Bodywork Booking Widget
 * Slide-in booking panel powered by the Momence (Ribbon) v1 API.
 *
 * Usage:
 *   <script src="widget.js"
 *     data-host-id="37574"
 *     data-token="35055b6efa"
 *     data-api-url="http://localhost:3001/api"
 *   ></script>
 *
 * Trigger from any element:
 *   <button data-rbw-book>Book Now</button>
 *
 * Floating button:
 *   Add data-rbw-floating="true" to the <script> tag.
 */

(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  const scriptTag  = document.currentScript || document.querySelector('script[data-host-id]');
  const PROXY_URL  = (scriptTag && scriptTag.getAttribute('data-api-url'))   || '/api';
  const FLOATING   = scriptTag && scriptTag.getAttribute('data-rbw-floating') === 'true';

  // Steps
  const S = {
    CATEGORY:     'category',     // Massage or Acupuncture
    DURATION:     'duration',     // length + service (one page)
    ADDONS:       'addons',       // pick add-ons
    THERAPIST:    'therapist',    // pick therapist or "any"
    CALENDAR:     'calendar',     // pick date + time
    REVIEW:       'review',       // order summary + promo
    AUTH:         'auth',         // login / register
    CHECKOUT:     'checkout',     // payment
    CONFIRMATION: 'confirmation', // done
  };

  const PROGRESS = {
    [S.CATEGORY]:     5,
    [S.DURATION]:     18,
    [S.ADDONS]:       34,
    [S.THERAPIST]:    50,
    [S.CALENDAR]:     65,
    [S.REVIEW]:       78,
    [S.AUTH]:         88,
    [S.CHECKOUT]:     95,
    [S.CONFIRMATION]: 100,
  };

  const BACK_TO = {
    [S.DURATION]:  S.CATEGORY,
    [S.ADDONS]:    S.DURATION,
    [S.CALENDAR]:  S.ADDONS,
    [S.REVIEW]:    S.CALENDAR,
    [S.AUTH]:      S.REVIEW,
    [S.CHECKOUT]:  S.REVIEW,
  };

  // Populated from /api/config on init; defaults match .env
  const HIDDEN_PRODUCT_IDS = new Set();
  const PRICES = { 30: 75, 60: 120, 90: 180, 120: 240 };

  // ─── State ─────────────────────────────────────────────────────────────────
  function freshState() {
    return {
      step:         S.CATEGORY,
      category:     null,   // 'massage' | 'acupuncture'
      duration:     null,   // 30 | 60 | 90 | 120
      board:        null,   // { id, name } selected board
      service:      null,   // { appointmentServiceId, name, priceInCurrency, addons, ... }
      selectedAddons:  [],  // [{ id, name, priceInCurrency, durationInMinutes }]
      staffId:      null,   // teacherId or null = any available
      staffName:    null,   // display name for review
      selectedDate: null,
      selectedSlot: null,   // { isoValue, time }
      promoCode:    null,   // { code, discount, final } when applied
      token:        null,
      authMode:     'login',
      memberProfile:       null,
      savedPaymentMethods: [],
      activeMemberships:   [],
      selectedPmId: null,
      selectedMbId: null,
      // Session caches (persist for panel lifetime)
      _boardsCache: null,
      _staffCache:  null,
    };
  }
  let state = freshState();

  // ─── All API calls route through the backend proxy ─────────────────────────
  // Authenticated GET — sends the member Bearer token when available.
  async function authGet(path) {
    const headers = {};
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    const res = await fetch(PROXY_URL + path, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `API error ${res.status}`);
    }
    return res.json();
  }

  async function proxyPost(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    const res = await fetch(PROXY_URL + path, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Request failed');
    return data;
  }

  // ─── CSS ───────────────────────────────────────────────────────────────────
  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400&display=swap');

    :root {
      --rbw-primary:      #F39C44;
      --rbw-primary-dk:   #E68C3A;
      --rbw-primary-lt:   #FEF3E4;
      --rbw-purple:       #412F83;
      --rbw-purple-lt:    #EEE9F8;
      --rbw-bg:           #F6F6F6;
      --rbw-panel:        #FFFFFF;
      --rbw-text:         #3E3E3E;
      --rbw-muted:        #999999;
      --rbw-border:       #E7E7E7;
      --rbw-radius:       12px;
      --rbw-w:            420px;
      --rbw-font: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* Overlay */
    #rbw-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(42,40,37,0.45); backdrop-filter: blur(2px);
      z-index: 99998; cursor: pointer;
      opacity: 0; transition: opacity 0.3s ease;
    }
    #rbw-overlay.rbw-show { opacity: 1; }

    /* Panel */
    #rbw-panel {
      position: fixed; top: 0; right: 0; bottom: 0;
      width: var(--rbw-w); max-width: 100vw;
      background: var(--rbw-panel);
      z-index: 99999;
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column;
      font-family: var(--rbw-font);
      color: var(--rbw-text);
      box-shadow: 0 8px 48px rgba(0,0,0,0.2);
    }
    #rbw-panel.rbw-open { transform: translateX(0); }

    /* Header */
    .rbw-hdr {
      display: flex; align-items: center;
      padding: 14px 18px; gap: 10px;
      border-bottom: 1px solid var(--rbw-border);
      background: #fff; flex-shrink: 0;
    }
    .rbw-hdr-brand {
      flex: 1; display: flex; flex-direction: column; align-items: center;
    }
    .rbw-hdr-brand b {
      font-size: 13px; font-weight: 700;
      letter-spacing: 0.09em; text-transform: uppercase; color: var(--rbw-purple);
    }
    .rbw-hdr-brand small {
      font-size: 10px; color: var(--rbw-muted);
      letter-spacing: 0.05em; text-transform: uppercase;
    }
    .rbw-icon-btn {
      background: none; border: none; cursor: pointer;
      color: var(--rbw-muted); width: 36px; height: 36px;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s, color 0.15s; flex-shrink: 0;
    }
    .rbw-icon-btn:hover { background: var(--rbw-purple-lt); color: var(--rbw-purple); }
    .rbw-icon-btn svg { width: 18px; height: 18px; }

    /* Progress */
    .rbw-prog { height: 3px; background: var(--rbw-border); flex-shrink: 0; }
    .rbw-prog-fill { height: 100%; background: var(--rbw-primary); transition: width 0.4s ease; }

    /* Scroll body */
    #rbw-body {
      flex: 1; overflow-y: auto; overflow-x: hidden;
      padding: 22px 20px 220px; background: var(--rbw-bg);
    }
    #rbw-body::-webkit-scrollbar { width: 4px; }
    #rbw-body::-webkit-scrollbar-thumb { background: var(--rbw-border); border-radius: 4px; }

    /* Sticky footer */
    .rbw-footer {
      position: absolute; bottom: 0; left: 0; right: 0;
      padding: 14px 20px; background: #fff;
      border-top: 1px solid var(--rbw-border);
    }

    /* Typography */
    .rbw-title    { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
    .rbw-subtitle { font-size: 14px; color: var(--rbw-muted); margin: 0 0 20px; }
    .rbw-lbl      { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--rbw-muted); margin-bottom: 10px; }

    /* Buttons */
    .rbw-btn {
      display: block; width: 100%; padding: 13px 18px;
      border: none; border-radius: var(--rbw-radius);
      font-family: var(--rbw-font); font-size: 15px; font-weight: 600;
      cursor: pointer; text-align: center; text-decoration: none;
      transition: all 0.18s;
    }
    .rbw-btn-primary  { background: var(--rbw-primary); color: #fff; }
    .rbw-btn-primary:hover { background: var(--rbw-primary-dk); transform: translateY(-1px); }
    .rbw-btn-primary:disabled { background: var(--rbw-border); color: var(--rbw-muted); cursor: not-allowed; transform: none; }
    .rbw-btn-outline  { background: transparent; color: var(--rbw-purple); border: 2px solid var(--rbw-purple); }
    .rbw-btn-outline:hover { background: var(--rbw-purple-lt); }
    .rbw-btn-ghost    { background: transparent; color: var(--rbw-muted); font-weight: 400; font-size: 14px; }
    .rbw-btn-ghost:hover { color: var(--rbw-text); }
    .btn-sm {
      display: inline-block; width: auto; padding: 9px 18px;
      margin: 10px auto 0; font-size: 14px;
    }

    /* Duration grid */
    .rbw-dur-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 22px; }
    .rbw-dur-card {
      border: 2px solid var(--rbw-border); border-radius: 10px;
      padding: 14px 10px; cursor: pointer; text-align: center;
      transition: all 0.18s; background: var(--rbw-panel);
    }
    .rbw-dur-card:hover { border-color: var(--rbw-primary); background: var(--rbw-primary-lt); }
    .rbw-dur-card.on { border-color: var(--rbw-primary); background: var(--rbw-primary); color: #fff; }
    .rbw-dur-time  { font-size: 17px; font-weight: 700; }
    .rbw-dur-price { font-size: 13px; opacity: 0.8; margin-top: 2px; }

    /* Type grid */
    .rbw-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 22px; }
    .rbw-type-card {
      border: 2px solid var(--rbw-border); border-radius: 10px;
      padding: 13px 12px; cursor: pointer; transition: all 0.18s; background: var(--rbw-panel);
    }
    .rbw-type-card:hover { border-color: var(--rbw-purple); }
    .rbw-type-card.on { border-color: var(--rbw-purple); background: var(--rbw-purple-lt); }
    .rbw-type-name { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
    .rbw-type-desc { font-size: 12px; color: var(--rbw-muted); }

    /* Calendar */
    .rbw-cal { background: var(--rbw-panel); border: 1px solid var(--rbw-border); border-radius: var(--rbw-radius); overflow: hidden; margin-bottom: 20px; }
    .rbw-cal-hdr { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--rbw-purple); color: #fff; }
    .rbw-cal-hdr h3 { margin: 0; font-size: 15px; font-weight: 600; }
    .rbw-cal-nav { background: rgba(255,255,255,.2); border: none; color: #fff; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; transition: background .15s; }
    .rbw-cal-nav:hover { background: rgba(255,255,255,.35); }
    .rbw-cal-grid { display: grid; grid-template-columns: repeat(7,1fr); }
    .rbw-cal-dow { text-align: center; padding: 8px 2px; font-size: 11px; font-weight: 700; color: var(--rbw-muted); text-transform: uppercase; }
    .rbw-cal-wrap { display: flex; justify-content: center; padding: 2px; }
    .rbw-cal-day {
      width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
      font-size: 13px; border-radius: 50%; cursor: pointer; transition: all .15s;
    }
    .rbw-cal-day:hover:not(.past):not(.empty) { background: var(--rbw-primary-lt); color: var(--rbw-primary-dk); }
    .rbw-cal-day.today  { font-weight: 700; color: var(--rbw-purple); }
    .rbw-cal-day.picked { background: var(--rbw-primary); color: #fff; font-weight: 700; }
    .rbw-cal-day.past   { color: var(--rbw-border); cursor: default; }
    .rbw-cal-day.empty  { cursor: default; }

    /* Gender filter */
    .rbw-gender { display: flex; gap: 8px; margin-bottom: 14px; }
    .rbw-gender-btn {
      flex: 1; padding: 8px 4px; border: 2px solid var(--rbw-border);
      border-radius: 8px; background: var(--rbw-panel);
      font-family: var(--rbw-font); font-size: 13px; font-weight: 500;
      cursor: pointer; text-align: center; transition: all .15s;
    }
    .rbw-gender-btn:hover { border-color: var(--rbw-primary); }
    .rbw-gender-btn.on { border-color: var(--rbw-primary); background: var(--rbw-primary); color: #fff; }

    /* Therapist list */
    .rbw-tx-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
    .rbw-tx-card {
      background: var(--rbw-panel); border: 2px solid var(--rbw-border);
      border-radius: var(--rbw-radius); padding: 12px 14px;
      display: flex; align-items: center; gap: 12px;
      cursor: pointer; transition: all .18s;
    }
    .rbw-tx-card:hover { border-color: var(--rbw-purple); }
    .rbw-tx-card.on { border-color: var(--rbw-purple); background: var(--rbw-purple-lt); }
    .rbw-tx-avatar {
      width: 44px; height: 44px; border-radius: 50%;
      background: var(--rbw-purple-lt); display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 15px; color: var(--rbw-purple); flex-shrink: 0; overflow: hidden;
    }
    .rbw-tx-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .rbw-tx-name { font-size: 14px; font-weight: 600; }
    .rbw-tx-spec { font-size: 12px; color: var(--rbw-muted); }
    .rbw-tx-arrow { margin-left: auto; color: var(--rbw-muted); }

    /* First Available card */
    .rbw-first-avail {
      background: linear-gradient(135deg, var(--rbw-purple) 0%, #2d1f6b 100%);
      border-radius: var(--rbw-radius); padding: 20px; margin-bottom: 20px; color: #fff;
    }
    .rbw-first-avail-label {
      font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
      opacity: 0.75; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;
    }
    .rbw-first-avail-time { font-size: 28px; font-weight: 700; line-height: 1; margin-bottom: 4px; }
    .rbw-first-avail-date { font-size: 13px; opacity: 0.8; margin-bottom: 12px; }
    .rbw-first-avail-therapist { font-size: 13px; opacity: 0.85; margin-bottom: 12px; font-weight: 500; }
    .rbw-first-avail-btn {
      background: var(--rbw-primary); color: #fff; border: none; border-radius: 8px;
      padding: 11px 18px; font-family: var(--rbw-font); font-size: 14px; font-weight: 700;
      cursor: pointer; width: 100%; transition: background .15s;
    }
    .rbw-first-avail-btn:hover { background: var(--rbw-primary-dk); }

    /* Divider with text */
    .rbw-or { display: flex; align-items: center; gap: 10px; margin: 16px 0 14px; color: var(--rbw-muted); font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
    .rbw-or::before, .rbw-or::after { content: ''; flex: 1; height: 1px; background: var(--rbw-border); }

    /* Slot list (time + therapist per row) */
    .rbw-slot-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
    .rbw-slot-row {
      background: var(--rbw-panel); border: 2px solid var(--rbw-border);
      border-radius: 10px; padding: 11px 14px;
      display: flex; align-items: center; gap: 12px;
      cursor: pointer; transition: all .15s;
    }
    .rbw-slot-row:hover { border-color: var(--rbw-primary); }
    .rbw-slot-row.on { border-color: var(--rbw-primary); background: var(--rbw-primary-lt); }
    .rbw-slot-row.on .rbw-slot-time { color: var(--rbw-primary-dk); }
    .rbw-slot-time { font-size: 15px; font-weight: 700; min-width: 72px; color: var(--rbw-text); }
    .rbw-slot-tx { display: flex; align-items: center; gap: 8px; flex: 1; }
    .rbw-slot-avatar {
      width: 30px; height: 30px; border-radius: 50%;
      background: var(--rbw-purple-lt); color: var(--rbw-purple);
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; flex-shrink: 0; overflow: hidden;
    }
    .rbw-slot-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .rbw-slot-tx-name { font-size: 13px; font-weight: 500; }
    .rbw-slot-check { margin-left: auto; color: var(--rbw-primary); font-weight: 700; font-size: 16px; opacity: 0; }
    .rbw-slot-row.on .rbw-slot-check { opacity: 1; }
    .rbw-no-avail { text-align: center; padding: 28px 16px; color: var(--rbw-muted); font-size: 14px; }

    /* Time chip picker */
    .rbw-time-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 0; }
    .rbw-time-chip {
      padding: 9px 16px; border: 2px solid var(--rbw-border); border-radius: 22px;
      font-family: var(--rbw-font); font-size: 13px; font-weight: 600;
      cursor: pointer; background: var(--rbw-panel); color: var(--rbw-text);
      transition: all .15s; white-space: nowrap;
    }
    .rbw-time-chip:hover { border-color: var(--rbw-primary); color: var(--rbw-primary-dk); }
    .rbw-time-chip.on { border-color: var(--rbw-primary); background: var(--rbw-primary); color: #fff; }

    /* Therapist filter accordion */
    .rbw-filter-toggle {
      display: flex; align-items: center; justify-content: space-between;
      background: none; border: 1px solid var(--rbw-border); border-radius: 8px;
      padding: 10px 14px; width: 100%; font-family: var(--rbw-font);
      font-size: 13px; font-weight: 600; color: var(--rbw-text); cursor: pointer;
      margin-bottom: 10px; transition: all .15s;
    }
    .rbw-filter-toggle:hover { border-color: var(--rbw-purple); color: var(--rbw-purple); }
    .rbw-filter-toggle .rbw-chevron { transition: transform .2s; font-size: 11px; }
    .rbw-filter-toggle.open .rbw-chevron { transform: rotate(180deg); }
    .rbw-filter-body { display: none; margin-bottom: 14px; }
    .rbw-filter-body.open { display: block; }
    .rbw-filter-pills { display: flex; flex-wrap: wrap; gap: 8px; }
    .rbw-pill {
      padding: 6px 14px; border: 2px solid var(--rbw-border); border-radius: 20px;
      font-size: 13px; font-weight: 500; cursor: pointer; background: var(--rbw-panel);
      font-family: var(--rbw-font); transition: all .15s;
    }
    .rbw-pill:hover { border-color: var(--rbw-purple); color: var(--rbw-purple); }
    .rbw-pill.on { border-color: var(--rbw-purple); background: var(--rbw-purple); color: #fff; }

    /* Auth */
    .rbw-tabs { display: flex; border-bottom: 2px solid var(--rbw-border); margin-bottom: 20px; }
    .rbw-tab {
      flex: 1; padding: 11px; background: none; border: none;
      font-family: var(--rbw-font); font-size: 14px; font-weight: 500;
      color: var(--rbw-muted); cursor: pointer;
      border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all .15s;
    }
    .rbw-tab.on { color: var(--rbw-purple); border-bottom-color: var(--rbw-purple); font-weight: 700; }

    /* Form */
    .rbw-fgrp { margin-bottom: 13px; }
    .rbw-frow { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .rbw-flbl { display: block; font-size: 11px; font-weight: 700; color: var(--rbw-muted); margin-bottom: 5px; text-transform: uppercase; letter-spacing: .05em; }
    .rbw-input {
      width: 100%; padding: 11px 13px;
      border: 2px solid var(--rbw-border); border-radius: 8px;
      font-family: var(--rbw-font); font-size: 15px; color: var(--rbw-text);
      background: var(--rbw-panel); transition: border-color .15s; box-sizing: border-box;
    }
    .rbw-input:focus { outline: none; border-color: var(--rbw-purple); }

    /* Order summary */
    .rbw-summary { background: var(--rbw-panel); border: 1px solid var(--rbw-border); border-radius: var(--rbw-radius); overflow: hidden; margin-bottom: 20px; }
    .rbw-sum-hdr { background: var(--rbw-purple); color: #fff; padding: 13px 16px; font-weight: 700; font-size: 14px; }
    .rbw-sum-row { display: flex; justify-content: space-between; padding: 11px 16px; border-bottom: 1px solid var(--rbw-border); font-size: 14px; }
    .rbw-sum-row:last-child { border-bottom: none; }
    .rbw-sum-row.total { font-weight: 700; font-size: 16px; }
    .rbw-sum-lbl { color: var(--rbw-muted); }

    /* Confirmation */
    .rbw-check-icon { width: 72px; height: 72px; border-radius: 50%; background: var(--rbw-primary-lt); display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
    .rbw-check-icon svg { width: 36px; height: 36px; color: var(--rbw-primary-dk); }
    .rbw-conf-title { text-align: center; font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    .rbw-conf-sub { text-align: center; font-size: 14px; color: var(--rbw-muted); margin-bottom: 24px; }
    .rbw-conf-card { background: var(--rbw-panel); border: 1px solid var(--rbw-border); border-radius: var(--rbw-radius); overflow: hidden; margin-bottom: 20px; }
    .rbw-conf-row { display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border-bottom: 1px solid var(--rbw-border); font-size: 14px; }
    .rbw-conf-row:last-child { border-bottom: none; }
    .rbw-conf-ico { color: var(--rbw-purple); flex-shrink: 0; padding-top: 1px; }
    .rbw-conf-ico svg { width: 16px; height: 16px; }
    .rbw-conf-txt strong { display: block; font-weight: 600; margin-bottom: 2px; }
    .rbw-conf-txt span { color: var(--rbw-muted); }

    /* Upsell cards */
    .rbw-upsell-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
    .rbw-upsell-card {
      background: var(--rbw-panel); border: 2px solid var(--rbw-border);
      border-radius: var(--rbw-radius); padding: 14px 16px;
      display: flex; align-items: center; gap: 14px;
      transition: border-color .18s;
    }
    .rbw-upsell-card.on { border-color: var(--rbw-primary); background: var(--rbw-primary-lt); }
    .rbw-upsell-info { flex: 1; min-width: 0; }
    .rbw-upsell-name { font-size: 14px; font-weight: 600; margin-bottom: 2px; color: var(--rbw-text); }
    .rbw-upsell-desc { font-size: 12px; color: var(--rbw-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rbw-upsell-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .rbw-upsell-price { font-size: 15px; font-weight: 700; color: var(--rbw-purple); }
    .rbw-upsell-toggle {
      width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--rbw-border);
      background: var(--rbw-panel); cursor: pointer; display: flex; align-items: center;
      justify-content: center; transition: all .18s; flex-shrink: 0; font-size: 18px;
      color: var(--rbw-muted);
    }
    .rbw-upsell-card.on .rbw-upsell-toggle {
      background: var(--rbw-primary); border-color: var(--rbw-primary); color: #fff;
    }
    .rbw-upsell-total {
      background: var(--rbw-purple-lt); border: 1px solid rgba(65,47,131,.15);
      border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;
      display: flex; justify-content: space-between; align-items: center; font-size: 14px;
    }
    .rbw-upsell-total span:last-child { font-weight: 700; color: var(--rbw-purple); font-size: 16px; }

    /* Alert */
    .rbw-alert { padding: 11px 13px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
    .rbw-err { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; }

    /* Divider */
    .rbw-divider { display: flex; align-items: center; gap: 10px; margin: 12px 0; color: var(--rbw-muted); font-size: 13px; }
    .rbw-divider::before, .rbw-divider::after { content: ''; flex: 1; height: 1px; background: var(--rbw-border); }

    /* Spinner */
    .rbw-spin-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 56px 20px; gap: 14px; color: var(--rbw-muted); font-size: 14px; }
    .rbw-spinner { width: 34px; height: 34px; border: 3px solid var(--rbw-border); border-top-color: var(--rbw-primary); border-radius: 50%; animation: rbw-spin .7s linear infinite; }
    @keyframes rbw-spin { to { transform: rotate(360deg); } }

    /* Floating trigger */
    #rbw-float {
      position: fixed; bottom: 28px; right: 28px; z-index: 99997;
      background: var(--rbw-primary); color: #fff; border: none;
      border-radius: 50px; padding: 14px 24px;
      font-family: var(--rbw-font); font-size: 15px; font-weight: 600;
      cursor: pointer; display: flex; align-items: center; gap: 8px;
      box-shadow: 0 4px 20px rgba(243,156,68,.45);
      transition: all .2s;
    }
    #rbw-float:hover { transform: translateY(-2px); box-shadow: 0 6px 28px rgba(243,156,68,.55); }
    #rbw-float svg { width: 18px; height: 18px; }

    /* Payment method cards */
    .rbw-pm-card {
      background: var(--rbw-panel); border: 2px solid var(--rbw-border);
      border-radius: var(--rbw-radius); padding: 14px 16px;
      display: flex; align-items: center; justify-content: space-between;
      cursor: pointer; transition: all .18s; margin-bottom: 10px;
    }
    .rbw-pm-card:hover { border-color: var(--rbw-purple); }
    .rbw-pm-card.on { border-color: var(--rbw-purple); background: var(--rbw-purple-lt); }
    .rbw-pm-info { display: flex; align-items: center; gap: 12px; }
    .rbw-pm-icon { font-size: 22px; line-height: 1; }
    .rbw-pm-name { font-size: 14px; font-weight: 600; color: var(--rbw-text); }
    .rbw-pm-detail { font-size: 12px; color: var(--rbw-muted); margin-top: 1px; }
    .rbw-pm-check { color: var(--rbw-purple); font-weight: 700; font-size: 16px; flex-shrink: 0; }
    .rbw-pm-empty {
      border: 2px dashed var(--rbw-border); border-radius: var(--rbw-radius);
      padding: 20px 16px; text-align: center; margin-bottom: 16px;
    }
    .rbw-pm-empty p { font-size: 13px; color: var(--rbw-muted); margin: 0 0 12px; }

    /* Category cards (step 0) */
    .rbw-cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 24px; }
    .rbw-cat-card { border: 2px solid var(--rbw-border); border-radius: 14px; padding: 36px 16px; cursor: pointer; text-align: center; transition: all .2s; background: var(--rbw-panel); }
    .rbw-cat-card:hover { border-color: var(--rbw-primary); transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.07); }
    .rbw-cat-card.on { border-color: var(--rbw-primary); background: var(--rbw-primary-lt); }
    .rbw-cat-icon { font-size: 40px; margin-bottom: 12px; line-height: 1; }
    .rbw-cat-label { font-size: 17px; font-weight: 700; }
    .rbw-cat-desc { font-size: 12px; color: var(--rbw-muted); margin-top: 4px; }

    /* Appointment summary bar */
    .rbw-appt-summary {
      background: var(--rbw-purple-lt); border: 1px solid rgba(65,47,131,.15);
      border-radius: 10px; padding: 12px 14px; margin-bottom: 20px;
    }
    .rbw-appt-row {
      display: flex; justify-content: space-between; align-items: baseline;
      font-size: 13px; padding: 3px 0; gap: 8px;
    }
    .rbw-appt-row span:first-child { color: var(--rbw-muted); flex: 1; }
    .rbw-appt-row span:last-child { font-weight: 600; white-space: nowrap; }
    .rbw-appt-row.rbw-appt-total {
      border-top: 1px solid rgba(65,47,131,.2); margin-top: 8px; padding-top: 8px;
      font-weight: 700;
    }
    .rbw-appt-row.rbw-appt-total span { color: var(--rbw-purple); font-size: 14px; }

    @media (max-width: 480px) {
      #rbw-panel {
        width: 100vw;
        top: 0; left: 0; right: 0; bottom: 0;
        height: 100vh;
        height: 100dvh;
        border-radius: 0;
        max-width: 100vw;
      }
      #rbw-body { padding-bottom: 200px; }
    }
  `;

  // ─── SVG Icons ─────────────────────────────────────────────────────────────
  const I = {
    back:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`,
    cal:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    user:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    pin:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    spa:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M12 22s8-6 8-12a8 8 0 0 0-16 0c0 6 8 12 8 12z"/><path d="M12 14a4 4 0 0 0 4-4"/><path d="M12 14a4 4 0 0 1-4-4"/></svg>`,
    plus:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function fmt(n) { return '$' + Number(n).toFixed(0); }

  function fmtDate(d) {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function fmtMonth(d) {
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  function initials(first, last) {
    return ((first || '')[0] + (last || '')[0]).toUpperCase();
  }

  function buildAvatar(name, photoUrl, cssClass) {
    const el = document.createElement('div');
    el.className = cssClass;
    if (photoUrl) {
      const img = document.createElement('img');
      img.src = photoUrl;
      img.alt = name || '';
      el.appendChild(img);
    } else {
      el.textContent = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    }
    return el;
  }

  // ─── Panel control ─────────────────────────────────────────────────────────
  function openPanel() {
    state = freshState();
    const overlay = document.getElementById('rbw-overlay');
    const panel   = document.getElementById('rbw-panel');
    overlay.style.display = 'block';
    requestAnimationFrame(() => {
      overlay.classList.add('rbw-show');
      panel.classList.add('rbw-open');
    });
    document.body.style.overflow = 'hidden';
    goTo(S.CATEGORY);
  }

  function closePanel() {
    document.getElementById('rbw-overlay').classList.remove('rbw-show');
    document.getElementById('rbw-panel').classList.remove('rbw-open');
    document.body.style.overflow = '';
    setTimeout(() => { document.getElementById('rbw-overlay').style.display = 'none'; }, 350);
  }

  function goBack() {
    const target = BACK_TO[state.step];
    if (target) goTo(target);
  }

  function goTo(step) {
    state.step = step;

    const backBtn = document.getElementById('rbw-back-btn');
    if (backBtn) backBtn.style.visibility = BACK_TO[step] ? 'visible' : 'hidden';

    const prog = document.getElementById('rbw-prog-fill');
    if (prog) prog.style.width = (PROGRESS[step] || 0) + '%';

    const body = document.getElementById('rbw-body');
    if (body) { body.scrollTop = 0; body.innerHTML = ''; }

    render(step);
  }

  // ─── Router ────────────────────────────────────────────────────────────────
  function render(step) {
    switch (step) {
      case S.CATEGORY:     renderCategory();      break;
      case S.DURATION:     renderDuration();      break;
      case S.ADDONS:       renderAddons();        break;
      case S.THERAPIST:    renderTherapist();     break;
      case S.CALENDAR:     renderCalendar();      break;
      case S.REVIEW:       renderReview();        break;
      case S.AUTH:         renderAuth();          break;
      case S.CHECKOUT:     renderCheckout();      break;
      case S.CONFIRMATION: renderConfirmation();  break;
    }
  }

  // ─── Step 0: Category ────────────────────────────────────────────────────
  function renderCategory() {
    const body = document.getElementById('rbw-body');
    body.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'rbw-title';
    title.textContent = 'Welcome to Revive Bodywork';
    body.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'rbw-subtitle';
    sub.textContent = 'What type of session are you booking?';
    body.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'rbw-cat-grid';

    [
      { key: 'massage',      emoji: '🫴', label: 'Massage',      desc: 'Relaxation, deep tissue & more' },
      { key: 'acupuncture',  emoji: '🌿', label: 'Acupuncture',  desc: 'Traditional needle therapy' },
    ].forEach(({ key, emoji, label, desc }) => {
      const card = document.createElement('div');
      card.className = 'rbw-cat-card' + (state.category === key ? ' on' : '');
      card.innerHTML = `
        <div class="rbw-cat-icon">${emoji}</div>
        <div class="rbw-cat-label">${label}</div>
        <div class="rbw-cat-desc">${desc}</div>
      `;
      card.onclick = () => {
        if (state.category !== key) {
          state.category = key;
          state.duration = null;
          state.board = null;
          state.service = null;
          state.selectedAddons = [];
          state._staffCache = null;
        }
        goTo(S.DURATION);
      };
      grid.appendChild(card);
    });

    body.appendChild(grid);
  }

  // ─── Step 1: Duration + Service (combined) ────────────────────────────────
  function renderDuration() {
    const body = document.getElementById('rbw-body');
    const isAcu = state.category === 'acupuncture';
    body.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'rbw-title';
    title.textContent = isAcu ? 'Choose your service' : 'Book your session';
    body.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'rbw-subtitle';
    sub.textContent = isAcu
      ? 'Select an acupuncture appointment'
      : 'Choose a length, then pick your service';
    body.appendChild(sub);

    if (!isAcu) {
      const durLbl = document.createElement('div');
      durLbl.className = 'rbw-lbl';
      durLbl.textContent = 'Session Length';
      body.appendChild(durLbl);

      const grid = document.createElement('div');
      grid.className = 'rbw-dur-grid';
      grid.style.marginBottom = '24px';

      [
        { minutes: 30,  label: '30 min' },
        { minutes: 60,  label: '60 min' },
        { minutes: 90,  label: '90 min' },
        { minutes: 120, label: '120 min' },
      ].forEach(({ minutes, label }) => {
        const card = document.createElement('div');
        card.className = 'rbw-dur-card' + (state.duration === minutes ? ' on' : '');
        const timeEl = document.createElement('div');
        timeEl.className = 'rbw-dur-time';
        timeEl.textContent = label;
        const priceEl = document.createElement('div');
        priceEl.className = 'rbw-dur-price';
        priceEl.textContent = fmt(PRICES[minutes]);
        card.appendChild(timeEl);
        card.appendChild(priceEl);
        card.onclick = () => {
          const changed = state.duration !== minutes;
          state.duration = minutes;
          if (changed) {
            state.board = null;
            state.service = null;
            state.selectedAddons = [];
            state._staffCache = null;
          }
          grid.querySelectorAll('.rbw-dur-card').forEach(c => c.classList.remove('on'));
          card.classList.add('on');
          loadServices();
        };
        grid.appendChild(card);
      });

      body.appendChild(grid);
    }

    const svcSection = document.createElement('div');
    svcSection.id = 'rbw-svc-section';
    body.appendChild(svcSection);

    if (state.duration || isAcu) loadServices();
  }

  async function loadServices() {
    const section = document.getElementById('rbw-svc-section');
    if (!section) return;

    const isAcu = state.category === 'acupuncture';

    const lbl = document.createElement('div');
    lbl.className = 'rbw-lbl';
    lbl.textContent = isAcu ? 'Available Services' : 'Service Type';

    const grid = document.createElement('div');
    grid.className = 'rbw-type-grid';
    grid.innerHTML = `<div class="rbw-spin-wrap" style="padding:24px 0;grid-column:1/-1;"><div class="rbw-spinner"></div><span>Loading…</span></div>`;

    section.innerHTML = '';
    section.appendChild(lbl);
    section.appendChild(grid);

    try {
      if (!state._boardsCache) {
        state._boardsCache = await authGet('/boards');
      }

      // Build one tile per board (not per service).
      // For massage, only include boards that offer the selected duration.
      // For acupuncture, include all acupuncture boards and pick their first service.
      const matchingBoards = [];
      state._boardsCache.forEach(board => {
        const isAcuBoard = board.name.toLowerCase().includes('acupuncture');
        if (isAcu !== isAcuBoard) return;
        const svc = isAcu
          ? board.services[0]
          : board.services.find(s => s.minDurationInMinutes === state.duration);
        if (!svc) return;
        matchingBoards.push({ board, svc });
      });

      grid.innerHTML = '';
      if (!matchingBoards.length) {
        const msg = isAcu
          ? 'No acupuncture services available.'
          : `No services available for ${state.duration} minutes.`;
        grid.innerHTML = `<p style="color:var(--rbw-muted);font-size:14px;text-align:center;padding:20px 0;grid-column:1/-1;">${msg}</p>`;
        return;
      }

      matchingBoards.forEach(({ board, svc }) => {
        const isOn = state.board?.id === board.id;
        const card = document.createElement('div');
        card.className = 'rbw-type-card' + (isOn ? ' on' : '');
        // Board names are clean — no duration prefix to strip
        const desc = svc.description || '';
        card.innerHTML = `
          <div class="rbw-type-name">${board.name}</div>
          ${desc ? `<div class="rbw-type-desc">${desc}</div>` : ''}
        `;
        card.onclick = () => {
          state.board          = { id: board.id, name: board.name };
          state.service        = svc;
          state.selectedAddons = [];
          state._staffCache    = null;
          if (isAcu) state.duration = svc.minDurationInMinutes;
          goTo(S.ADDONS);
        };
        grid.appendChild(card);
      });
    } catch {
      grid.innerHTML = `<p style="color:var(--rbw-muted);font-size:14px;text-align:center;padding:20px 0;grid-column:1/-1;">Couldn't load services. Please try again.</p>`;
    }
  }

  // ─── Appointment summary bar ───────────────────────────────────────────────
  function buildSummaryBar() {
    if (!state.service) return null;

    const basePrice   = parseFloat(state.service.priceInCurrency);
    const addonsPrice = state.selectedAddons.reduce((a, b) => a + b.priceInCurrency, 0);
    const addonsTime  = state.selectedAddons.reduce((a, b) => a + (b.durationInMinutes || 0), 0);
    const totalPrice  = basePrice + addonsPrice;
    const totalTime   = (state.duration || 0) + addonsTime;

    const bar = document.createElement('div');
    bar.className = 'rbw-appt-summary';

    const makeRow = (label, value, cls = '') => {
      const row = document.createElement('div');
      row.className = 'rbw-appt-row' + (cls ? ' ' + cls : '');
      row.innerHTML = `<span>${label}</span><span>${value}</span>`;
      return row;
    };

    bar.appendChild(makeRow(state.service.name, `${state.duration} min · ${fmt(basePrice)}`));

    state.selectedAddons.forEach(a => {
      const timeStr = a.durationInMinutes ? ` +${a.durationInMinutes} min` : '';
      bar.appendChild(makeRow(`+ ${a.name}`, `${timeStr} · +${fmt(a.priceInCurrency)}`));
    });

    if (state.selectedAddons.length > 0) {
      bar.appendChild(makeRow('Total', `${totalTime} min · ${fmt(totalPrice)}`, 'rbw-appt-total'));
    }

    return bar;
  }

  // ─── Step 2: Add-ons ─────────────────────────────────────────────────────
  function renderAddons() {
    const addons = state.service?.addons || [];
    if (!addons.length) { goTo(S.CALENDAR); return; }

    const body = document.getElementById('rbw-body');
    body.innerHTML = `
      <h2 class="rbw-title">Enhance your session</h2>
      <p class="rbw-subtitle">Add any of these to your ${state.service.name}</p>
      <div id="rbw-summary-bar"></div>
      <div id="rbw-addon-list" class="rbw-upsell-list"></div>
      <div class="rbw-upsell-total" id="rbw-addon-total" style="display:none">
        <span>Add-ons total</span><span id="rbw-addon-total-val"></span>
      </div>
      <div class="rbw-footer">
        <button class="rbw-btn rbw-btn-primary" id="rbw-addon-cta">Continue</button>
        <button class="rbw-btn rbw-btn-ghost" id="rbw-addon-skip" style="margin-top:8px;">Skip</button>
      </div>
    `;

    document.getElementById('rbw-addon-cta').onclick  = () => goTo(S.CALENDAR);
    document.getElementById('rbw-addon-skip').onclick = () => { state.selectedAddons = []; goTo(S.CALENDAR); };

    const list = document.getElementById('rbw-addon-list');
    addons.forEach(addon => {
      const isOn = state.selectedAddons.some(a => a.id === addon.id);
      const card = document.createElement('div');
      card.className = 'rbw-upsell-card' + (isOn ? ' on' : '');
      card.innerHTML = `
        <div class="rbw-upsell-info">
          <div class="rbw-upsell-name">${addon.name}</div>
          ${addon.description ? `<div class="rbw-upsell-desc">${addon.description}</div>` : ''}
        </div>
        <div class="rbw-upsell-right">
          <div class="rbw-upsell-price">+${fmt(addon.priceInCurrency)}</div>
          <button class="rbw-upsell-toggle" aria-label="Add ${addon.name}">${isOn ? '✓' : '+'}</button>
        </div>
      `;
      card.onclick = () => {
        const idx = state.selectedAddons.findIndex(a => a.id === addon.id);
        if (idx >= 0) state.selectedAddons.splice(idx, 1);
        else state.selectedAddons.push({ id: addon.id, name: addon.name, priceInCurrency: addon.priceInCurrency, durationInMinutes: addon.durationInMinutes || 0 });
        updateAddonTotal();
        const nowOn = state.selectedAddons.some(a => a.id === addon.id);
        card.classList.toggle('on', nowOn);
        card.querySelector('.rbw-upsell-toggle').textContent = nowOn ? '✓' : '+';
      };
      list.appendChild(card);
    });

    updateAddonTotal();
  }

  function updateAddonTotal() {
    const totalEl = document.getElementById('rbw-addon-total');
    const valEl   = document.getElementById('rbw-addon-total-val');
    const ctaEl   = document.getElementById('rbw-addon-cta');
    if (!totalEl) return;
    const sum = state.selectedAddons.reduce((acc, a) => acc + a.priceInCurrency, 0);
    if (sum > 0) {
      totalEl.style.display = 'flex';
      valEl.textContent = fmt(sum);
      ctaEl.textContent = `Add ${state.selectedAddons.length} item${state.selectedAddons.length > 1 ? 's' : ''} & Continue`;
    } else {
      totalEl.style.display = 'none';
      ctaEl.textContent = 'Continue';
    }
    const barEl = document.getElementById('rbw-summary-bar');
    if (barEl) {
      barEl.innerHTML = '';
      const bar = buildSummaryBar();
      if (bar) barEl.appendChild(bar);
    }
  }

  // ─── Step 3: Therapist ────────────────────────────────────────────────────
  async function renderTherapist() {
    const body = document.getElementById('rbw-body');
    body.innerHTML = `
      <h2 class="rbw-title">Choose your therapist</h2>
      <p class="rbw-subtitle">${state.service?.name || 'Session'} · ${state.duration} min</p>
      <div id="rbw-staff-list" class="rbw-tx-list">
        <div class="rbw-spin-wrap"><div class="rbw-spinner"></div><span>Loading therapists…</span></div>
      </div>
    `;
    const sb = buildSummaryBar();
    if (sb) body.insertBefore(sb, body.querySelector('#rbw-staff-list'));

    try {
      if (!state._staffCache) {
        state._staffCache = await authGet(`/boards/${state.board.id}/staff?serviceId=${state.service.appointmentServiceId}`);
      }
      const staff = state._staffCache;
      const list  = document.getElementById('rbw-staff-list');
      list.innerHTML = '';

      // "Any Available" option
      const anyCard = document.createElement('div');
      anyCard.className = 'rbw-tx-card' + (!state.staffId ? ' on' : '');
      const anyAvatar = buildAvatar('Any', null, 'rbw-tx-avatar');
      const anyInfo = document.createElement('div');
      anyInfo.style.flex = '1';
      anyInfo.innerHTML = `<div class="rbw-tx-name">Any Available Therapist</div><div class="rbw-tx-spec">Best match for your time</div>`;
      const anyCheck = document.createElement('div');
      anyCheck.innerHTML = I.check;
      anyCheck.style.cssText = 'flex-shrink:0;color:' + (!state.staffId ? 'var(--rbw-purple)' : 'var(--rbw-border)') + ';';
      anyCard.appendChild(anyAvatar);
      anyCard.appendChild(anyInfo);
      anyCard.appendChild(anyCheck);
      anyCard.onclick = () => { state.staffId = null; state.staffName = null; goTo(S.CALENDAR); };
      list.appendChild(anyCard);

      staff.forEach(member => {
        const isOn = state.staffId === member.teacherId;
        const card = document.createElement('div');
        card.className = 'rbw-tx-card' + (isOn ? ' on' : '');
        const avatar = buildAvatar(member.name, member.photo, 'rbw-tx-avatar');
        const info = document.createElement('div');
        info.style.flex = '1';
        const nm = document.createElement('div'); nm.className = 'rbw-tx-name'; nm.textContent = member.name;
        const sp = document.createElement('div'); sp.className = 'rbw-tx-spec'; sp.textContent = 'Licensed Massage Therapist';
        info.appendChild(nm); info.appendChild(sp);
        const checkEl = document.createElement('div');
        checkEl.innerHTML = I.check;
        checkEl.style.cssText = 'flex-shrink:0;color:' + (isOn ? 'var(--rbw-purple)' : 'var(--rbw-border)') + ';';
        card.appendChild(avatar); card.appendChild(info); card.appendChild(checkEl);
        card.onclick = () => { state.staffId = member.teacherId; state.staffName = member.name; goTo(S.CALENDAR); };
        list.appendChild(card);
      });
    } catch {
      const list = document.getElementById('rbw-staff-list');
      if (list) list.innerHTML = `<p style="color:var(--rbw-muted);font-size:14px;text-align:center;padding:20px 0;">Couldn't load therapists. Please try again.</p>`;
    }
  }

  // ─── Step 4: Calendar + Therapist (combined) ─────────────────────────────
  function renderCalendar() {
    const body = document.getElementById('rbw-body');

    if (!state.selectedDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      state.selectedDate = today;
    }

    body.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'rbw-title';
    title.textContent = 'Choose your time';
    body.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'rbw-subtitle';
    sub.textContent = `${state.service?.name || 'Session'} · ${state.duration} min · ${fmt(state.service?.priceInCurrency || 0)}`;
    body.appendChild(sub);

    const sb = buildSummaryBar();
    if (sb) body.appendChild(sb);

    // Therapist dropdown — filtered to staff who can perform the selected service AND all add-ons
    const txLbl = document.createElement('div');
    txLbl.className = 'rbw-lbl';
    txLbl.textContent = 'Therapist';
    body.appendChild(txLbl);

    const txSelect = document.createElement('select');
    txSelect.className = 'rbw-input';
    txSelect.style.marginBottom = '18px';
    txSelect.disabled = true;
    const anyOpt = document.createElement('option');
    anyOpt.value = '';
    anyOpt.textContent = 'Any Available Therapist';
    txSelect.appendChild(anyOpt);
    body.appendChild(txSelect);

    // Build filtered staff list: intersect base service staff with each add-on's staff
    const baseServiceId = state.service.appointmentServiceId;
    const addonServiceIds = (state.selectedAddons || []).map(a => a.id).filter(Boolean);

    const staffRequests = [
      authGet(`/boards/${state.board.id}/staff?serviceId=${baseServiceId}`),
      ...addonServiceIds.map(id => authGet(`/boards/${state.board.id}/staff?serviceId=${id}`))
    ];

    Promise.all(staffRequests)
      .then(results => {
        // Intersect: only keep therapists who appear in every result set
        const [baseStaff, ...addonStaffs] = results;
        const validIds = addonStaffs.reduce((ids, addonStaff) => {
          const addonIds = new Set(addonStaff.map(m => m.teacherId));
          return ids.filter(id => addonIds.has(id));
        }, baseStaff.map(m => m.teacherId));

        const filteredStaff = baseStaff.filter(m => validIds.includes(m.teacherId));
        state._staffCache = filteredStaff;

        txSelect.disabled = false;
        filteredStaff.forEach(member => {
          const opt = document.createElement('option');
          opt.value = String(member.teacherId);
          opt.textContent = member.name;
          txSelect.appendChild(opt);
        });

        // If only one therapist can do this service, auto-select them
        if (filteredStaff.length === 1) {
          txSelect.value = String(filteredStaff[0].teacherId);
          state.staffId   = filteredStaff[0].teacherId;
          state.staffName = filteredStaff[0].name;
        } else {
          txSelect.value = state.staffId ? String(state.staffId) : '';
        }

        findFirstAvailable();
      })
      .catch(() => {
        txSelect.disabled = false;
        state._staffCache = [];
        findFirstAvailable();
      });

    txSelect.onchange = () => {
      const val = txSelect.value;
      state.staffId   = val ? Number(val) : null;
      state.staffName = val ? txSelect.options[txSelect.selectedIndex].text : null;
      state.selectedSlot = null;
      loadAvailability(state.selectedDate);
    };

    const calMount = document.createElement('div');
    calMount.id = 'rbw-cal-mount';
    body.appendChild(calMount);

    const availSection = document.createElement('div');
    availSection.id = 'rbw-avail-section';
    body.appendChild(availSection);

    const footer = document.createElement('div');
    footer.className = 'rbw-footer';
    const cta = document.createElement('button');
    cta.className = 'rbw-btn rbw-btn-primary';
    cta.id = 'rbw-cal-cta';
    cta.disabled = true;
    cta.textContent = 'Continue';
    cta.onclick = () => goTo(S.REVIEW);
    footer.appendChild(cta);
    body.appendChild(footer);

    calMount.appendChild(buildCalendar());
    // Availability loads after staff resolves (inside the Promise.all above)
  }

  // Scans forward up to 14 days to find the first date with open slots, then loads it.
  async function findFirstAvailable() {
    const section = document.getElementById('rbw-avail-section');
    if (!section) return;
    section.innerHTML = `<div class="rbw-spin-wrap"><div class="rbw-spinner"></div><span>Finding first available…</span></div>`;

    const boardId   = state.board?.id;
    const serviceId = state.service?.appointmentServiceId;
    if (!boardId || !serviceId) {
      section.innerHTML = `<p style="color:var(--rbw-muted);font-size:14px;text-align:center;padding:20px 0;">Missing service info. Please go back.</p>`;
      return;
    }

    const p2 = n => String(n).padStart(2, '0');
    const fmtD = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

    const start = new Date(state.selectedDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(start); end.setDate(end.getDate() + 14);

    let qs = `/boards/${boardId}/available-times?serviceId=${serviceId}&from=${fmtD(start)}&to=${fmtD(end)}`;
    if (state.staffId) qs += `&staffId=${state.staffId}`;

    try {
      const data = await authGet(qs);
      const raw  = Array.isArray(data) ? data.flat() : [];
      const open = raw.filter(s => !s.isTaken && !s.isCutOff && s.isAvailableForSelectedStaffIds !== false);

      if (!open.length) {
        // Nothing in the next 14 days — show message
        section.innerHTML = '';
        const noAvail = document.createElement('div');
        noAvail.className = 'rbw-no-avail';
        const p = document.createElement('p');
        p.textContent = 'No availability in the next two weeks. Please check back soon.';
        noAvail.appendChild(p);
        section.appendChild(noAvail);
        updateCalCta();
        return;
      }

      // Jump to the date of the first open slot
      const firstSlotDate = new Date(open[0].value);
      firstSlotDate.setHours(0, 0, 0, 0);
      state.selectedDate = firstSlotDate;
      rebuildCalendarSelection();

      // Filter all open slots to just that day and render
      const dayStr = fmtD(firstSlotDate);
      const daySlots = open.filter(s => s.value.startsWith(dayStr));
      renderAvailability(daySlots, section);
    } catch {
      section.innerHTML = `<p style="color:var(--rbw-muted);font-size:14px;text-align:center;padding:20px 0;">Couldn't load availability. Please try again.</p>`;
    }
  }

  async function loadAvailability(date) {
    const section = document.getElementById('rbw-avail-section');
    if (!section) return;

    section.innerHTML = `<div class="rbw-spin-wrap"><div class="rbw-spinner"></div><span>Finding availability…</span></div>`;

    const p2 = n => String(n).padStart(2, '0');
    const dateStr = `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;
    const nextDay = new Date(date); nextDay.setDate(nextDay.getDate() + 1);
    const toStr   = `${nextDay.getFullYear()}-${p2(nextDay.getMonth() + 1)}-${p2(nextDay.getDate())}`;

    const boardId   = state.board?.id;
    const serviceId = state.service?.appointmentServiceId;
    if (!boardId || !serviceId) {
      section.innerHTML = `<p style="color:var(--rbw-muted);font-size:14px;text-align:center;padding:20px 0;">Missing service info. Please go back.</p>`;
      return;
    }

    let qs = `/boards/${boardId}/available-times?serviceId=${serviceId}&from=${dateStr}&to=${toStr}`;
    if (state.staffId) qs += `&staffId=${state.staffId}`;

    try {
      const data  = await authGet(qs);
      const raw   = Array.isArray(data) ? data.flat() : [];
      const slots = raw.filter(s => !s.isTaken && !s.isCutOff && s.isAvailableForSelectedStaffIds !== false);
      renderAvailability(slots, section);
    } catch {
      section.innerHTML = `<p style="color:var(--rbw-muted);font-size:14px;text-align:center;padding:20px 0;">Couldn't load availability. Please try again.</p>`;
    }
  }

  // Shared renderer: takes raw API slot objects, converts to local time, and paints the section.
  function renderAvailability(slots, section) {
    const localSlots = slots.map(s => {
      const d    = new Date(s.value);
      const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      // Resolve therapist name from cache or selected state
      const therapistName = resolveTherapistName(s.teacherId);
      return { isoValue: s.value, time, minuteOffset: d.getHours() * 60 + d.getMinutes(), teacherId: s.teacherId, therapistName };
    });

    section.innerHTML = '';

    if (!localSlots.length) {
      const noAvail = document.createElement('div');
      noAvail.className = 'rbw-no-avail';
      const p = document.createElement('p');
      p.textContent = 'No availability on this date.';
      const btn = document.createElement('button');
      btn.className = 'rbw-btn rbw-btn-outline btn-sm';
      btn.textContent = 'Find Next Available →';
      btn.onclick = () => {
        const next = new Date(state.selectedDate);
        next.setDate(next.getDate() + 1);
        state.selectedDate = next;
        state.selectedSlot = null;
        rebuildCalendarSelection();
        findFirstAvailable();
      };
      noAvail.appendChild(p);
      noAvail.appendChild(btn);
      section.appendChild(noAvail);
      updateCalCta();
      return;
    }

    section.appendChild(renderFirstAvail(localSlots[0]));

    const orDiv = document.createElement('div');
    orDiv.className = 'rbw-or';
    orDiv.textContent = 'or choose a different time';
    section.appendChild(orDiv);

    const pickerMount = document.createElement('div');
    section.appendChild(pickerMount);
    renderTimePicker(localSlots, pickerMount);
    updateCalCta();
  }

  function resolveTherapistName(teacherId) {
    if (!teacherId) return null;
    // Prefer the filtered staff cache built in renderCalendar
    const cached = (state._staffCache || []).find(m => m.teacherId === teacherId);
    if (cached) return cached.name;
    // Fall back to explicitly selected therapist
    if (state.staffId && state.staffId === teacherId) return state.staffName;
    return null;
  }

  function renderFirstAvail(slot) {
    const card = document.createElement('div');
    card.className = 'rbw-first-avail';
    const therapistLine = slot.therapistName
      ? `<div class="rbw-first-avail-therapist">with ${slot.therapistName}</div>`
      : '';
    card.innerHTML = `
      <div class="rbw-first-avail-label">⚡ First Availability</div>
      <div class="rbw-first-avail-time">${slot.time}</div>
      <div class="rbw-first-avail-date">${fmtDate(state.selectedDate)}</div>
      ${therapistLine}
      <button class="rbw-first-avail-btn" id="rbw-book-first">Book This Time →</button>
    `;
    card.querySelector('#rbw-book-first').onclick = () => {
      state.selectedSlot = slot;
      goTo(S.REVIEW);
    };
    return card;
  }

  // Time chip picker — therapist was selected in the prior step.
  function renderTimePicker(slots, container) {
    const seenOffsets = new Set();
    const uniqueSlots = [];
    slots.forEach(s => {
      if (!seenOffsets.has(s.minuteOffset)) {
        seenOffsets.add(s.minuteOffset);
        uniqueSlots.push(s);
      }
    });
    if (!uniqueSlots.length) return;

    // Default to first slot if no valid selection exists
    if (!state.selectedSlot || !seenOffsets.has(state.selectedSlot.minuteOffset)) {
      state.selectedSlot = uniqueSlots[0];
      updateCalCta();
    }

    const timeLbl = document.createElement('div');
    timeLbl.className = 'rbw-lbl';
    timeLbl.textContent = 'Available Times';
    container.appendChild(timeLbl);

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'rbw-time-chips';
    container.appendChild(chipsWrap);

    uniqueSlots.forEach(slot => {
      const chip = document.createElement('button');
      chip.className = 'rbw-time-chip' + (state.selectedSlot?.minuteOffset === slot.minuteOffset ? ' on' : '');
      chip.textContent = slot.time;
      chip.onclick = () => {
        state.selectedSlot = slot;
        chipsWrap.querySelectorAll('.rbw-time-chip').forEach(c => c.classList.remove('on'));
        chip.classList.add('on');
        updateCalCta();
      };
      chipsWrap.appendChild(chip);
    });
  }

  function buildCalendar() {
    let viewDate = new Date(
      (state.selectedDate || new Date()).getFullYear(),
      (state.selectedDate || new Date()).getMonth(),
      1
    );
    const wrapper = document.createElement('div');

    function draw() {
      wrapper.innerHTML = '';
      const cal = document.createElement('div');
      cal.className = 'rbw-cal';

      const hdr = document.createElement('div');
      hdr.className = 'rbw-cal-hdr';
      const prev = document.createElement('button');
      prev.className = 'rbw-cal-nav'; prev.innerHTML = '‹';
      prev.onclick = () => { viewDate.setMonth(viewDate.getMonth() - 1); draw(); };
      const title = document.createElement('h3');
      title.textContent = fmtMonth(viewDate);
      const next = document.createElement('button');
      next.className = 'rbw-cal-nav'; next.innerHTML = '›';
      next.onclick = () => { viewDate.setMonth(viewDate.getMonth() + 1); draw(); };
      hdr.append(prev, title, next);
      cal.appendChild(hdr);

      const grid = document.createElement('div');
      grid.className = 'rbw-cal-grid';
      ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(d => {
        const dow = document.createElement('div');
        dow.className = 'rbw-cal-dow'; dow.textContent = d;
        grid.appendChild(dow);
      });

      const today    = new Date(); today.setHours(0, 0, 0, 0);
      const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
      const days     = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();

      for (let i = 0; i < firstDay; i++) {
        const w = document.createElement('div'); w.className = 'rbw-cal-wrap';
        w.appendChild(Object.assign(document.createElement('div'), { className: 'rbw-cal-day empty' }));
        grid.appendChild(w);
      }
      for (let d = 1; d <= days; d++) {
        const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d);
        const isPast   = date < today;
        const isToday  = date.toDateString() === today.toDateString();
        const isPicked = state.selectedDate && date.toDateString() === state.selectedDate.toDateString();
        const w = document.createElement('div'); w.className = 'rbw-cal-wrap';
        const dayEl = document.createElement('div');
        dayEl.className = 'rbw-cal-day' + (isPast ? ' past' : '') + (isToday ? ' today' : '') + (isPicked ? ' picked' : '');
        dayEl.textContent = d;
        if (!isPast) {
          dayEl.onclick = () => {
            state.selectedDate = new Date(date);
            state.selectedSlot = null;
            draw();
            loadAvailability(state.selectedDate);
          };
        }
        w.appendChild(dayEl);
        grid.appendChild(w);
      }
      cal.appendChild(grid);
      wrapper.appendChild(cal);
    }

    draw();
    return wrapper;
  }

  function rebuildCalendarSelection() {
    const mount = document.getElementById('rbw-cal-mount');
    if (!mount) return;
    mount.innerHTML = '';
    mount.appendChild(buildCalendar());
  }

  function updateCalCta() {
    const cta = document.getElementById('rbw-cal-cta');
    if (cta) cta.disabled = !state.selectedSlot;
  }

  // ─── Step 6: Auth ──────────────────────────────────────────────────────────
  function renderAuth() {
    const mode = state.authMode;
    const body = document.getElementById('rbw-body');

    body.innerHTML = `
      <h2 class="rbw-title">${mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
      <p class="rbw-subtitle">${mode === 'login' ? 'Sign in to complete your booking' : 'Quick and free — no birthday required'}</p>
      <div class="rbw-tabs">
        <button class="rbw-tab ${mode === 'login' ? 'on' : ''}" id="rbw-tab-login">Sign In</button>
        <button class="rbw-tab ${mode === 'register' ? 'on' : ''}" id="rbw-tab-reg">Create Account</button>
      </div>
      <form id="rbw-auth-form"></form>
    `;

    document.getElementById('rbw-tab-login').onclick = () => { state.authMode = 'login'; renderAuth(); };
    document.getElementById('rbw-tab-reg').onclick   = () => { state.authMode = 'register'; renderAuth(); };

    const form = document.getElementById('rbw-auth-form');

    if (mode === 'register') {
      form.innerHTML += `
        <div class="rbw-frow">
          <div class="rbw-fgrp"><label class="rbw-flbl">First Name</label><input class="rbw-input" name="firstName" type="text" placeholder="First name" required></div>
          <div class="rbw-fgrp"><label class="rbw-flbl">Last Name</label><input class="rbw-input" name="lastName" type="text" placeholder="Last name" required></div>
        </div>
      `;
    }

    form.innerHTML += `
      <div class="rbw-fgrp"><label class="rbw-flbl">Email</label><input class="rbw-input" name="email" type="email" placeholder="you@email.com" required></div>
      <div class="rbw-fgrp"><label class="rbw-flbl">Password</label><input class="rbw-input" name="password" type="password" placeholder="${mode === 'register' ? 'Create a password' : 'Your password'}" required></div>
      <div id="rbw-auth-err"></div>
      <div class="rbw-footer">
        <button type="submit" class="rbw-btn rbw-btn-primary">${mode === 'login' ? 'Sign In' : 'Create Account'}</button>
      </div>
    `;

    form.onsubmit = async (e) => {
      e.preventDefault();
      const data   = Object.fromEntries(new FormData(form));
      const errDiv = document.getElementById('rbw-auth-err');
      const btn    = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = mode === 'login' ? 'Signing in…' : 'Creating account…';
      errDiv.innerHTML = '';

      try {
        const path = mode === 'login' ? '/auth/login' : '/auth/register';
        const res  = await proxyPost(path, data);
        state.token = res.accessToken;
        await onAuthSuccess();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = mode === 'login' ? 'Sign In' : 'Create Account';
        errDiv.innerHTML = `<div class="rbw-alert rbw-err">${err.message}</div>`;
      }
    };
  }

  // After a successful login or register, pre-fetch member data in parallel
  // so the checkout step can render immediately without a second loading screen.
  async function onAuthSuccess() {
    const [pmRes, mbRes, profileRes] = await Promise.allSettled([
      authGet('/payment-methods'),
      authGet('/memberships/active'),
      authGet('/member/profile'),
    ]);

    if (pmRes.status === 'fulfilled') {
      const d = pmRes.value;
      state.savedPaymentMethods = d?.paymentMethods || d?.data || (Array.isArray(d) ? d : []);
    }
    if (mbRes.status === 'fulfilled') {
      const d = mbRes.value;
      state.activeMemberships = d?.boughtMemberships || d?.content || d?.data || (Array.isArray(d) ? d : []);
    }
    if (profileRes.status === 'fulfilled') {
      state.memberProfile = profileRes.value;
    }

    // Auto-select the first saved card if available
    if (state.savedPaymentMethods.length > 0 && !state.selectedPmId) {
      state.selectedPmId = state.savedPaymentMethods[0].id;
    }

    goTo(S.CHECKOUT);
  }

  // ─── Step 5: Review ──────────────────────────────────────────────────────
  function renderReview() {
    const body = document.getElementById('rbw-body');
    const basePrice   = state.service ? parseFloat(state.service.priceInCurrency) : 0;
    const addonsTotal = state.selectedAddons.reduce((acc, a) => acc + a.priceInCurrency, 0);
    const subtotal    = basePrice + addonsTotal;
    const effectiveTotal = state.promoCode ? state.promoCode.final : subtotal;

    body.innerHTML = '';

    const title = document.createElement('h2');
    title.className = 'rbw-title';
    title.textContent = 'Review your booking';
    body.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'rbw-subtitle';
    sub.textContent = 'Confirm the details below';
    body.appendChild(sub);

    // ── Summary card ────────────────────────────────────────────────────────
    const summary = document.createElement('div');
    summary.className = 'rbw-summary';

    function makeRow(label, value) {
      const row = document.createElement('div');
      row.className = 'rbw-sum-row';
      const lbl = document.createElement('span');
      lbl.className = 'rbw-sum-lbl';
      lbl.textContent = label;
      const val = document.createElement('span');
      val.textContent = value;
      row.appendChild(lbl);
      row.appendChild(val);
      return row;
    }

    const hdr = document.createElement('div');
    hdr.className = 'rbw-sum-hdr';
    hdr.textContent = 'Booking Summary';
    summary.appendChild(hdr);

    summary.appendChild(makeRow('Service', state.service?.name || 'Session'));
    summary.appendChild(makeRow('Duration', state.duration + ' min'));

    if (state.staffName) {
      summary.appendChild(makeRow('Therapist', state.staffName));
    } else {
      summary.appendChild(makeRow('Therapist', 'Any Available'));
    }

    const dateTimeStr = state.selectedDate
      ? fmtDate(state.selectedDate) + ' at ' + (state.selectedSlot?.time || '—')
      : '—';
    summary.appendChild(makeRow('Date & Time', dateTimeStr));
    summary.appendChild(makeRow('Session', fmt(basePrice)));

    state.selectedAddons.forEach(a => {
      summary.appendChild(makeRow('+ ' + a.name, fmt(a.priceInCurrency)));
    });

    // Total row — shows strikethrough + discounted if promo applied
    const totalRow = document.createElement('div');
    totalRow.className = 'rbw-sum-row total';
    totalRow.id = 'rbw-total-row';
    const totalLbl = document.createElement('span');
    totalLbl.className = 'rbw-sum-lbl';
    totalLbl.textContent = 'Total';
    totalRow.appendChild(totalLbl);
    const totalVal = document.createElement('span');
    totalVal.id = 'rbw-total-val';
    if (state.promoCode) {
      totalVal.innerHTML = `<span style="text-decoration:line-through;color:var(--rbw-muted);font-weight:400;margin-right:8px;">${fmt(subtotal)}</span><span style="color:#16a34a;">${fmt(state.promoCode.final)}</span>`;
    } else {
      totalVal.textContent = fmt(subtotal);
    }
    totalRow.appendChild(totalVal);
    summary.appendChild(totalRow);

    body.appendChild(summary);

    // ── Footer (promo section + auth/continue buttons) ──────────────────────
    // Promo lives inside the footer so it's always visible above the action buttons
    // regardless of body scroll position.
    const footer = document.createElement('div');
    footer.className = 'rbw-footer';
    footer.id = 'rbw-review-footer';
    footer.appendChild(buildPromoSection(subtotal, effectiveTotal));
    body.appendChild(footer);

    if (state.token) {
      const btn = document.createElement('button');
      btn.className = 'rbw-btn rbw-btn-primary';
      btn.textContent = 'Proceed to Payment';
      btn.onclick = async () => {
        // Ensure payment methods are loaded when skipping auth (return visit)
        if (!state.savedPaymentMethods.length && !state.activeMemberships.length) {
          btn.disabled = true;
          btn.textContent = 'Loading…';
          await onAuthSuccess().catch(() => {});
        } else {
          goTo(S.CHECKOUT);
        }
      };
      footer.appendChild(btn);
    } else {
      const login = document.createElement('button');
      login.className = 'rbw-btn rbw-btn-primary';
      login.textContent = 'Sign In to Continue';
      login.onclick = () => { state.authMode = 'login'; goTo(S.AUTH); };
      footer.appendChild(login);

      const divider = document.createElement('div');
      divider.className = 'rbw-divider';
      divider.textContent = 'or';
      footer.appendChild(divider);

      const create = document.createElement('button');
      create.className = 'rbw-btn rbw-btn-outline';
      create.textContent = 'Create Free Account';
      create.onclick = () => { state.authMode = 'register'; goTo(S.AUTH); };
      footer.appendChild(create);
    }
  }

  // Builds the collapsible discount code section for the review step.
  // Rendered inside the sticky footer above the action buttons.
  function buildPromoSection(subtotal, currentEffectiveTotal) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--rbw-border);';

    // Show applied badge if a code is active
    if (state.promoCode) {
      const badge = document.createElement('div');
      badge.style.cssText = 'background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:10px 14px;display:flex;align-items:center;justify-content:space-between;font-size:13px;margin-bottom:8px;';
      const badgeText = document.createElement('span');
      badgeText.style.color = '#16a34a';
      badgeText.innerHTML = `✓ Code <strong>${state.promoCode.code}</strong> applied — saving ${fmt(state.promoCode.discount)}`;
      const removeBtn = document.createElement('button');
      removeBtn.style.cssText = 'background:none;border:none;color:var(--rbw-muted);cursor:pointer;font-size:12px;font-family:var(--rbw-font);';
      removeBtn.textContent = 'Remove';
      removeBtn.onclick = () => {
        state.promoCode = null;
        // Re-render the review step to reflect removal
        renderReview();
      };
      badge.appendChild(badgeText);
      badge.appendChild(removeBtn);
      wrap.appendChild(badge);
      return wrap;
    }

    // Collapsible "Have a discount code?" toggle
    const toggle = document.createElement('button');
    toggle.style.cssText = 'background:none;border:none;color:var(--rbw-purple);font-family:var(--rbw-font);font-size:13px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline;margin-bottom:10px;';
    toggle.textContent = 'Have a discount code?';

    const promoBody = document.createElement('div');
    promoBody.style.display = 'none';

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:8px;';

    const codeInput = document.createElement('input');
    codeInput.className = 'rbw-input';
    codeInput.type = 'text';
    codeInput.placeholder = 'Enter code';
    codeInput.style.flex = '1';
    codeInput.style.textTransform = 'uppercase';
    if (state._promoInputVal) codeInput.value = state._promoInputVal;

    const applyBtn = document.createElement('button');
    applyBtn.className = 'rbw-btn rbw-btn-outline';
    applyBtn.style.cssText = 'display:inline-block;width:auto;padding:9px 18px;font-size:14px;';
    applyBtn.textContent = 'Apply';

    const errEl = document.createElement('div');
    errEl.style.marginTop = '6px';

    applyBtn.onclick = async () => {
      const code = codeInput.value.trim();
      if (!code) return;
      state._promoInputVal = code;
      applyBtn.disabled = true;
      applyBtn.textContent = '…';
      errEl.innerHTML = '';
      try {
        const result = await proxyPost('/promo/validate', { code, subtotal });
        state.promoCode = { code: result.code, discount: result.discount, final: result.final };
        state._promoInputVal = null;
        // Re-render review to reflect applied code
        renderReview();
      } catch (err) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply';
        errEl.innerHTML = `<div class="rbw-alert rbw-err">${err.message}</div>`;
      }
    };

    inputRow.appendChild(codeInput);
    inputRow.appendChild(applyBtn);
    promoBody.appendChild(inputRow);
    promoBody.appendChild(errEl);

    toggle.onclick = () => {
      const isOpen = promoBody.style.display === 'none';
      promoBody.style.display = isOpen ? 'block' : 'none';
      if (isOpen) codeInput.focus();
    };

    wrap.appendChild(toggle);
    wrap.appendChild(promoBody);
    return wrap;
  }

  // ─── Step 7: Checkout ──────────────────────────────────────────────────────
  // Loads payment methods and memberships (already pre-fetched in onAuthSuccess,
  // but re-fetches here to catch the case where user navigates back and forward).
  async function renderCheckout() {
    const body        = document.getElementById('rbw-body');
    const basePrice   = state.service ? parseFloat(state.service.priceInCurrency) : 0;
    const addonsTotal = state.selectedAddons.reduce((acc, a) => acc + a.priceInCurrency, 0);
    const subtotal    = basePrice + addonsTotal;
    const grandTotal  = state.promoCode ? state.promoCode.final : subtotal;

    body.innerHTML = `
      <h2 class="rbw-title">Confirm & Pay</h2>
      <p class="rbw-subtitle">${fmt(grandTotal)} due today · encrypted & secure</p>
      <div id="rbw-checkout-content">
        <div class="rbw-spin-wrap"><div class="rbw-spinner"></div><span>Loading payment info…</span></div>
      </div>
      <div class="rbw-footer">
        <button class="rbw-btn rbw-btn-primary" id="rbw-confirm-btn" disabled>
          Confirm Booking · ${fmt(grandTotal)}
        </button>
        <div id="rbw-checkout-err" style="margin-top:8px;"></div>
      </div>
    `;

    // Fetch payment methods and memberships; skip if already loaded from onAuthSuccess.
    if (!state.savedPaymentMethods.length && !state.activeMemberships.length) try {
      const [pmRes, mbRes] = await Promise.allSettled([
        authGet('/payment-methods'),
        authGet('/memberships/active'),
      ]);
      if (pmRes.status === 'fulfilled') {
        const d = pmRes.value;
        state.savedPaymentMethods = d?.paymentMethods || d?.data || (Array.isArray(d) ? d : []);
      }
      if (mbRes.status === 'fulfilled') {
        const d = mbRes.value;
        state.activeMemberships = d?.boughtMemberships || d?.content || d?.data || (Array.isArray(d) ? d : []);
      }
    } catch { /* use whatever was pre-fetched */ }

    // Auto-select first saved card if nothing is selected yet
    if (!state.selectedPmId && !state.selectedMbId && state.savedPaymentMethods.length > 0) {
      state.selectedPmId = state.savedPaymentMethods[0].id;
    }

    renderCheckoutContent(grandTotal);
  }

  function renderCheckoutContent(grandTotal) {
    const content    = document.getElementById('rbw-checkout-content');
    const confirmBtn = document.getElementById('rbw-confirm-btn');
    if (!content) return;

    content.innerHTML = '';

    // ── Membership credits section ──────────────────────────────────────────
    // Filter to memberships that likely have usable credits (field names vary by account).
    const usableMbs = state.activeMemberships.filter(mb =>
      (mb.creditsRemaining ?? mb.credits ?? mb.remainingCredits ?? 1) > 0
    );

    if (usableMbs.length > 0) {
      const section = document.createElement('div');
      section.innerHTML = '<div class="rbw-lbl">Apply Membership Credits</div>';

      usableMbs.forEach(mb => {
        const isOn   = state.selectedMbId === mb.id;
        const credits = mb.creditsRemaining ?? mb.credits ?? mb.remainingCredits ?? '?';
        const card   = document.createElement('div');
        card.className = 'rbw-pm-card' + (isOn ? ' on' : '');
        card.innerHTML = `
          <div class="rbw-pm-info">
            <div class="rbw-pm-icon">🎟</div>
            <div>
              <div class="rbw-pm-name">${mb.name || mb.membershipName || 'Membership'}</div>
              <div class="rbw-pm-detail">${credits} session${credits !== 1 ? 's' : ''} remaining</div>
            </div>
          </div>
          ${isOn ? '<div class="rbw-pm-check">✓</div>' : ''}
        `;
        card.onclick = () => {
          state.selectedMbId = mb.id;
          state.selectedPmId = null;
          renderCheckoutContent(grandTotal);
        };
        section.appendChild(card);
      });

      content.appendChild(section);

      // Divider before card section
      const divEl = document.createElement('div');
      divEl.className = 'rbw-lbl';
      divEl.style.marginTop = '14px';
      divEl.textContent = 'Or pay by card';
      content.appendChild(divEl);
    } else {
      const lbl = document.createElement('div');
      lbl.className = 'rbw-lbl';
      lbl.textContent = 'Payment Method';
      content.appendChild(lbl);
    }

    // ── Saved card section ──────────────────────────────────────────────────
    if (state.savedPaymentMethods.length > 0) {
      state.savedPaymentMethods.forEach(pm => {
        const isOn  = state.selectedPmId === pm.id;
        const brand = (pm.brand || pm.cardBrand || pm.type || 'Card').toUpperCase();
        const last4 = pm.last4 || pm.lastFour || '····';
        const exp   = pm.expMonth && pm.expYear
          ? ` · Exp ${String(pm.expMonth).padStart(2,'0')}/${String(pm.expYear).slice(-2)}`
          : '';
        const card  = document.createElement('div');
        card.className = 'rbw-pm-card' + (isOn ? ' on' : '');
        card.innerHTML = `
          <div class="rbw-pm-info">
            <div class="rbw-pm-icon">💳</div>
            <div>
              <div class="rbw-pm-name">${brand} ···${last4}</div>
              <div class="rbw-pm-detail">Saved card${exp}</div>
            </div>
          </div>
          ${isOn ? '<div class="rbw-pm-check">✓</div>' : ''}
        `;
        card.onclick = () => {
          state.selectedPmId = pm.id;
          state.selectedMbId = null;
          renderCheckoutContent(grandTotal);
        };
        content.appendChild(card);
      });
    } else {
      // No card on file — prompt to add one via Momence-hosted flow
      const emptyEl = document.createElement('div');
      emptyEl.className = 'rbw-pm-empty';
      emptyEl.innerHTML = `<p>No saved payment method on file.</p>`;
      const addBtn = document.createElement('button');
      addBtn.className = 'rbw-btn rbw-btn-outline btn-sm';
      addBtn.style.display = 'inline-block';
      addBtn.textContent = '+ Add a Card';
      addBtn.onclick = () => openAddCardPopup(grandTotal);
      emptyEl.appendChild(addBtn);
      content.appendChild(emptyEl);
    }

    // Enable confirm button only when a payment method is chosen
    const canProceed = !!(state.selectedPmId || state.selectedMbId);
    confirmBtn.disabled = !canProceed;
    confirmBtn.onclick = canProceed ? () => submitCheckout(grandTotal) : null;
  }

  // Opens the Momence-hosted add-card page in a popup.
  // Polls for a new saved payment method every 2 s; re-renders once found.
  async function openAddCardPopup(grandTotal) {
    const errDiv = document.getElementById('rbw-checkout-err');
    if (errDiv) errDiv.innerHTML = '';

    try {
      const data = await proxyPost('/payment-methods/setup', {});
      // Response shape may vary — look for the URL in common field names
      const url  = data?.url || data?.redirectUrl || data?.manageUrl;
      if (!url || typeof url !== 'string') {
        throw new Error('Could not retrieve payment setup URL. Please contact us to add a card.');
      }

      const popup = window.open(url, 'rbw-add-card', 'width=580,height=720,scrollbars=yes,resizable=yes');

      let pollInterval;
      let popupWatcher;

      const cleanup = () => { clearInterval(pollInterval); clearInterval(popupWatcher); };

      // Poll every 2 s while popup is open
      pollInterval = setInterval(async () => {
        try {
          const d       = await authGet('/payment-methods');
          const methods = d?.paymentMethods || d?.data || (Array.isArray(d) ? d : []);
          if (methods.length > 0) {
            cleanup();
            state.savedPaymentMethods = methods;
            state.selectedPmId = methods[0].id;
            state.selectedMbId = null;
            if (popup && !popup.closed) popup.close();
            renderCheckoutContent(grandTotal);
          }
        } catch { /* keep polling */ }
      }, 2000);

      // Watch for popup close and do a final check
      popupWatcher = setInterval(() => {
        if (!popup || popup.closed) {
          cleanup();
          setTimeout(async () => {
            try {
              const d       = await authGet('/payment-methods');
              const methods = d?.paymentMethods || d?.data || (Array.isArray(d) ? d : []);
              state.savedPaymentMethods = methods;
              if (methods.length > 0) {
                state.selectedPmId = methods[0].id;
                state.selectedMbId = null;
              }
            } catch { /* use existing state */ }
            renderCheckoutContent(grandTotal);
          }, 600);
        }
      }, 1000);
    } catch (err) {
      if (errDiv) errDiv.innerHTML = `<div class="rbw-alert rbw-err">${err.message}</div>`;
    }
  }

  // Submits the booking to Momence via the backend proxy.
  async function submitCheckout(grandTotal) {
    const btn    = document.getElementById('rbw-confirm-btn');
    const errDiv = document.getElementById('rbw-checkout-err');
    if (btn)    { btn.disabled = true; btn.textContent = 'Processing…'; }
    if (errDiv) errDiv.innerHTML = '';

    try {
      // Use the stored ISO value from the slot (already correct UTC time from Momence)
      const startsAt = state.selectedSlot?.isoValue || null;

      await proxyPost('/checkout', {
        duration:              state.duration,
        startsAt,
        therapistId:           state.staffId || null,
        appointmentServiceId:  state.service?.appointmentServiceId || undefined,
        addonIds:              state.selectedAddons.map(a => a.id),
        savedPaymentMethodId:  state.selectedPmId || undefined,
        boughtMembershipId:    state.selectedMbId || undefined,
      });
      goTo(S.CONFIRMATION);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = `Confirm Booking · ${fmt(grandTotal)}`; }
      if (errDiv) errDiv.innerHTML = `<div class="rbw-alert rbw-err">${err.message}</div>`;
    }
  }

  // ─── Step 8: Confirmation ──────────────────────────────────────────────────
  function renderConfirmation() {
    const body    = document.getElementById('rbw-body');
    const dateStr = state.selectedDate ? fmtDate(state.selectedDate) : '';
    const timeStr = state.selectedSlot?.time || '';
    const txName  = state.staffName || null;

    function gcalLink() {
      if (!state.selectedSlot?.isoValue) return '#';
      const start = new Date(state.selectedSlot.isoValue);
      const end   = new Date(start.getTime() + (state.duration || 60) * 60000);
      const f     = d => d.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z';
      return `https://calendar.google.com/calendar/render?action=TEMPLATE`
           + `&text=${encodeURIComponent('Revive Bodywork — ' + (state.service?.name || 'Session'))}`
           + `&dates=${f(start)}/${f(end)}`
           + `&details=${encodeURIComponent('Your massage at Revive Bodywork Denver.\n\nSee you soon!')}`
           + `&location=${encodeURIComponent('Revive Bodywork, Denver, CO')}`;
    }

    body.innerHTML = `
      <div class="rbw-check-icon">${I.check}</div>
      <h2 class="rbw-conf-title">You're all booked!</h2>
      <p class="rbw-conf-sub">A confirmation email is heading your way.</p>
      <div class="rbw-conf-card">
        <div class="rbw-conf-row">
          <div class="rbw-conf-ico">${I.spa}</div>
          <div class="rbw-conf-txt">
            <strong>${state.service?.name || 'Session'}</strong>
            <span>${state.duration} minute session</span>
          </div>
        </div>
        <div class="rbw-conf-row">
          <div class="rbw-conf-ico">${I.cal}</div>
          <div class="rbw-conf-txt">
            <strong>${dateStr}</strong>
            <span>${timeStr}</span>
          </div>
        </div>
        ${txName ? `
        <div class="rbw-conf-row">
          <div class="rbw-conf-ico">${I.user}</div>
          <div class="rbw-conf-txt">
            <strong>${txName}</strong>
            <span>Your therapist</span>
          </div>
        </div>` : ''}
        <div class="rbw-conf-row">
          <div class="rbw-conf-ico">${I.pin}</div>
          <div class="rbw-conf-txt">
            <strong>Revive Bodywork</strong>
            <span>Denver, CO · directions in your email</span>
          </div>
        </div>
      </div>
      <a href="${gcalLink()}" target="_blank" rel="noopener"
         style="display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;"
         class="rbw-btn rbw-btn-primary">
        ${I.cal}<span>Add to Calendar</span>
      </a>
      <button class="rbw-btn rbw-btn-ghost" onclick="window.RBWWidget.close()" style="margin-top:10px;">Done</button>
    `;
  }

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    // Inject CSS
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    // Build panel shell
    const overlay = document.createElement('div');
    overlay.id = 'rbw-overlay';
    overlay.onclick = closePanel;

    const panel = document.createElement('div');
    panel.id = 'rbw-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Book a massage at Revive Bodywork');
    panel.innerHTML = `
      <div class="rbw-hdr">
        <button class="rbw-icon-btn" id="rbw-back-btn" aria-label="Go back" style="visibility:hidden">${I.back}</button>
        <div class="rbw-hdr-brand">
          <b>Revive Bodywork</b>
          <small>Denver's Premier Self-Care</small>
        </div>
        <button class="rbw-icon-btn" id="rbw-close-btn" aria-label="Close">${I.close}</button>
      </div>
      <div class="rbw-prog"><div class="rbw-prog-fill" id="rbw-prog-fill" style="width:0%"></div></div>
      <div id="rbw-body"></div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    document.getElementById('rbw-close-btn').onclick = closePanel;
    document.getElementById('rbw-back-btn').onclick  = goBack;

    // Floating button
    if (FLOATING) {
      const btn = document.createElement('button');
      btn.id = 'rbw-float';
      btn.innerHTML = I.plus + '<span>Book Now</span>';
      btn.onclick = openPanel;
      document.body.appendChild(btn);
    }

    // Wire any [data-rbw-book] elements in DOM now
    function wire(el) {
      el.addEventListener('click', openPanel);
    }
    document.querySelectorAll('[data-rbw-book]').forEach(wire);

    // Watch for dynamically added triggers
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.hasAttribute?.('data-rbw-book')) wire(n);
      n.querySelectorAll?.('[data-rbw-book]').forEach(wire);
    }))).observe(document.body, { childList: true, subtree: true });

    // ESC to close
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });

    // Fetch config once on load — prices and hidden product IDs rarely change at runtime.
    authGet('/config').then(cfg => {
      if (cfg?.prices) Object.assign(PRICES, cfg.prices);
      if (Array.isArray(cfg?.hiddenProductIds)) {
        cfg.hiddenProductIds.forEach(id => HIDDEN_PRODUCT_IDS.add(id));
      }
    }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Public API
  window.RBWWidget = { open: openPanel, close: closePanel };
})();
