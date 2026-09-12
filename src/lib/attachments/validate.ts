/**
 * [P7-8] 첨부 파일 검사 (FR-031).
 *
 * 여기 들어오는 것은 **브라우저가 보낸 파일**이다. 이름도, 브라우저가 붙인
 * 형식(MIME)도 믿지 않는다 — 둘 다 보내는 쪽이 마음대로 정할 수 있다.
 * `.png`로 이름만 바꾼 실행파일을 받아 저장하면 우리 저장소가 배포판이 된다.
 *
 * 그래서 **파일 앞머리 바이트(매직 넘버)** 로 무엇인지 판정한다.
 */

/** 파일 하나의 최대 크기 (Clarify 11에서 확정) */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** 한 번에 붙일 수 있는 개수 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export type AttachmentKind = "image" | "text";

export type ValidAttachment = {
  ok: true;
  kind: AttachmentKind;
  mediaType: string;
  /** 저장할 때 쓸 확장자 — 내용에 따라 우리가 정한다 */
  extension: string;
};

export type InvalidAttachment = {
  ok: false;
  reason: "empty" | "too_large" | "unsupported_type" | "unreadable_text";
  message: string;
};

export type AttachmentCheck = ValidAttachment | InvalidAttachment;

interface Candidate {
  name: string;
  bytes: Uint8Array;
}

/** 앞머리 바이트로 알아보는 이미지들 */
const IMAGE_SIGNATURES: {
  mediaType: string;
  extension: string;
  matches: (b: Uint8Array) => boolean;
}[] = [
  {
    mediaType: "image/png",
    extension: "png",
    matches: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mediaType: "image/jpeg",
    extension: "jpg",
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mediaType: "image/gif",
    extension: "gif",
    matches: (b) => ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a",
  },
  {
    // RIFF....WEBP — 가운데 4바이트는 길이라 건너뛴다
    mediaType: "image/webp",
    extension: "webp",
    matches: (b) => b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP",
  },
];

/** 이름이 무엇이든 받지 않는 것들 — 확실히 거부하려고 따로 적어둔다 */
const FORBIDDEN_SIGNATURES: { label: string; matches: (b: Uint8Array) => boolean }[] = [
  { label: "실행파일", matches: (b) => ascii(b, 0, 2) === "MZ" },
  { label: "실행파일", matches: (b) => b[0] === 0x7f && ascii(b, 1, 3) === "ELF" },
  {
    label: "압축파일",
    matches: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05),
  },
  { label: "압축파일", matches: (b) => ascii(b, 0, 4) === "Rar!" },
  { label: "PDF", matches: (b) => ascii(b, 0, 4) === "%PDF" },
];

/** 확장자로 받는 글파일 (내용에 표시가 없으므로 이름을 볼 수밖에 없다) */
const TEXT_TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

function ascii(bytes: Uint8Array, from: number, length: number): string {
  if (bytes.length < from + length) return "";
  return String.fromCharCode(...bytes.slice(from, from + length));
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function invalid(
  reason: InvalidAttachment["reason"],
  message: string,
): InvalidAttachment {
  return { ok: false, reason, message };
}

export function validateAttachment({ name, bytes }: Candidate): AttachmentCheck {
  if (bytes.length === 0) {
    return invalid("empty", `${name}은(는) 빈 파일이에요.`);
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    const mb = Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024);
    return invalid("too_large", `${name}이(가) 너무 큽니다. 파일 하나에 ${mb}MB까지 올릴 수 있어요.`);
  }

  for (const forbidden of FORBIDDEN_SIGNATURES) {
    if (forbidden.matches(bytes)) {
      return invalid(
        "unsupported_type",
        `${name}은(는) ${forbidden.label}이라 올릴 수 없어요. 이미지나 글파일만 올려주세요.`,
      );
    }
  }

  // 내용이 이미지면 이름이 무엇이든 이미지로 받는다.
  for (const signature of IMAGE_SIGNATURES) {
    if (signature.matches(bytes)) {
      return {
        ok: true,
        kind: "image",
        mediaType: signature.mediaType,
        extension: signature.extension,
      };
    }
  }

  const extension = extensionOf(name);
  const mediaType = TEXT_TYPES[extension];
  if (!mediaType) {
    return invalid(
      "unsupported_type",
      `${name}은(는) 올릴 수 없는 형식이에요. 이미지(png·jpg·gif·webp)나 글파일(txt·md·csv·json)만 올려주세요.`,
    );
  }

  // 글파일이라면서 NUL이 들어 있으면 사실은 바이너리다.
  if (bytes.includes(0x00)) {
    return invalid("unsupported_type", `${name}은(는) 글파일이 아닌 것 같아요.`);
  }

  // 읽을 수 없는 글은 모델에게 줄 수도 없다.
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return invalid(
      "unreadable_text",
      `${name}의 글자를 읽을 수 없어요. UTF-8로 저장한 파일을 올려주세요.`,
    );
  }

  return { ok: true, kind: "text", mediaType, extension };
}
