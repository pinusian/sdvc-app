import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { AttachmentKind } from "@/lib/attachments/validate";

/**
 * [P7-8] 첨부 저장소 (FR-031).
 *
 * `artifacts`(공개될 수 있는 산출물)와 **버킷을 나눈다.** 섞어두면 공개범위
 * 규칙 하나가 어긋날 때 사용자가 올린 원본 사진까지 함께 새어나간다.
 *
 * 경로에 소유자와 대화를 함께 넣는 이유: 나중에 읽을 때도 같은 값으로만
 * 조립하므로, id만 알아낸 사람이 남의 첨부를 집어갈 수 없다.
 */

export const ATTACHMENT_BUCKET = "attachments";

export interface AttachmentLocation {
  ownerId: string;
  conversationId: string;
  id: string;
  extension: string;
}

export interface SaveAttachmentInput extends Omit<AttachmentLocation, "id"> {
  /** 사용자가 올린 원래 이름 — 보여주기용이지 경로에는 쓰지 않는다 */
  name: string;
  kind: AttachmentKind;
  mediaType: string;
  bytes: Uint8Array;
}

export interface SavedAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
}

export function attachmentPath({
  ownerId,
  conversationId,
  id,
  extension,
}: AttachmentLocation): string {
  return `${ownerId}/${conversationId}/${id}.${extension}`;
}

export async function saveAttachment(
  admin: SupabaseClient,
  input: SaveAttachmentInput,
): Promise<SavedAttachment> {
  const id = randomUUID();
  const path = attachmentPath({
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    id,
    extension: input.extension,
  });

  const { error } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, input.bytes as unknown as ArrayBuffer, {
      contentType: input.mediaType,
      upsert: false,
    });

  if (error) throw new Error(`첨부 저장 실패: ${error.message}`);

  return { id, kind: input.kind, name: input.name };
}

/** 저장해 둔 첨부를 그대로 읽는다. 경로는 소유자·대화로만 조립한다. */
export async function readAttachment(
  admin: SupabaseClient,
  location: AttachmentLocation,
): Promise<Uint8Array> {
  const { data, error } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .download(attachmentPath(location));

  if (error || !data) {
    throw new Error(`첨부를 읽지 못했습니다: ${error?.message ?? "내용 없음"}`);
  }

  return new Uint8Array(await data.arrayBuffer());
}

/** 대화가 지워질 때 그 대화의 첨부도 함께 지운다. 지운 개수를 돌려준다. */
export async function deleteConversationAttachments(
  admin: SupabaseClient,
  ownerId: string,
  conversationId: string,
): Promise<number> {
  const prefix = `${ownerId}/${conversationId}`;
  const { data, error } = await admin.storage.from(ATTACHMENT_BUCKET).list(prefix);
  if (error) throw new Error(`첨부 목록 조회 실패: ${error.message}`);
  if (!data?.length) return 0;

  const paths = data.map((file) => `${prefix}/${file.name}`);
  const { error: removeError } = await admin.storage.from(ATTACHMENT_BUCKET).remove(paths);
  if (removeError) throw new Error(`첨부 삭제 실패: ${removeError.message}`);

  return paths.length;
}
