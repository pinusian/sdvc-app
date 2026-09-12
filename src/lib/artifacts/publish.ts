import type { SupabaseClient } from "@supabase/supabase-js";
import { parseArtifactFiles, parseImageUses } from "@/lib/artifacts/parse";
import { copyAttachmentToArtifact, uploadArtifactFiles } from "@/lib/artifacts/storage";
import { pickUniqueSlug, toSlug } from "@/lib/projects/slug";
import {
  createProject,
  getProjectById,
  isSlugTaken,
  setProjectStatus,
  type Project,
} from "@/lib/projects/store";
import { setConversationProject } from "@/lib/conversations/store";

/**
 * [P4-3] 대화 답변 → 실제 산출물.
 *
 * 구현 블록에서 모델이 낸 파일들을 프로젝트로 묶어 Storage에 올린다.
 * 사용자가 "저장해줘"라고 따로 누르지 않아도, 파일이 나오면 바로 발행된다 —
 * 초보자에게 저장 버튼을 하나 더 누르게 하지 않으려는 것.
 */

export interface PublishInput {
  ownerId: string;
  conversationId: string;
  /** 모델의 이번 답변 전문 */
  answer: string;
  /** 프로젝트 이름(대화 제목). 주소를 만드는 데도 쓴다 */
  projectName: string;
  /** 이미 이 대화로 만든 프로젝트가 있으면 그 id */
  projectId?: string | null;
}

export interface PublishResult {
  project: Project;
  fileCount: number;
  /** [P7-10] 첨부에서 복사해 넣은 이미지 수 */
  imageCount: number;
  /** 알아보지 못했거나 실패한 지시. **조용히 버리지 않고 사용자에게 알린다** */
  warnings: string[];
}

export async function publishArtifact(
  admin: SupabaseClient,
  { ownerId, conversationId, answer, projectName, projectId }: PublishInput,
): Promise<PublishResult | null> {
  const files = parseArtifactFiles(answer);
  const { uses, invalid } = parseImageUses(answer);
  // 파일도 이미지도 없으면 발행할 것이 없다.
  if (files.length === 0 && uses.length === 0 && invalid.length === 0) return null;

  const project = projectId
    ? await getProjectById(admin, projectId, ownerId)
    : await createNewProject(admin, ownerId, projectName);

  if (!project) return null;

  try {
    const fileCount = files.length > 0 ? await uploadArtifactFiles(admin, project.id, files) : 0;

    // [P7-10] 이미지는 첨부 원본을 그대로 복사한다. 한 장이 실패해도
    // 나머지와 파일은 살리고, 무엇이 안 됐는지 알린다.
    const warnings = [...invalid];
    let imageCount = 0;
    for (const use of uses) {
      try {
        await copyAttachmentToArtifact(admin, {
          ownerId,
          conversationId,
          attachmentId: use.attachmentId,
          projectId: project.id,
          path: use.path,
        });
        imageCount += 1;
      } catch (error) {
        warnings.push(
          `${use.path} (${error instanceof Error ? error.message : "이미지를 넣지 못했습니다"})`,
        );
      }
    }

    await setProjectStatus(admin, project.id, ownerId, "deployed");
    await setConversationProject(admin, conversationId, ownerId, project.id);
    // 방금 바꾼 상태를 반영해서 돌려준다 (부르는 쪽이 다시 조회하지 않도록).
    return { project: { ...project, status: "deployed" }, fileCount, imageCount, warnings };
  } catch (error) {
    // 반쯤 올라간 채로 "완료"처럼 보이지 않게 표시해둔다.
    await setProjectStatus(admin, project.id, ownerId, "failed").catch(() => {});
    throw error;
  }
}

async function createNewProject(
  admin: SupabaseClient,
  ownerId: string,
  projectName: string,
): Promise<Project> {
  const slug = await pickUniqueSlug(toSlug(projectName), (candidate) =>
    isSlugTaken(admin, candidate),
  );
  return createProject(admin, { ownerId, name: projectName, slug });
}
