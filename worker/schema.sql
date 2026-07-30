-- ===================================================================
-- 표 1. session — 사람이 보는 기록
--
--   한 사람의 한 수업 참여 = 1행
--   (같은 수업이면 선생님 1행 + 학생 1행. 각자의 개인 방에 쌓입니다)
--
--   여기서 다음이 모두 나옵니다
--     · 개인 방 누적 이력 (my.html)
--     · 월간 리포트 (월별 합산 — 따로 만들 것이 없습니다)
--     · 1365 봉사시간 근거 (role='teacher' 합계)
--     · 이탈 감지 (2~3주 무입장 짝)
-- ===================================================================

CREATE TABLE IF NOT EXISTS session (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room         TEXT    NOT NULL,   -- 수업방
  day          TEXT    NOT NULL,   -- 날짜 (YYYY-MM-DD) — 월간 집계의 기준
  me           TEXT    NOT NULL,   -- 본인 식별자 (전화번호 숫자만) — 개인 방의 열쇠
  me_name      TEXT,               -- 본인 이름
  role         TEXT    NOT NULL,   -- teacher | student
  partner      TEXT,               -- 짝 이름
  started_at   TEXT    NOT NULL,   -- 입장 시각 (ISO)
  ended_at     TEXT,               -- 퇴장 시각 — 비어 있으면 비정상 종료(창을 닫음)
  minutes      INTEGER DEFAULT 0,  -- 실제 수업 분
  reconnects   INTEGER DEFAULT 0,  -- 그 수업에서 끊겼다 다시 붙은 횟수
  recorded     INTEGER DEFAULT 0,  -- 녹음 있음(1) / 없음(0)
  rec_key      TEXT,               -- 녹음 파일 위치 (R2) — 녹음 기능 붙일 때 채워집니다
  memo         TEXT,               -- 진도 한 줄
  country      TEXT                -- 접속 국가 (VN / KR)
);

CREATE INDEX IF NOT EXISTS idx_session_me    ON session(me, day);
CREATE INDEX IF NOT EXISTS idx_session_day   ON session(day);
CREATE INDEX IF NOT EXISTS idx_session_room  ON session(room, day);


-- ===================================================================
-- 표 2. note — 선생님이 본부에 남기는 말
--
--   수업 기록은 저절로 쌓이지만, 사정은 사람만 압니다.
--   "두 달 쉬기로 했어요", "학생이 시험기간이라 격주로 해요" 같은 것.
--
--   kind='pause' 로 남기면 그 짝이 '챙길 명단'에서 빠지고
--   '쉬는 중'으로 따로 보입니다. 명단을 믿을 수 있게 하는 장치입니다.
-- ===================================================================

CREATE TABLE IF NOT EXISTS note (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL,   -- 남긴 시각 (ISO)
  day       TEXT    NOT NULL,   -- 남긴 날짜 (한국 기준) — 월간 리포트에 실립니다
  me        TEXT    NOT NULL,   -- 남긴 사람 (전화번호)
  me_name   TEXT,               -- 남긴 사람 이름
  role      TEXT,               -- teacher | student
  partner   TEXT,               -- 어느 짝에 대한 이야기인지 (비우면 나 전체)
  kind      TEXT    NOT NULL,   -- message(할 말) | pause(쉼) | resume(복귀)
  body      TEXT,               -- 자유롭게 쓰는 말
  until     TEXT,               -- pause일 때 복귀 예정 날짜 (YYYY-MM-DD)
  seen      INTEGER DEFAULT 0   -- 본부가 확인했는지
);

CREATE INDEX IF NOT EXISTS idx_note_day  ON note(day);
CREATE INDEX IF NOT EXISTS idx_note_me   ON note(me, partner);
CREATE INDEX IF NOT EXISTS idx_note_kind ON note(kind);


-- ===================================================================
-- 표 3. teacher — 1365 신청에 필요한 선생님 정보
--
--   1365 양식은 [성명 · 생년월일 · 1365포털ID 혹은 연락처] 를 요구합니다.
--   수업 기록에서는 나오지 않는 값이라 선생님이 한 번만 넣어 주시면
--   이후 신청서에 자동으로 들어갑니다.
--
--   ⚠️ 생년월일은 민감한 값입니다. 신청서 작성 외의 용도로 쓰지 않습니다.
--      (양식 안내문의 개인정보 활용동의 항목과 같은 범위)
-- ===================================================================

CREATE TABLE IF NOT EXISTS teacher (
  me         TEXT PRIMARY KEY,   -- 전화번호
  me_name    TEXT,
  birth      TEXT,               -- 생년월일 (1968.04.28 형식 — 양식과 같게)
  portal_id  TEXT,               -- 1365포털 ID (없으면 연락처가 대신 쓰입니다)
  updated_at TEXT
);


-- ===================================================================
-- 표 4. filing — 1365 신청 (선생님이 손드는 것)
--
--   선생님은 [이번 달 1365 신청하기] 만 누릅니다.
--   본부(사역자님)가 매월 말 신청한 분들만 모아 단체 이름으로 성남시에 보냅니다.
--
--   신청은 선택입니다 — 안 누른 선생님은 취합 명단에 오르지 않습니다.
-- ===================================================================

CREATE TABLE IF NOT EXISTS filing (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ym           TEXT NOT NULL,      -- 신청하는 달 (YYYY-MM)
  me           TEXT NOT NULL,      -- 선생님 (전화번호)
  me_name      TEXT,
  requested_at TEXT NOT NULL,      -- 신청한 시각
  status       TEXT DEFAULT 'requested',  -- requested | submitted
  submitted_at TEXT                -- 본부가 성남시에 보낸 시각
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_filing_one ON filing(ym, me);
CREATE INDEX IF NOT EXISTS idx_filing_ym ON filing(ym, status);


-- ===================================================================
-- 표 5. photo — 선생님 방 사진 보관함
--
--   실제 이미지는 R2에 두고, 여기에는 목록만 둡니다.
--
--   ⭐ taken_at(촬영 시각)이 이 표의 핵심입니다.
--      1365 증빙은 날짜·시간이 보여야 인정되므로,
--      이미지 자체에도 날짜·시간을 새겨서 저장합니다.
--
--   kind = proof   수업 증빙 (학생 동의 후 수업 화면 촬영)
--          cert    파송증
--          profile 프로필 사진
--          free    자유 (선생님 방 꾸미기)
-- ===================================================================

CREATE TABLE IF NOT EXISTS photo (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL,   -- 올린 시각
  day       TEXT    NOT NULL,   -- 올린 날짜 (한국 기준)
  taken_at  TEXT,               -- 촬영 시각 (증빙에 쓰이는 값)
  me        TEXT    NOT NULL,   -- 주인 (전화번호)
  me_name   TEXT,
  partner   TEXT,               -- 함께 찍은 학생
  kind      TEXT    NOT NULL,   -- proof | cert | profile | free
  rkey      TEXT    NOT NULL,   -- R2 파일 이름 (아무도 못 맞추는 무작위 값)
  caption   TEXT,
  bytes     INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_photo_me   ON photo(me, kind);
CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_rkey ON photo(rkey);


-- ===================================================================
-- 표 6. class_log — 기계가 보는 기록 (기술 진단용)
--
--   6개월 뒤 "LiveKit을 유지할지 / 자체 서버로 옮길지 / 어디가 문제인지"를
--   느낌이 아니라 숫자로 판단하기 위한 표입니다.
--   사람에게 보여주는 화면에는 쓰지 않습니다.
-- ===================================================================

CREATE TABLE IF NOT EXISTS class_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL,   -- 브라우저 기준 시각 (ISO)
  room          TEXT,               -- 수업방 이름
  identity      TEXT,               -- 참가자 (teacher-홍길동 / student-Linh)
  role          TEXT,               -- teacher | student
  lang          TEXT,               -- ko | en
  event         TEXT    NOT NULL,   -- joined / quality / reconnecting / left / fallback_used ...
  quality       TEXT,               -- excellent | good | poor
  reconnects    INTEGER DEFAULT 0,  -- 그 시점까지 누적 재접속 횟수
  duration_sec  INTEGER DEFAULT 0,  -- 입장 후 경과 초
  country       TEXT,               -- Cloudflare가 알려주는 접속 국가 (VN / KR)
  colo          TEXT,               -- 접속한 Cloudflare 도시 코드 (HAN, SIN, ICN ...)
  ua            TEXT,               -- 브라우저·기기
  detail        TEXT                -- 이벤트별 부가 정보
);

CREATE INDEX IF NOT EXISTS idx_log_ts      ON class_log(ts);
CREATE INDEX IF NOT EXISTS idx_log_room    ON class_log(room);
CREATE INDEX IF NOT EXISTS idx_log_event   ON class_log(event);
CREATE INDEX IF NOT EXISTS idx_log_country ON class_log(country);
