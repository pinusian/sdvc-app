import { describe, expect, it } from "vitest";
import { validateSignupInput } from "@/lib/auth/validation";

describe("[P2-5] validateSignupInput", () => {
  it("이메일 형식이 아니면 실패한다", () => {
    const result = validateSignupInput("not-an-email", "password123");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("이메일");
  });

  it("이메일이 비어있으면 실패한다", () => {
    const result = validateSignupInput("", "password123");
    expect(result.valid).toBe(false);
  });

  it("비밀번호가 8자 미만이면 실패한다", () => {
    const result = validateSignupInput("dev@example.com", "short");
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("비밀번호");
  });

  it("이메일·비밀번호가 모두 유효하면 통과한다", () => {
    const result = validateSignupInput("dev@example.com", "password123");
    expect(result.valid).toBe(true);
  });
});
