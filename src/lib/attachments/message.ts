import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentBlock } from "@/lib/claude/chat";
import { readAttachment, resolveAttachment } from "@/lib/attachments/store";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/attachments/validate";

/**
 * [P7-9] 첨부를 모델에게 실어 보낼 모양으로 바꾼다 (FR-031).
 *
 * 클라이언트는 **id만** 보낸다. 여기서 저장소의 원본을 다시 읽는다 —
 * 클라이언트가 보낸 파일 내용을 그대로 넘기면, 화면에 보여준 것과 다른 것을
 * 모델에게 보낼 수 있다([P6-5]에서 가격 id를 서버에서만 읽는 것과 같은 원칙).
 */

/**
 * 글파일 하나에서 가져갈 최대 글자 수.
 *
 * 10MB짜리 글을 통째로 실으면 수백만 토큰이 되어 한도가 한 번에 날아가고
 * 모델의 문맥도 넘친다. 자르되 **잘랐다고 모델에게 알려서** 없는 내용을
 * 있는 것처럼 답하지 않게 한다.
 */
export const MAX_TEXT_CHARS = 100_000;

export class AttachmentError extends Error {}

export async function buildAttachmentBlocks(
  admin: SupabaseClient,
  {
    ownerId,
    conversationId,
    attachmentIds,
  }: { ownerId: string; conversationId: string; attachmentIds: string[] },
): Promise<ContentBlock[]> {
  if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new AttachmentError(
      `한 번에 ${MAX_ATTACHMENTS_PER_MESSAGE}개까지 붙일 수 있어요.`,
    );
  }

  const blocks: ContentBlock[] = [];

  for (const [index, id] of attachmentIds.entries()) {
    const found = await resolveAttachment(admin, { ownerId, conversationId, id });
    if (!found) {
      // 남의 첨부이거나 이미 지워진 것. 어느 쪽인지 알려주지 않는다.
      throw new AttachmentError("첨부를 찾을 수 없습니다. 다시 올려주세요.");
    }

    const bytes = await readAttachment(admin, found);

    if (found.kind === "image") {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: found.mediaType,
          data: Buffer.from(bytes).toString("base64"),
        },
      });
      continue;
    }

    const full = new TextDecoder().decode(bytes);
    const cut = full.length > MAX_TEXT_CHARS;
    const body = cut ? full.slice(0, MAX_TEXT_CHARS) : full;
    blocks.push({
      type: "text",
      text: [
        `[첨부한 글파일 ${index + 1}]`,
        body,
        cut ? "…(파일이 길어서 여기까지만 잘렸습니다. 뒷부분은 보이지 않습니다.)" : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  return blocks;
}
