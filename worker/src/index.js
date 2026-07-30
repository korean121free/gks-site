/**
 * GKS 수업방 백엔드 (Cloudflare Worker)
 *
 *   POST /token          수업방 입장 토큰 발급 (LiveKit JWT)
 *   POST /log            끊김·품질 로그 적재 (D1)
 *   POST /session/start  수업 시작 기록
 *   POST /session/end    수업 종료 기록 (분·재접속·진도 메모)
 *   POST /me             선생님 방 한 번에 불러오기 (기록·매칭표·메시지·사진)
 *   POST /note           본부에 한마디 / 휴식 신청
 *   POST /photo          사진 올리기 (R2)
 *   GET  /photo/get?k=   사진 보기·내려받기 (무작위 파일 이름이 열쇠)
 *   POST /photo/delete   내 사진 지우기
 *   GET  /weekly         주간 현황 (?key=ADMIN_KEY)
 *   GET  /report         월간 리포트 (?key=ADMIN_KEY)
 *   GET  /notes          선생님 메시지 목록 (?key=ADMIN_KEY)
 *   POST /note/seen      메시지 확인 표시 (?key=ADMIN_KEY)
 *   GET  /stats          연결 품질 로그 (?key=ADMIN_KEY)
 *   GET  /health         살아있는지 확인
 *
 * 전화번호가 들어가는 요청은 모두 POST입니다 — 주소창·서버 기록에 남지 않게 하기 위해서.
 *
 * 비밀값은 코드에 넣지 않습니다 — wrangler secret 으로 넣습니다.
 * 자세한 배포 순서는 worker/README.md 참고.
 */

const TOKEN_TTL_SEC = 60 * 60 * 3;   // 수업 1회(50분)에 넉넉한 3시간

/* ---------------- 공통 ---------------- */

function corsHeaders(env, origin) {
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : (allowed[0] || ''),
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, env, origin, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, origin) }
  });
}

function isAllowed(env, origin) {
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  // Origin 헤더가 없는 요청(sendBeacon 등 일부 경우)은 로그 적재에만 허용합니다.
  return !origin || allowed.includes(origin);
}

/**
 * 방 이름·사람 이름에서 위험한 문자를 걸러냅니다.
 * 베트남어 이름(Nguyễn, Trần …)의 성조 문자가 살아남도록
 * 유니코드 글자(\p{L})를 통째로 허용합니다.
 */
function clean(s, max) {
  return String(s == null ? '' : s)
    .replace(/[^\p{L}\p{N}\-_ .]/gu, '')
    .trim()
    .slice(0, max || 64);
}

/* ---------------- LiveKit 토큰 (HS256 JWT) ---------------- */

function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function mintToken(env, { room, identity, name }) {
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: env.LIVEKIT_API_KEY,     // API 키가 발급자
    sub: identity,                // 참가자 고유 id
    name: name,                   // 화면에 보일 이름
    nbf: now - 10,
    exp: now + TOKEN_TTL_SEC,
    video: {
      room: room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    }
  };

  const data = b64url(enc.encode(JSON.stringify(header))) + '.' +
               b64url(enc.encode(JSON.stringify(payload)));

  const key = await crypto.subtle.importKey(
    'raw', enc.encode(env.LIVEKIT_API_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));

  return data + '.' + b64url(sig);
}

/* ---------------- 라우트 ---------------- */

async function handleToken(request, env, origin) {
  if (!isAllowed(env, origin) || !origin) {
    return json({ error: 'FORBIDDEN' }, env, origin, 403);
  }
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    return json({ error: 'NOT_CONFIGURED' }, env, origin, 500);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const room = clean(body.room, 64);
  const name = clean(body.name, 40) || '이름 없음';
  const role = body.role === 'teacher' ? 'teacher' : 'student';
  if (!room) return json({ error: 'NO_ROOM' }, env, origin, 400);

  // 같은 사람이 두 탭으로 들어오면 먼저 것이 밀려나도록 identity를 고정합니다.
  const identity = (role + '-' + (name || 'x')).replace(/\s+/g, '_').slice(0, 60);

  const token = await mintToken(env, { room, identity, name });
  return json({ token, url: env.LIVEKIT_URL || null, identity }, env, origin);
}

async function handleLog(request, env, origin, cf) {
  if (!isAllowed(env, origin)) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB) return json({ ok: false, error: 'NO_DB' }, env, origin, 200);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 60) : [];
  if (!rows.length) return json({ ok: true, saved: 0 }, env, origin);

  // 어느 나라에서 들어온 연결인지가 핵심 단서입니다 (베트남 vs 한국 구분)
  const country = (cf && cf.country) || '';
  const colo = (cf && cf.colo) || '';

  const stmt = env.DB.prepare(
    `INSERT INTO class_log
       (ts, room, identity, role, lang, event, quality, reconnects, duration_sec, country, colo, ua, detail)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );

  const batch = rows.map(r => stmt.bind(
    String(r.ts || new Date().toISOString()).slice(0, 32),
    clean(r.room, 64),
    clean(r.identity, 60),
    String(r.role || '').slice(0, 12),
    String(r.lang || '').slice(0, 4),
    String(r.event || '').slice(0, 32),
    String(r.quality || '').slice(0, 16),
    Number(r.reconnects) || 0,
    Number(r.duration_sec) || 0,
    country, colo,
    String(r.ua || '').slice(0, 180),
    String(r.detail || '').slice(0, 300)
  ));

  try {
    await env.DB.batch(batch);
    return json({ ok: true, saved: batch.length }, env, origin);
  } catch (e) {
    // 로그 적재 실패가 수업에 영향을 주면 안 됩니다 — 조용히 넘깁니다.
    return json({ ok: false, error: String(e).slice(0, 120) }, env, origin, 200);
  }
}

/* ---------------- 수업 기록 (사람이 보는 표) ---------------- */

/** 전화번호는 숫자만 남깁니다 — 개인 방의 열쇠입니다 */
function digits(s) { return String(s == null ? '' : s).replace(/\D/g, '').slice(0, 16); }

/**
 * 날짜는 반드시 한국 시간(UTC+9) 기준입니다.
 * Worker는 UTC로 도는데, 그대로 쓰면 새벽 수업(한국 00~09시)이
 * 전날로 기록되어 주간·월간 집계가 어긋납니다.
 */
function kstDay(ms) {
  return new Date((ms == null ? Date.now() : ms) + 9 * 3600 * 1000)
    .toISOString().slice(0, 10);
}

/** 그 날짜가 든 주의 월요일 (한국 기준) */
function weekStart(dayStr) {
  const d = new Date((dayStr || kstDay()) + 'T00:00:00Z');
  const dow = d.getUTCDay();                 // 0=일 … 6=토
  const back = (dow === 0 ? 6 : dow - 1);    // 월요일로 되돌리기
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
function addDays(dayStr, n) {
  const d = new Date(dayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function handleSessionStart(request, env, origin, cf) {
  if (!isAllowed(env, origin) || !origin) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB) return json({ ok: false, error: 'NO_DB' }, env, origin, 200);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const room = clean(b.room, 64);
  const me = digits(b.me);
  if (!room || !me) return json({ error: 'NO_KEY' }, env, origin, 400);

  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    `INSERT INTO session (room, day, me, me_name, role, partner, started_at, country)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    room,
    kstDay(),          /* 한국 시간 기준 날짜 */
    me,
    clean(b.name, 40),
    b.role === 'teacher' ? 'teacher' : 'student',
    clean(b.partner, 40),
    now,
    (cf && cf.country) || ''
  ).run();

  return json({ ok: true, sid: r.meta.last_row_id }, env, origin);
}

async function handleSessionEnd(request, env, origin) {
  if (!isAllowed(env, origin)) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB) return json({ ok: false, error: 'NO_DB' }, env, origin, 200);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const sid = Number(b.sid);
  if (!sid) return json({ error: 'NO_SID' }, env, origin, 400);

  // 메모는 나중에 따로 저장될 수 있으므로, 빈 값이 기존 메모를 지우지 않게 합니다.
  await env.DB.prepare(
    `UPDATE session
        SET ended_at = ?, minutes = ?, reconnects = ?, recorded = ?,
            memo = CASE WHEN ? = '' THEN memo ELSE ? END
      WHERE id = ?`
  ).bind(
    new Date().toISOString(),
    Math.max(0, Math.min(600, Number(b.minutes) || 0)),
    Math.max(0, Number(b.reconnects) || 0),
    b.recorded ? 1 : 0,
    String(b.memo || '').slice(0, 500),
    String(b.memo || '').slice(0, 500),
    sid
  ).run();

  return json({ ok: true }, env, origin);
}

/**
 * 개인 방(선생님 방) 한 번에 불러오기.
 *
 * GET이 아니라 POST입니다 — 전화번호가 주소창·서버 기록에 남지 않게 하기 위해서입니다.
 * 전화번호와 이름이 둘 다 맞아야 열립니다.
 * (2단계에서 portal.html의 GAS 로그인과 연결해 제대로 잠글 예정)
 */
async function handleMe(request, env, origin) {
  if (!isAllowed(env, origin) || !origin) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB) return json({ error: 'NO_DB' }, env, origin, 500);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const me = digits(b.me);
  const name = clean(b.name, 40);
  if (!me || !name) return json({ error: 'NO_KEY' }, env, origin, 400);

  const month = kstDay().slice(0, 7);
  const recent = addDays(kstDay(), -21);

  const [tot, mon, rows, pairs, notes, photos, paused, info, filing, pastFilings] =
    await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(minutes),0) mins, MAX(day) last_day, MIN(day) first_day
         FROM session WHERE me = ? AND me_name = ? AND minutes > 0`
    ).bind(me, name).first(),

    env.DB.prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(minutes),0) mins
         FROM session WHERE me = ? AND me_name = ? AND minutes > 0 AND day LIKE ?`
    ).bind(me, name, month + '%').first(),

    env.DB.prepare(
      `SELECT id, day, role, partner, started_at, minutes, reconnects, recorded, memo
         FROM session WHERE me = ? AND me_name = ?
        ORDER BY started_at DESC LIMIT 60`
    ).bind(me, name).all(),

    // 매칭표 — 지금까지 함께한 학생 전체 (짝별로 첫 수업·마지막 수업·횟수·시간)
    env.DB.prepare(
      `SELECT partner, COUNT(*) lessons, COALESCE(SUM(minutes),0) minutes,
              MIN(day) first_day, MAX(day) last_day
         FROM session
        WHERE me = ? AND me_name = ? AND minutes > 0 AND partner IS NOT NULL AND partner <> ''
        GROUP BY partner ORDER BY MAX(day) DESC`
    ).bind(me, name).all(),

    env.DB.prepare(
      `SELECT id, day, partner, kind, body, until, seen
         FROM note WHERE me = ? AND me_name = ? ORDER BY ts DESC LIMIT 20`
    ).bind(me, name).all(),

    env.DB.prepare(
      `SELECT id, day, taken_at, partner, kind, rkey, caption, bytes
         FROM photo WHERE me = ? AND me_name = ? ORDER BY COALESCE(taken_at, ts) DESC LIMIT 200`
    ).bind(me, name).all(),

    loadPaused(env),

    env.DB.prepare(`SELECT birth, portal_id FROM teacher WHERE me = ?`).bind(me).first(),

    // 이번 달 1365 신청을 눌렀는지
    env.DB.prepare(
      `SELECT ym, status, requested_at, submitted_at FROM filing WHERE me = ? AND ym = ?`
    ).bind(me, month).first(),

    // 지난 달 것도 보여 드립니다 (월말에 몰아서 누르시는 분이 많을 테니)
    env.DB.prepare(
      `SELECT ym, status FROM filing WHERE me = ? AND ym < ? ORDER BY ym DESC LIMIT 6`
    ).bind(me, month).all()
  ]);

  // 지금 가르치는 학생 = 최근 3주 안에 수업했거나, 쉬기로 알려 준 짝
  const pairRows = pairs.results.map(p => ({
    ...p,
    current: p.last_day >= recent
      || paused.keys.has(me + '|' + p.partner)
      || paused.keys.has(me + '|'),
    paused: paused.keys.has(me + '|' + p.partner) || paused.keys.has(me + '|')
  }));

  return json({
    ok: true,
    me_name: name,
    role: (rows.results[0] || {}).role || 'teacher',
    total: { count: tot.n, minutes: tot.mins, last_day: tot.last_day, first_day: tot.first_day },
    month: { ym: month, count: mon.n, minutes: mon.mins },
    rows: rows.results,
    pairs: pairRows,
    notes: notes.results,
    photos: photos.results,
    info: info || { birth: '', portal_id: '' },
    filing: filing || null,
    past_filings: pastFilings.results
  }, env, origin);
}

/* ---------------- 선생님이 본부에 남기는 말 ---------------- */

async function handleNoteAdd(request, env, origin) {
  if (!isAllowed(env, origin) || !origin) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB) return json({ ok: false, error: 'NO_DB' }, env, origin, 200);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const me = digits(b.me);
  const name = clean(b.name, 40);
  const body = String(b.body || '').trim().slice(0, 2000);
  const kind = ['message', 'pause', 'resume'].includes(b.kind) ? b.kind : 'message';
  if (!me || !name) return json({ error: 'NO_KEY' }, env, origin, 400);
  if (!body && kind === 'message') return json({ error: 'EMPTY' }, env, origin, 400);

  // 복귀 예정일은 날짜 형식만 받습니다 (최대 1년 뒤)
  let until = null;
  if (kind === 'pause') {
    const u = String(b.until || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(u) && u > kstDay() && u <= addDays(kstDay(), 365)) until = u;
  }

  await env.DB.prepare(
    `INSERT INTO note (ts, day, me, me_name, role, partner, kind, body, until)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    new Date().toISOString(), kstDay(), me, name,
    b.role === 'teacher' ? 'teacher' : 'student',
    clean(b.partner, 40), kind, body, until
  ).run();

  return json({ ok: true }, env, origin);
}

/* ---------------- 1365 신청 정보 (선생님이 한 번만 넣습니다) ---------------- */

async function handleTeacherSave(request, env, origin) {
  if (!isAllowed(env, origin) || !origin) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB) return json({ error: 'NO_DB' }, env, origin, 500);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const me = digits(b.me);
  const name = clean(b.name, 40);
  if (!me || !name) return json({ error: 'NO_KEY' }, env, origin, 400);

  // 1968.04.28 / 1968-04-28 / 19680428 모두 받아 양식과 같은 형태로 맞춥니다
  let birth = String(b.birth || '').replace(/[^\d]/g, '');
  birth = /^\d{8}$/.test(birth)
    ? birth.slice(0, 4) + '.' + birth.slice(4, 6) + '.' + birth.slice(6, 8)
    : '';

  await env.DB.prepare(
    `INSERT INTO teacher (me, me_name, birth, portal_id, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(me) DO UPDATE SET
       me_name = excluded.me_name,
       birth = excluded.birth,
       portal_id = excluded.portal_id,
       updated_at = excluded.updated_at`
  ).bind(me, name, birth, clean(b.portal_id, 40), new Date().toISOString()).run();

  return json({ ok: true, birth }, env, origin);
}

/* ---------------- 1365 신청 (선생님이 손드는 것) ---------------- */

async function handleFilingRequest(request, env, origin) {
  if (!isAllowed(env, origin) || !origin) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB) return json({ error: 'NO_DB' }, env, origin, 500);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const me = digits(b.me);
  const name = clean(b.name, 40);
  const ym = /^\d{4}-\d{2}$/.test(String(b.ym || '')) ? b.ym : kstDay().slice(0, 7);
  if (!me || !name) return json({ error: 'NO_KEY' }, env, origin, 400);

  if (b.cancel) {
    // 이미 본부가 보낸 것은 취소할 수 없습니다
    await env.DB.prepare(
      `DELETE FROM filing WHERE ym = ? AND me = ? AND status = 'requested'`
    ).bind(ym, me).run();
    return json({ ok: true, cancelled: true }, env, origin);
  }

  // 그 달에 수업이 없으면 신청할 것이 없습니다
  const has = await env.DB.prepare(
    `SELECT COUNT(*) n FROM session
      WHERE me = ? AND role='teacher' AND minutes > 0 AND day LIKE ?`
  ).bind(me, ym + '%').first();
  if (!has.n) return json({ ok: false, error: 'NO_LESSON' }, env, origin, 200);

  await env.DB.prepare(
    `INSERT INTO filing (ym, me, me_name, requested_at)
     VALUES (?,?,?,?)
     ON CONFLICT(ym, me) DO UPDATE SET me_name = excluded.me_name`
  ).bind(ym, me, name, new Date().toISOString()).run();

  return json({ ok: true, ym }, env, origin);
}

/** 본부가 성남시에 보냈다고 표시 */
async function handleFilingDone(request, url, env, origin) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'FORBIDDEN' }, env, origin, 403);
  }
  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }
  const ym = /^\d{4}-\d{2}$/.test(String(b.ym || '')) ? b.ym : null;
  if (!ym) return json({ error: 'NO_MONTH' }, env, origin, 400);

  await env.DB.prepare(
    `UPDATE filing SET status = 'submitted', submitted_at = ?
      WHERE ym = ? AND status = 'requested'`
  ).bind(new Date().toISOString(), ym).run();

  return json({ ok: true }, env, origin);
}

/**
 * 1365 취합 — 그 달 활동 내역을 양식 순서 그대로 뽑습니다.
 * 본부가 모아서 단체 이름으로 한 번에 보내는 구조라 관리자 전용입니다.
 *
 * 기본은 **신청한 선생님만** 나옵니다 (신청은 선택이니까).
 * ?all=1 을 붙이면 신청 안 한 분까지 봅니다.
 *
 * 양식 칸 순서: 연번 · 성명 · 생년월일 · 1365포털ID(혹은 연락처) ·
 *              활동일자 · 시작시간 · 마침시간 · 장소 · 활동내용
 */
async function handleForm1365(url, env, origin) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'FORBIDDEN' }, env, origin, 403);
  }
  if (!env.DB) return json({ error: 'NO_DB' }, env, origin, 500);

  const ym = (url.searchParams.get('month') || kstDay().slice(0, 7)).slice(0, 7);
  const showAll = url.searchParams.get('all') === '1';

  const [ses, infos, photos, reports, filings] = await Promise.all([
    env.DB.prepare(
      `SELECT me, me_name, partner, day, started_at, ended_at, minutes, memo
         FROM session
        WHERE role='teacher' AND minutes > 0 AND day LIKE ?
        ORDER BY me_name ASC, day ASC, started_at ASC`
    ).bind(ym + '%').all(),

    env.DB.prepare(`SELECT me, birth, portal_id FROM teacher`).all(),

    // 그 달 증빙 사진 — 선생님별로 몇 장 있는지 (없으면 챙기라고 알려 주기 위해)
    env.DB.prepare(
      `SELECT me, COUNT(*) n, MIN(rkey) rkey
         FROM photo WHERE kind='proof' AND day LIKE ? GROUP BY me`
    ).bind(ym + '%').all(),

    // 한글로 써 오신 보고서 — 엑셀과 겸용하는 동안 함께 챙깁니다
    env.DB.prepare(
      `SELECT me, rkey, caption FROM photo
        WHERE kind='report' AND day LIKE ? ORDER BY ts DESC`
    ).bind(ym + '%').all(),

    env.DB.prepare(
      `SELECT me, status, requested_at, submitted_at FROM filing WHERE ym = ?`
    ).bind(ym).all()
  ]);

  const infoMap = new Map(infos.results.map(r => [r.me, r]));
  const photoMap = new Map(photos.results.map(r => [r.me, r]));
  const fileMap = new Map(filings.results.map(r => [r.me, r]));
  const reportMap = new Map();
  for (const r of reports.results) {
    if (!reportMap.has(r.me)) reportMap.set(r.me, []);
    reportMap.get(r.me).push({ rkey: r.rkey, name: r.caption });
  }

  /* 한국 시간으로 HH:MM */
  const hhmm = (iso) => {
    if (!iso) return '';
    const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return isNaN(d) ? '' : d.toISOString().slice(11, 16);
  };

  const byTeacher = new Map();
  for (const s of ses.results) {
    if (!byTeacher.has(s.me)) {
      const info = infoMap.get(s.me) || {};
      const ph = photoMap.get(s.me);
      const fl = fileMap.get(s.me);
      byTeacher.set(s.me, {
        name: s.me_name,
        birth: info.birth || '',
        portal_id: info.portal_id || '',
        phone: s.me,                       // 포털ID가 없으면 연락처가 대신 쓰입니다
        requested: !!fl,
        status: fl ? fl.status : 'none',
        photo_count: ph ? ph.n : 0,
        photo_key: ph ? ph.rkey : null,
        reports: reportMap.get(s.me) || [],   // 한글로 써 오신 보고서
        lessons: 0,
        minutes: 0,
        rows: []
      });
    }
    const T = byTeacher.get(s.me);
    T.lessons++;
    T.minutes += s.minutes;
    T.rows.push({
      no: T.rows.length + 1,
      day: s.day,
      start: hhmm(s.started_at),
      end: hhmm(s.ended_at),
      place: '온라인',
      // 진도 메모가 그대로 '활동내용'이 됩니다
      content: (s.memo || '').trim() || '한국어 기초 회화 지도',
      student: s.partner || ''
    });
  }

  const all = [...byTeacher.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  // 신청은 선택입니다 — 기본은 손든 분들만 보냅니다
  const teachers = showAll ? all : all.filter(t => t.requested);

  return json({
    month: ym,
    org: '글로벌한국어나눔',
    writer: { title: '부대표', name: '김신경', phone: '010-6272-3291' },
    show_all: showAll,
    teachers,
    summary: {
      teachers: teachers.length,
      lessons: teachers.reduce((s, t) => s + t.lessons, 0),
      minutes: teachers.reduce((s, t) => s + t.minutes, 0),
      no_info: teachers.filter(t => !t.birth).length,
      no_photo: teachers.filter(t => !t.photo_count).length,
      taught: all.length,                                  // 그 달 수업한 선생님 전체
      not_requested: all.filter(t => !t.requested).length, // 아직 신청 안 한 분
      submitted: teachers.filter(t => t.status === 'submitted').length
    }
  }, env, origin);
}

/* ---------------- 사진 보관함 ---------------- */

const PHOTO_KINDS = ['proof', 'cert', 'profile', 'free', 'report'];
const PHOTO_MAX_BYTES = 6 * 1024 * 1024;   // 한 장 6MB까지

/**
 * kind='report' 는 선생님이 한글로 써 오시던 보고서입니다.
 * 엑셀로 바꾼 뒤에도 당분간 함께 받습니다 — 한글이 익숙한 분들을 위해서.
 * 확장자별로 R2에 그대로 담고, 취합할 때 ZIP에 함께 넣습니다.
 */
const REPORT_TYPES = {
  hwp:  'application/x-hwp',
  hwpx: 'application/hwp+zip',
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg:  'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp'
};

/** 아무도 맞출 수 없는 파일 이름 — 이 이름 자체가 열쇠입니다 */
function randKey() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

async function handlePhotoAdd(request, env, origin) {
  if (!isAllowed(env, origin) || !origin) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB || !env.PHOTOS) return json({ error: 'NO_STORE' }, env, origin, 500);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const me = digits(b.me);
  const name = clean(b.name, 40);
  const kind = PHOTO_KINDS.includes(b.kind) ? b.kind : 'free';
  if (!me || !name) return json({ error: 'NO_KEY' }, env, origin, 400);

  const raw = String(b.dataUrl || '');
  let ext, mime, b64;

  if (kind === 'report') {
    // 한글 보고서 등 — 파일 이름의 확장자로 종류를 정합니다
    const fx = String(b.filename || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/);
    ext = fx && REPORT_TYPES[fx[1]] ? fx[1] : null;
    if (!ext) return json({ error: 'BAD_TYPE' }, env, origin, 400);
    mime = REPORT_TYPES[ext];
    const m = raw.match(/^data:[^;]*;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return json({ error: 'BAD_FILE' }, env, origin, 400);
    b64 = m[1];
  } else {
    // 사진은 이미지만 받습니다
    const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return json({ error: 'BAD_IMAGE' }, env, origin, 400);
    mime = m[1];
    ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    b64 = m[2];
  }

  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (bin.byteLength > PHOTO_MAX_BYTES) return json({ error: 'TOO_BIG' }, env, origin, 413);

  const rkey = randKey() + '.' + ext;

  await env.PHOTOS.put(rkey, bin, {
    httpMetadata: { contentType: mime, cacheControl: 'private, max-age=31536000' }
  });

  const takenAt = /^\d{4}-\d{2}-\d{2}T/.test(String(b.taken_at || ''))
    ? String(b.taken_at).slice(0, 32) : new Date().toISOString();

  const r = await env.DB.prepare(
    `INSERT INTO photo (ts, day, taken_at, me, me_name, partner, kind, rkey, caption, bytes)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    new Date().toISOString(), kstDay(), takenAt, me, name,
    clean(b.partner, 40), kind, rkey,
    String(b.caption || '').slice(0, 300), bin.byteLength
  ).run();

  return json({ ok: true, id: r.meta.last_row_id, rkey }, env, origin);
}

/**
 * 사진 보기·내려받기.
 * 주소에는 무작위 파일 이름만 들어갑니다 — 전화번호나 이름은 넣지 않습니다.
 * ?dl=1 을 붙이면 내려받기가 됩니다.
 */
async function handlePhotoGet(url, env) {
  if (!env.PHOTOS) return new Response('not configured', { status: 500 });

  const k = String(url.searchParams.get('k') || '');
  if (!/^[a-z0-9]{8,32}\.(jpg|jpeg|png|webp|hwp|hwpx|pdf|docx|xlsx)$/.test(k)) {
    return new Response('bad key', { status: 400 });
  }

  const obj = await env.PHOTOS.get(k);
  if (!obj) return new Response('not found', { status: 404 });

  const h = new Headers();
  h.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
  h.set('Cache-Control', 'private, max-age=31536000');

  if (url.searchParams.get('dl')) {
    // 1365 제출 때 쓰시는 이름 규칙에 맞춥니다: 김경옥2026.07.07_Kethsi.png
    let fname = k;
    if (env.DB) {
      const row = await env.DB.prepare(
        `SELECT me_name, partner, taken_at, day, kind, caption FROM photo WHERE rkey = ?`
      ).bind(k).first();
      if (row) {
        const ext = k.split('.').pop();
        if (row.kind === 'report') {
          // 한글 보고서는 선생님이 붙인 이름을 그대로 살립니다
          fname = (row.me_name || '') + '-' + (row.caption || ('보고서.' + ext));
        } else {
          const d = (row.taken_at || row.day || '').slice(0, 10).replace(/-/g, '.');
          fname = (row.me_name || '') + d + (row.partner ? '_' + row.partner : '') + '.' + ext;
        }
      }
    }
    // 한글·베트남어가 들어가므로 filename* (RFC 5987) 로 함께 보냅니다
    h.set('Content-Disposition',
      'attachment; filename="' + k + '"; filename*=UTF-8\'\'' + encodeURIComponent(fname));
  }
  return new Response(obj.body, { headers: h });
}

async function handlePhotoDelete(request, env, origin) {
  if (!isAllowed(env, origin) || !origin) return json({ error: 'FORBIDDEN' }, env, origin, 403);
  if (!env.DB || !env.PHOTOS) return json({ error: 'NO_STORE' }, env, origin, 500);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }

  const me = digits(b.me);
  const name = clean(b.name, 40);
  const id = Number(b.id);
  if (!me || !name || !id) return json({ error: 'NO_KEY' }, env, origin, 400);

  // 자기 사진만 지울 수 있습니다
  const row = await env.DB.prepare(
    `SELECT rkey FROM photo WHERE id = ? AND me = ? AND me_name = ?`
  ).bind(id, me, name).first();
  if (!row) return json({ error: 'NOT_FOUND' }, env, origin, 404);

  await env.PHOTOS.delete(row.rkey);
  await env.DB.prepare(`DELETE FROM photo WHERE id = ?`).bind(id).run();

  return json({ ok: true }, env, origin);
}

/** 본부가 보는 목록 + 확인 표시 */
async function handleNotesAdmin(url, env, origin) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'FORBIDDEN' }, env, origin, 403);
  }
  if (!env.DB) return json({ error: 'NO_DB' }, env, origin, 500);

  const r = await env.DB.prepare(
    `SELECT id, ts, day, me_name, role, partner, kind, body, until, seen
       FROM note ORDER BY seen ASC, ts DESC LIMIT 100`
  ).all();

  return json({ ok: true, rows: r.results }, env, origin);
}

async function handleNoteSeen(request, url, env, origin) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'FORBIDDEN' }, env, origin, 403);
  }
  let b;
  try { b = await request.json(); } catch { return json({ error: 'BAD_JSON' }, env, origin, 400); }
  const id = Number(b.id);
  if (!id) return json({ error: 'NO_ID' }, env, origin, 400);

  await env.DB.prepare(`UPDATE note SET seen = 1 WHERE id = ?`).bind(id).run();
  return json({ ok: true }, env, origin);
}

/**
 * 지금 쉬고 있는 짝을 찾습니다.
 * pause/resume 중 가장 나중에 남긴 것이 pause이고, 복귀 예정일이 안 지났으면 '쉬는 중'.
 * 짝을 비워 두고 남긴 pause는 그 선생님의 모든 짝에 적용됩니다.
 */
async function loadPaused(env) {
  const today = kstDay();
  const r = await env.DB.prepare(
    `SELECT n.me, n.partner, n.me_name, n.kind, n.until, n.body, n.day
       FROM note n
      WHERE n.kind IN ('pause','resume')
        AND n.ts = (SELECT MAX(x.ts) FROM note x
                     WHERE x.me = n.me
                       AND IFNULL(x.partner,'') = IFNULL(n.partner,'')
                       AND x.kind IN ('pause','resume'))`
  ).all();

  const keys = new Set();   // "전화|짝" 또는 "전화|" (선생님 전체)
  const list = [];
  for (const n of r.results) {
    if (n.kind !== 'pause') continue;
    if (n.until && n.until < today) continue;          // 복귀 예정일이 지났으면 쉼 해제
    keys.add(n.me + '|' + (n.partner || ''));
    list.push({
      teacher: n.me_name, student: n.partner || '(전체)',
      until: n.until, since: n.day, body: n.body
    });
  }
  return { keys, list };
}

/**
 * 주간 현황 — 한 주(월~일) 동안 어느 짝이 수업했는지.
 *
 *   did      이번 주 수업한 짝 (요일별로 펼쳐서)
 *   missing  아는 짝인데 이번 주 기록이 없음  ← 주간 관리의 핵심
 *   stale    3주 넘게 수업이 없음 (더 급함)
 *
 * '아는 짝' = 최근 8주 안에 한 번이라도 수업한 짝.
 * (배정만 되고 첫 수업을 아직 안 한 짝은 시트에만 있어 여기 안 나옵니다)
 */
async function handleWeekly(url, env, origin) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'FORBIDDEN' }, env, origin, 403);
  }
  if (!env.DB) return json({ error: 'NO_DB' }, env, origin, 500);

  const start = weekStart(url.searchParams.get('week') || kstDay());
  const end = addDays(start, 6);
  const known = addDays(start, -56);   // 8주 전까지 거슬러 '아는 짝'을 모읍니다

  const [summary, lessons, knownPairs, paused, notes] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) lessons,
              COALESCE(SUM(minutes),0) minutes,
              COUNT(DISTINCT me) teachers,
              COUNT(DISTINCT partner) students
         FROM session
        WHERE role='teacher' AND minutes > 0 AND day BETWEEN ? AND ?`
    ).bind(start, end).first(),

    env.DB.prepare(
      `SELECT me, me_name teacher, partner student, day, minutes, reconnects, recorded, memo, ended_at
         FROM session
        WHERE role='teacher' AND day BETWEEN ? AND ?
        ORDER BY day ASC, started_at ASC`
    ).bind(start, end).all(),

    env.DB.prepare(
      `SELECT me, me_name teacher, partner student, MAX(day) last_day, COUNT(*) total
         FROM session
        WHERE role='teacher' AND minutes > 0 AND day >= ?
        GROUP BY me, partner`
    ).bind(known).all(),

    loadPaused(env),

    // 아직 확인하지 않은 선생님 메시지를 함께 올려 줍니다
    env.DB.prepare(
      `SELECT id, day, me_name, role, partner, kind, body, until, seen
         FROM note ORDER BY seen ASC, ts DESC LIMIT 30`
    ).all()
  ]);

  // 이번 주에 실제로 수업한 짝을 짝 단위로 묶습니다
  const didMap = new Map();
  for (const r of lessons.results) {
    const k = r.me + '|' + (r.student || '');
    if (!didMap.has(k)) {
      didMap.set(k, { teacher: r.teacher, student: r.student, count: 0, minutes: 0, days: [] });
    }
    const p = didMap.get(k);
    p.days.push({
      day: r.day, minutes: r.minutes, reconnects: r.reconnects,
      recorded: r.recorded, memo: r.memo, closed: !!r.ended_at
    });
    if (r.minutes > 0) { p.count++; p.minutes += r.minutes; }
  }

  const today = kstDay();
  const missing = [], stale = [];
  for (const p of knownPairs.results) {
    if (didMap.has(p.me + '|' + (p.student || ''))) continue;
    // 쉬기로 한 짝은 챙길 명단에서 빼야 합니다 — 그래야 이 명단을 믿을 수 있습니다
    if (paused.keys.has(p.me + '|' + (p.student || '')) || paused.keys.has(p.me + '|')) continue;

    const ago = Math.floor(
      (new Date(today + 'T00:00:00Z') - new Date(p.last_day + 'T00:00:00Z')) / 86400000
    );
    const row = { teacher: p.teacher, student: p.student, last_day: p.last_day, days_ago: ago, total: p.total };
    (ago >= 21 ? stale : missing).push(row);
  }
  missing.sort((a, b) => b.days_ago - a.days_ago);
  stale.sort((a, b) => b.days_ago - a.days_ago);

  return json({
    week: { start, end, is_current: start === weekStart(today) },
    summary,
    did: [...didMap.values()].sort((a, b) => b.minutes - a.minutes),
    missing,
    stale,
    paused: paused.list,
    notes: notes.results,
    unseen: notes.results.filter(n => !n.seen).length
  }, env, origin);
}

/** 월간 리포트 — session 표를 월별로 합치기만 합니다 */
async function handleReport(url, env, origin) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'FORBIDDEN' }, env, origin, 403);
  }
  if (!env.DB) return json({ error: 'NO_DB' }, env, origin, 500);

  const ym = (url.searchParams.get('month') || kstDay().slice(0, 7)).slice(0, 7);

  const [summary, byTeacher, stale, notes] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) rows_n,
              SUM(CASE WHEN role='teacher' THEN 1 ELSE 0 END) lessons,
              SUM(CASE WHEN role='teacher' THEN minutes ELSE 0 END) teacher_minutes,
              COUNT(DISTINCT CASE WHEN role='teacher' THEN me END) teachers,
              COUNT(DISTINCT CASE WHEN role='student' THEN me END) students,
              SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) abnormal_end
         FROM session WHERE day LIKE ? AND minutes > 0`
    ).bind(ym + '%').first(),
    env.DB.prepare(
      `SELECT me_name teacher, partner student, COUNT(*) lessons, SUM(minutes) minutes
         FROM session WHERE day LIKE ? AND role='teacher' AND minutes > 0
        GROUP BY me, partner ORDER BY lessons DESC`
    ).bind(ym + '%').all(),
    // 2주 이상 수업이 없는 짝 — 이탈하기 전에 알아채기 위한 것입니다
    env.DB.prepare(
      `SELECT me_name teacher, partner student, MAX(day) last_day
         FROM session WHERE role='teacher' AND minutes > 0
        GROUP BY me, partner
        HAVING MAX(day) < date('now','-14 day')
        ORDER BY last_day ASC`
    ).all(),

    // 그 달에 선생님들이 남긴 말 — 숫자가 설명하지 못하는 사정이 여기 있습니다
    env.DB.prepare(
      `SELECT day, me_name, role, partner, kind, body, until
         FROM note WHERE day LIKE ? ORDER BY ts DESC`
    ).bind(ym + '%').all()
  ]);

  return json({
    month: ym,
    summary,
    by_pair: byTeacher.results,
    needs_attention: stale.results,
    notes: notes.results
  }, env, origin);
}

async function handleStats(url, env, origin) {
  if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) {
    return json({ error: 'FORBIDDEN' }, env, origin, 403);
  }
  if (!env.DB) return json({ error: 'NO_DB' }, env, origin, 500);

  const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [byEvent, byCountry, sessions] = await Promise.all([
    env.DB.prepare(
      `SELECT event, COUNT(*) n FROM class_log WHERE ts >= ? GROUP BY event ORDER BY n DESC`
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT country,
              COUNT(*) rows_n,
              SUM(CASE WHEN event='reconnecting' THEN 1 ELSE 0 END) reconnects,
              SUM(CASE WHEN event='auto_audio_first' THEN 1 ELSE 0 END) audio_first,
              SUM(CASE WHEN event='fallback_used' THEN 1 ELSE 0 END) fallback,
              SUM(CASE WHEN event='quality' AND quality='poor' THEN 1 ELSE 0 END) poor
         FROM class_log WHERE ts >= ? GROUP BY country ORDER BY rows_n DESC`
    ).bind(since).all(),
    env.DB.prepare(
      `SELECT room, identity, role, country,
              MAX(duration_sec) sec, MAX(reconnects) reconnects, MIN(ts) started
         FROM class_log
        WHERE ts >= ? AND event IN ('joined','left')
        GROUP BY room, identity, date(ts)
        ORDER BY started DESC LIMIT 200`
    ).bind(since).all()
  ]);

  return json({
    days,
    since,
    by_event: byEvent.results,
    by_country: byCountry.results,
    recent_sessions: sessions.results
  }, env, origin);
}

/* ---------------- 진입점 ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    if (path === '/health') {
      return json({
        ok: true,
        configured: !!(env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET),
        db: !!env.DB,
        photos: !!env.PHOTOS
      }, env, origin);
    }
    if (path === '/token' && request.method === 'POST') {
      return handleToken(request, env, origin);
    }
    if (path === '/log' && request.method === 'POST') {
      return handleLog(request, env, origin, request.cf);
    }
    if (path === '/session/start' && request.method === 'POST') {
      return handleSessionStart(request, env, origin, request.cf);
    }
    if (path === '/session/end' && request.method === 'POST') {
      return handleSessionEnd(request, env, origin);
    }
    if (path === '/me' && request.method === 'POST') {
      return handleMe(request, env, origin);
    }
    if (path === '/teacher' && request.method === 'POST') {
      return handleTeacherSave(request, env, origin);
    }
    if (path === '/filing' && request.method === 'POST') {
      return handleFilingRequest(request, env, origin);
    }
    if (path === '/filing/done' && request.method === 'POST') {
      return handleFilingDone(request, url, env, origin);
    }
    if (path === '/form1365' && request.method === 'GET') {
      return handleForm1365(url, env, origin);
    }
    if (path === '/photo' && request.method === 'POST') {
      return handlePhotoAdd(request, env, origin);
    }
    if (path === '/photo/get' && request.method === 'GET') {
      return handlePhotoGet(url, env);
    }
    if (path === '/photo/delete' && request.method === 'POST') {
      return handlePhotoDelete(request, env, origin);
    }
    if (path === '/note' && request.method === 'POST') {
      return handleNoteAdd(request, env, origin);
    }
    if (path === '/note/seen' && request.method === 'POST') {
      return handleNoteSeen(request, url, env, origin);
    }
    if (path === '/notes' && request.method === 'GET') {
      return handleNotesAdmin(url, env, origin);
    }
    if (path === '/weekly' && request.method === 'GET') {
      return handleWeekly(url, env, origin);
    }
    if (path === '/report' && request.method === 'GET') {
      return handleReport(url, env, origin);
    }
    if (path === '/stats' && request.method === 'GET') {
      return handleStats(url, env, origin);
    }

    return json({ error: 'NOT_FOUND' }, env, origin, 404);
  }
};
