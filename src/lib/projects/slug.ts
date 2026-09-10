/**
 * [P4-3] 프로젝트 이름 → 산출물 주소(slug).
 *
 * DB는 소문자·숫자·하이픈, 3~40자만 받는다([P4-2] `0004_projects.sql`).
 * 사람이 쓴 이름은 대부분 그 형식이 아니고, 한글 이름이면 주소로 옮길 글자가
 * 아예 없다 — 그럴 때는 `site-xxxx`처럼 쓸 수 있는 주소를 만들어준다.
 */

const MIN_LENGTH = 3;
const MAX_LENGTH = 40;

export function toSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // 한글·공백·기호는 전부 구분자로
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-+$/g, "");

  if (base.length >= MIN_LENGTH) return base;

  // 주소로 쓸 글자가 부족하면(한글 이름 등) 무작위 꼬리를 붙여 채운다.
  const tail = randomTail();
  const prefix = base.length > 0 ? base : "site";
  return `${prefix}-${tail}`.slice(0, MAX_LENGTH).replace(/-+$/g, "");
}

/**
 * 이미 쓰는 주소면 `-2`, `-3`… 을 붙여 비어 있는 주소를 찾는다.
 * 40자를 넘지 않도록 앞부분을 잘라낸다.
 */
export async function pickUniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base;

  for (let n = 2; n <= 99; n++) {
    const suffix = `-${n}`;
    const head = base.slice(0, MAX_LENGTH - suffix.length).replace(/-+$/g, "");
    const candidate = `${head}${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  // 여기까지 왔으면 이름이 아주 흔한 것이다 — 무작위 꼬리로 확실히 피한다.
  const tail = `-${randomTail()}`;
  const head = base.slice(0, MAX_LENGTH - tail.length).replace(/-+$/g, "");
  return `${head}${tail}`;
}

function randomTail(): string {
  return Math.random().toString(36).slice(2, 8);
}
