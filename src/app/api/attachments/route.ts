import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireLearnerAccess } from "@/lib/auth/learner-route-guard";
import { getConversation } from "@/lib/conversations/store";
import { saveAttachment } from "@/lib/attachments/store";
import {
  validateAttachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/attachments/validate";

/**
 * [P7-8] 프롬프트에 붙일 파일 올리기 (FR-031, BL-004).
 *
 * 대화에는 **id만** 실린다. 나중에 서버가 그 id로 원본을 다시 읽어 모델에게
 * 넘긴다 — 클라이언트가 보낸 내용을 그대로 믿지 않는 것은 [P6-5]에서
 * 가격 id를 서버 환경변수에서만 읽는 것과 같은 원칙이다.
 *
 * **하나라도 걸리면 통째로 거부한다.** 반만 올라가면 사용자는 무엇이
 * 올라갔는지 알 수 없고, 모델은 빠진 파일을 모른 채 답한다.
 */
export async function POST(request: Request) {
  const access = await requireLearnerAccess();
  if (!access.ok) return access.response;
  const { user } = access;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const conversationId = String(form.get("conversationId") ?? "");
  if (!conversationId) {
    return NextResponse.json({ error: "어느 대화에 붙일지 알 수 없습니다." }, { status: 400 });
  }

  const admin = createAdminClient();
  const conversation = await getConversation(admin, conversationId, user.id);
  if (!conversation) {
    return NextResponse.json({ error: "대화를 찾을 수 없습니다." }, { status: 404 });
  }

  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "올릴 파일을 골라주세요." }, { status: 400 });
  }
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_ATTACHMENTS_PER_MESSAGE}개까지 올릴 수 있어요.` },
      { status: 400 },
    );
  }

  // 먼저 전부 검사하고, 전부 통과했을 때만 저장한다.
  const checked: { name: string; bytes: Uint8Array; kind: "image" | "text"; mediaType: string; extension: string }[] =
    [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = validateAttachment({ name: file.name, bytes });
    if (!result.ok) {
      return NextResponse.json({ error: result.message, reason: result.reason }, { status: 400 });
    }
    checked.push({
      name: file.name,
      bytes,
      kind: result.kind,
      mediaType: result.mediaType,
      extension: result.extension,
    });
  }

  try {
    const attachments = [];
    for (const item of checked) {
      attachments.push(
        await saveAttachment(admin, {
          ownerId: user.id,
          conversationId,
          name: item.name,
          kind: item.kind,
          mediaType: item.mediaType,
          extension: item.extension,
          bytes: item.bytes,
        }),
      );
    }
    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "첨부를 저장하지 못했습니다." },
      { status: 500 },
    );
  }
}
