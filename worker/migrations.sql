-- ===================================================================
-- 이미 만들어진 데이터베이스에 나중에 더한 것들
--
--   schema.sql 은 "처음부터 만들 때" 쓰는 파일입니다.
--   이미 돌고 있는 데이터베이스에는 CREATE TABLE IF NOT EXISTS 가
--   새 칸(컬럼)까지 넣어 주지는 못하므로, 더한 것을 여기에 날짜순으로 적습니다.
--
--   실행 (worker 폴더에서):
--     wr.bat d1 execute gks-class-log --remote --file=./migrations.sql
--
--   ⚠️ ALTER TABLE 은 두 번 실행하면 "duplicate column" 오류가 납니다.
--      이미 넣은 줄은 그대로 두고, 다시 돌릴 일이 있으면 그 줄만 빼고 돌리세요.
-- ===================================================================


-- 2026-07-31 · 사진을 D1에 담기 (R2를 켜기 전까지)
--
--   photo.rkey_big  원본용 큰 장 (증빙용 작은 장은 photo.rkey)
--   photo_blob      사진 알맹이 — 한 줄에 담을 수 있는 크기가 정해져 있어
--                   base64 조각으로 나눠 담습니다.

ALTER TABLE photo ADD COLUMN rkey_big TEXT;

CREATE TABLE IF NOT EXISTS photo_blob (
  rkey TEXT    NOT NULL,
  seq  INTEGER NOT NULL,
  mime TEXT    NOT NULL,
  b64  TEXT    NOT NULL,
  PRIMARY KEY (rkey, seq)
);
