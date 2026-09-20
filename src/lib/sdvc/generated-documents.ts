import type { BlockId } from "@/lib/sdvc/blocks";
import type { DocumentKind, DocumentVersion } from "@/lib/sdvc/document-state";

const REQUIRED_DOCUMENTS: Partial<Record<BlockId, readonly DocumentKind[]>> = {
  constitution_specify: ["constitution", "spec"],
  clarify: ["clarifications"],
  plan: ["plan"],
  tasks: ["tasks"],
};

const DOCUMENT_PATTERN =
  /<!--\s*SDVC_DOCUMENT:(constitution|spec|clarifications|plan|tasks)\s*-->\s*([\s\S]*?)\s*<!--\s*\/SDVC_DOCUMENT\s*-->/g;

export interface GeneratedDocument {
  kind: DocumentKind;
  content: string;
}

export function documentOutputInstruction(block: BlockId): string {
  const required = REQUIRED_DOCUMENTS[block];
  if (!required) return "";

  const examples = required.flatMap((kind) => [
    `<!-- SDVC_DOCUMENT:${kind} -->`,
    `여기에 ${kind} 문서의 완전한 Markdown 내용을 쓴다.`,
    "<!-- /SDVC_DOCUMENT -->",
  ]);

  return [
    "## 구조화 문서 저장 형식",
    "",
    "이 블록을 마치고 게이트 표시를 낼 때만 아래 문서 경계를 답변에 함께 넣는다.",
    "질문을 이어가는 중에는 문서 경계나 게이트를 내지 않는다.",
    "각 경계 안에는 요약이 아니라 현재 문서의 완전한 Markdown 내용을 쓴다.",
    "HTML 주석 경계는 화면에서 숨겨지고 서버가 문서별 불변 버전으로 저장한다.",
    "",
    ...examples,
    "",
    "필요한 문서 경계가 하나라도 빠지면 승인/다음 단계 버튼이 나타나지 않는다.",
  ].join("\n");
}

export function parseGeneratedDocuments(answer: string, block: BlockId): GeneratedDocument[] {
  const required = REQUIRED_DOCUMENTS[block];
  if (!required) return [];

  const found = new Map<DocumentKind, string>();
  for (const match of answer.matchAll(DOCUMENT_PATTERN)) {
    const kind = match[1] as DocumentKind;
    const content = match[2].trim();
    if (!required.includes(kind) || !content || found.has(kind)) continue;
    found.set(kind, content);
  }

  const missing = required.filter((kind) => !found.has(kind));
  if (missing.length > 0) {
    throw new Error(`필수 구조화 문서가 빠졌습니다: ${missing.join(", ")}`);
  }

  return required.map((kind) => ({ kind, content: found.get(kind)! }));
}

export async function persistGeneratedDocuments(
  input: {
    projectId: string;
    block: BlockId;
    answer: string;
    now: string;
  },
  dependencies: {
    saveDocument(input: {
      projectId: string;
      kind: DocumentKind;
      content: string;
      now: string;
    }): Promise<DocumentVersion | unknown>;
  },
): Promise<void> {
  const documents = parseGeneratedDocuments(input.answer, input.block);
  for (const document of documents) {
    await dependencies.saveDocument({
      projectId: input.projectId,
      kind: document.kind,
      content: document.content,
      now: input.now,
    });
  }
}
