import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * [P4-3] 답변에서 파일을 뽑아 실제로 발행하기까지의 흐름.
 * 파싱·업로드·DB는 각각 따로 검증했으므로, 여기서는 **순서와 조건**을 본다.
 */

const uploadArtifactFiles = vi.fn();
const createProject = vi.fn();
const getProjectById = vi.fn();
const isSlugTaken = vi.fn();
const setProjectStatus = vi.fn();
const setConversationProject = vi.fn();
const copyAttachmentToArtifact = vi.fn();

vi.mock("@/lib/artifacts/storage", () => ({
  uploadArtifactFiles: (...args: unknown[]) => uploadArtifactFiles(...args),
  copyAttachmentToArtifact: (...args: unknown[]) => copyAttachmentToArtifact(...args),
}));

vi.mock("@/lib/projects/store", () => ({
  createProject: (...args: unknown[]) => createProject(...args),
  getProjectById: (...args: unknown[]) => getProjectById(...args),
  isSlugTaken: (...args: unknown[]) => isSlugTaken(...args),
  setProjectStatus: (...args: unknown[]) => setProjectStatus(...args),
}));

vi.mock("@/lib/conversations/store", () => ({
  setConversationProject: (...args: unknown[]) => setConversationProject(...args),
}));

const { publishArtifact } = await import("@/lib/artifacts/publish");

const admin = { __admin: true } as never;
const PROJECT = {
  id: "proj-1",
  ownerId: "user-1",
  name: "내 홈페이지",
  slug: "site-ab12cd",
  visibility: "private" as const,
  status: "draft" as const,
};

function answerWithFiles() {
  return [
    "홈페이지를 만들었습니다.",
    "```file:index.html\n<h1>안녕</h1>\n```",
    "```file:style.css\nbody{}\n```",
  ].join("\n\n");
}

describe("[P4-3] publishArtifact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSlugTaken.mockResolvedValue(false);
    createProject.mockResolvedValue(PROJECT);
    uploadArtifactFiles.mockResolvedValue(2);
    setProjectStatus.mockResolvedValue(undefined);
    setConversationProject.mockResolvedValue(undefined);
  });

  it("파일이 없는 답변이면 아무 것도 만들지 않는다", async () => {
    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: "아직 계획 단계입니다.",
      projectName: "내 홈페이지",
    });

    expect(result).toBeNull();
    expect(createProject).not.toHaveBeenCalled();
    expect(uploadArtifactFiles).not.toHaveBeenCalled();
  });

  it("파일이 있으면 프로젝트를 만들고 올린 뒤 완료 상태로 바꾼다", async () => {
    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: answerWithFiles(),
      projectName: "내 홈페이지",
    });

    expect(createProject).toHaveBeenCalledWith(admin, {
      ownerId: "user-1",
      name: "내 홈페이지",
      slug: expect.stringMatching(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    });
    expect(uploadArtifactFiles).toHaveBeenCalledWith(admin, "proj-1", [
      { path: "index.html", content: "<h1>안녕</h1>" },
      { path: "style.css", content: "body{}" },
    ]);
    expect(setProjectStatus).toHaveBeenCalledWith(admin, "proj-1", "user-1", "deployed");
    expect(setConversationProject).toHaveBeenCalledWith(admin, "conv-1", "user-1", "proj-1");
    // 돌려주는 프로젝트의 상태도 방금 바꾼 값이어야 한다 (draft가 아니라 deployed)
    expect(result).toEqual({
      project: { ...PROJECT, status: "deployed" },
      fileCount: 2,
      // [P7-10]에서 늘어난 값 — 이미지 지시가 없으면 0·빈 목록이다
      imageCount: 0,
      warnings: [],
    });
  });

  it("이미 프로젝트가 연결된 대화면 새로 만들지 않고 덮어쓴다", async () => {
    getProjectById.mockResolvedValue({ ...PROJECT, status: "deployed" });

    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: answerWithFiles(),
      projectName: "내 홈페이지",
      projectId: "proj-1",
    });

    expect(createProject).not.toHaveBeenCalled();
    expect(uploadArtifactFiles).toHaveBeenCalledWith(admin, "proj-1", expect.any(Array));
    expect(result?.project.id).toBe("proj-1");
  });

  it("주소가 이미 쓰이면 다른 주소를 고른다", async () => {
    isSlugTaken.mockImplementation(async (_client: unknown, slug: string) => slug === "my-blog");

    await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: answerWithFiles(),
      projectName: "my blog",
    });

    expect(createProject.mock.calls[0][1].slug).not.toBe("my-blog");
  });

  it("올리다 실패하면 실패 상태로 표시하고 오류를 알린다", async () => {
    uploadArtifactFiles.mockRejectedValue(new Error("quota exceeded"));

    await expect(
      publishArtifact(admin, {
        ownerId: "user-1",
        conversationId: "conv-1",
        answer: answerWithFiles(),
        projectName: "내 홈페이지",
      }),
    ).rejects.toThrow(/quota exceeded/);

    expect(setProjectStatus).toHaveBeenCalledWith(admin, "proj-1", "user-1", "failed");
  });
});

/**
 * [P7-10] 첨부한 이미지를 산출물 폴더로 복사한다 (FR-032, BL-005).
 */
describe("[P7-10] 산출물에 이미지 넣기", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectById.mockResolvedValue(PROJECT);
    uploadArtifactFiles.mockImplementation(async (_a, _id, files) => files.length);
    setProjectStatus.mockResolvedValue(undefined);
    setConversationProject.mockResolvedValue(undefined);
  });

  it("use-image 지시가 있으면 첨부를 프로젝트 폴더로 복사한다", async () => {
    copyAttachmentToArtifact.mockResolvedValue(undefined);

    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer:
        '```file:index.html\n<img src="images/hero.png">\n```\n\n```use-image:images/hero.png@att-1```',
      projectName: "내 홈페이지",
      projectId: "proj-1",
    });

    expect(copyAttachmentToArtifact).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        ownerId: "user-1",
        conversationId: "conv-1",
        attachmentId: "att-1",
        projectId: "proj-1",
        path: "images/hero.png",
      }),
    );
    expect(result?.imageCount).toBe(1);
  });

  it("파일 없이 이미지만 넣어달라고 해도 된다 (이미 있는 프로젝트라면)", async () => {
    copyAttachmentToArtifact.mockResolvedValue(undefined);

    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: "```use-image:images/hero.png@att-1```",
      projectName: "내 홈페이지",
      projectId: "proj-1",
    });

    expect(result?.imageCount).toBe(1);
    expect(result?.fileCount).toBe(0);
  });

  it("알아보지 못한 지시는 조용히 버리지 않고 알린다", async () => {

    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: '```file:index.html\n<h1>x</h1>\n```\n\n```use-image:index.html@att-1```',
      projectName: "내 홈페이지",
      projectId: "proj-1",
    });

    expect(result?.warnings?.length).toBe(1);
    expect(copyAttachmentToArtifact).not.toHaveBeenCalled();
  });

  it("첨부를 찾지 못하면 알리되 나머지는 살린다", async () => {
    copyAttachmentToArtifact.mockRejectedValue(new Error("첨부를 찾을 수 없습니다"));

    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: '```file:index.html\n<h1>x</h1>\n```\n\n```use-image:images/a.png@없는것```',
      projectName: "내 홈페이지",
      projectId: "proj-1",
    });

    expect(result?.fileCount).toBe(1);
    expect(result?.imageCount).toBe(0);
    expect(result?.warnings?.[0]).toContain("images/a.png");
  });
});
