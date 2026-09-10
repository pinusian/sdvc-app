/**
 * [P4-1] 산출물 저장소(Storage) 버킷 만들기.
 *
 * 대시보드에서 손으로 만들면 나중에 무엇을 어떻게 설정했는지 알 수 없으므로
 * 스크립트로 남긴다. 여러 번 실행해도 안전하다(이미 있으면 건너뜀).
 *
 *   node scripts/setup-storage.mjs
 *
 * 설계:
 * - **비공개 버킷**이다. Supabase가 주는 공개 URL로는 아무도 못 읽는다.
 *   산출물은 [P5-x]의 `/site/{주소}` 라우트가 공개범위(FR-007)를 확인한 뒤
 *   서버가 대신 내보낸다. 공개 버킷으로 만들면 구독 해지 시 즉시 비공개
 *   전환(FR-023)이 무력화된다.
 * - 쓰기·읽기는 SUPABASE_SECRET_KEY를 쓰는 서버 코드만 할 수 있다
 *   (브라우저 키는 정책이 없어 차단된다 — conversations 표와 같은 원칙).
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "artifacts";
const FILE_SIZE_LIMIT = "5MB";

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY 가 필요합니다 (.env.local).");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });

const { data: buckets, error: listError } = await admin.storage.listBuckets();
if (listError) {
  console.error("버킷 목록 조회 실패:", listError.message);
  process.exit(1);
}

if (buckets.some((bucket) => bucket.name === BUCKET)) {
  console.log(`'${BUCKET}' 버킷이 이미 있습니다.`);
} else {
  const { error } = await admin.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: FILE_SIZE_LIMIT,
  });
  if (error) {
    console.error("버킷 생성 실패:", error.message);
    process.exit(1);
  }
  console.log(`'${BUCKET}' 버킷을 만들었습니다 (비공개, 파일당 ${FILE_SIZE_LIMIT}).`);
}

const { data: after } = await admin.storage.listBuckets();
console.log(
  "현재 버킷:",
  after.map((b) => `${b.name}(public=${b.public})`).join(", "),
);

/** .env.local을 직접 읽어 process.env에 채운다 (이 스크립트는 Next 밖에서 돈다). */
function loadEnvLocal() {
  const filePath = path.resolve(import.meta.dirname, "..", ".env.local");
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(eq + 1).trim();
  }
}
