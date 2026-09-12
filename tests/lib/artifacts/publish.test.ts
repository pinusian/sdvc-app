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
const artifactFileExists = vi.fn();
const saveVersion = vi.fn();

vi.mock("@/lib/artifacts/storage", () => ({
  uploadArtifactFiles: (...args: unknown[]) => uploadArtifactFiles(...args),
  copyAttachmentToArtifact: (...args: unknown[]) => copyAttachmentToArtifact(...args),
  artifactFileExists: (...args: unknown[]) => artifactFileExists(...args),
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

vi.mock("@/lib/versions/store", () => ({
  saveVersion: (...args: unknown[]) => saveVersion(...args),
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
    uploadArtifactFiles.mockResolvedValue({ count: 2, unchanged: [] });
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
    uploadArtifactFiles.mockImplementation(async (_a, _id, files) => ({
      count: (files as unknown[]).length,
      unchanged: [],
    }));
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

/**
 * [P7-11 검증에서 발견] 모델이 `use-image`만 내고 HTML을 고치지 않았다.
 * 사진은 저장됐는데 **화면에는 아무 변화가 없다** — 사용자는 "넣었습니다"라는
 * 답변만 보고 왜 안 보이는지 알 수 없다.
 */
describe("[P7-11] 넣었는데 안 보이는 경우를 잡아낸다", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectById.mockResolvedValue(PROJECT);
    uploadArtifactFiles.mockImplementation(async (_a, _id, files) => ({
      count: (files as unknown[]).length,
      unchanged: [],
    }));
    setProjectStatus.mockResolvedValue(undefined);
    setConversationProject.mockResolvedValue(undefined);
    copyAttachmentToArtifact.mockResolvedValue(undefined);
    artifactFileExists.mockResolvedValue(false);
  });

  it("새 사진인데 아무 파일도 그 경로를 쓰지 않으면 알린다", async () => {
    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: "```use-image:images/photo.png@att-1```",
      projectName: "내 홈페이지",
      projectId: "proj-1",
    });

    expect(result?.imageCount).toBe(1);
    expect(result?.warnings?.[0]).toContain("images/photo.png");
    expect(result?.warnings?.[0]).toMatch(/보이지|쓰는 곳/);
  });

  it("같은 답변의 파일이 그 경로를 쓰면 조용하다", async () => {
    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer:
        '```file:index.html\n<img src="images/photo.png">\n```\n\n```use-image:images/photo.png@att-1```',
      projectName: "내 홈페이지",
      projectId: "proj-1",
    });

    expect(result?.warnings).toEqual([]);
  });

  it("이미 있던 사진을 바꾸는 것이면 조용하다 (HTML은 그대로면 된다)", async () => {
    artifactFileExists.mockResolvedValue(true);

    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: "```use-image:images/photo.png@att-2```",
      projectName: "내 홈페이지",
      projectId: "proj-1",
    });

    expect(result?.warnings).toEqual([]);
  });
});

/**
 * [P7-6a] 발행이 끝나면 그 시점을 버전으로 남긴다 (FR-012).
 * **발행 뒤**에 남겨야 "지금 보이는 상태"도 목록에 있다.
 */
describe("[P7-6a] 발행 후 버전 보관", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectById.mockResolvedValue(PROJECT);
    uploadArtifactFiles.mockImplementation(async (_a, _id, files) => ({
      count: (files as unknown[]).length,
      unchanged: [],
    }));
    setProjectStatus.mockResolvedValue(undefined);
    setConversationProject.mockResolvedValue(undefined);
    artifactFileExists.mockResolvedValue(false);
    saveVersion.mockResolvedValue("0001");
  });

  it("파일을 올린 뒤 사본을 남긴다", async () => {
    await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: answerWithFiles(),
      projectName: "내 홈페이지",
      projectId: "proj-1",
      request: "빵집 홈페이지 만들어줘",
    });

    expect(saveVersion).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ projectId: "proj-1", request: "빵집 홈페이지 만들어줘" }),
    );
  });

  it("사본 남기기가 실패해도 발행은 살린다 (기록보다 결과가 먼저다)", async () => {
    saveVersion.mockRejectedValue(new Error("저장소 오류"));

    const result = await publishArtifact(admin, {
      ownerId: "user-1",
      conversationId: "conv-1",
      answer: answerWithFiles(),
      projectName: "내 홈페이지",
      projectId: "proj-1",
      request: "만들어줘",
    });

    expect(result?.fileCount).toBe(2);
    expect(result?.warnings?.some((w) => w.includes("되돌리기"))).toBe(true);
  });
});
