import { describe, expect, it } from "vitest";
import {
  validateAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/attachments/validate";

/**
 * [P7-8] 첨부 파일 검사 (FR-031, BL-004).
 *
 * 여기 들어오는 것은 **브라우저가 보낸 파일**이므로 이름도 형식도 믿지 않는다.
 * `.png`로 이름만 바꾼 실행파일을 그대로 받으면 저장소가 배포판이 된다.
 * 확장자가 아니라 **파일 앞머리 바이트**로 무엇인지 판정한다.
 */

const png = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);
const gif = () => Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(40)]);
const webp = () =>
  Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x20, 0x00, 0x00, 0x00]),
    Buffer.from("WEBP"),
    Buffer.alloc(40),
  ]);
const exe = () => Buffer.concat([Buffer.from("MZ"), Buffer.alloc(40)]);
const zip = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);

describe("[P7-8] validateAttachment — 이미지", () => {
  it("png·jpg·gif·webp를 알아본다", () => {
    expect(validateAttachment({ name: "a.png", bytes: png() })).toMatchObject({
      ok: true,
      kind: "image",
      mediaType: "image/png",
    });
    expect(validateAttachment({ name: "b.jpg", bytes: jpeg() })).toMatchObject({
      ok: true,
      mediaType: "image/jpeg",
    });
    expect(validateAttachment({ name: "c.gif", bytes: gif() })).toMatchObject({
      ok: true,
      mediaType: "image/gif",
    });
    expect(validateAttachment({ name: "d.webp", bytes: webp() })).toMatchObject({
      ok: true,
      mediaType: "image/webp",
    });
  });

  it("확장자가 거짓말을 해도 내용대로 판정한다", () => {
    // 진짜 png인데 이름이 .txt
    expect(validateAttachment({ name: "sneaky.txt", bytes: png() })).toMatchObject({
      ok: true,
      kind: "image",
      mediaType: "image/png",
      extension: "png",
    });
  });

  it("이름만 이미지인 실행파일은 거부한다", () => {
    const result = validateAttachment({ name: "virus.png", bytes: exe() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_type");
  });

  it("압축파일도 거부한다", () => {
    expect(validateAttachment({ name: "files.zip", bytes: zip() }).ok).toBe(false);
  });
});

describe("[P7-8] validateAttachment — 글파일", () => {
  it("txt·md·csv·json을 받는다", () => {
    for (const [name, media] of [
      ["memo.txt", "text/plain"],
      ["readme.md", "text/markdown"],
      ["list.csv", "text/csv"],
      ["data.json", "application/json"],
    ] as const) {
      expect(validateAttachment({ name, bytes: Buffer.from("안녕하세요") })).toMatchObject({
        ok: true,
        kind: "text",
        mediaType: media,
      });
    }
  });

  it("모르는 확장자의 글은 거부한다 (실행 스크립트가 섞여 들어온다)", () => {
    const result = validateAttachment({ name: "run.sh", bytes: Buffer.from("rm -rf /") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unsupported_type");
  });

  it("글파일인데 안에 NUL 바이트가 있으면 거부한다 (사실은 바이너리다)", () => {
    const bytes = Buffer.concat([Buffer.from("hello"), Buffer.from([0x00]), Buffer.from("world")]);
    expect(validateAttachment({ name: "a.txt", bytes }).ok).toBe(false);
  });

  it("깨진 UTF-8은 거부한다 — 읽을 수 없으면 모델에게 줄 수도 없다", () => {
    expect(validateAttachment({ name: "a.txt", bytes: Buffer.from([0xff, 0xfe, 0x41]) }).ok).toBe(
      false,
    );
  });
});

describe("[P7-8] validateAttachment — 크기와 개수", () => {
  it("빈 파일은 거부한다", () => {
    const result = validateAttachment({ name: "a.txt", bytes: Buffer.alloc(0) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("10MB를 넘으면 거부한다", () => {
    const big = Buffer.concat([png(), Buffer.alloc(MAX_ATTACHMENT_BYTES)]);
    const result = validateAttachment({ name: "big.png", bytes: big });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_large");
  });

  it("한 번에 5개까지다", () => {
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(5);
  });

  it("거부 이유는 사람이 읽는 말로 온다", () => {
    const result = validateAttachment({ name: "virus.png", bytes: exe() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/이미지|파일/);
      expect(result.message).not.toMatch(/unsupported_type/);
    }
  });
});
