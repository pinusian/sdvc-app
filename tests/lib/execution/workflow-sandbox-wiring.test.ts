// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function source(relativePath: string) {
  const absolutePath = path.join(ROOT, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}

describe("[T034] Workflow·Vercel Sandbox 실제 배선", () => {
  it("Next.js 빌드가 Workflow 지시어를 변환하도록 withWorkflow를 적용한다", () => {
    const config = source("next.config.ts");

    expect(config).toMatch(/import\s*\{\s*withWorkflow\s*\}\s*from\s*["']workflow\/next["']/);
    expect(config).toMatch(/export default withWorkflow\(nextConfig\)/);
  });

  it("durable workflow가 Node 작업 step을 거쳐 persistent worker를 실행한다", () => {
    const workflow = source("src/workflows/execute-persistent-run.ts");

    expect(workflow).toContain('"use workflow"');
    expect(workflow).toContain('"use step"');
    expect(workflow).toMatch(/executePersistentRun\(/);
    expect(workflow).toMatch(/createPersistentRunStore\(/);
    expect(workflow).toMatch(/createVercelSandboxPort\(/);
  });

  it("Sandbox는 1 vCPU·비영속·단시간으로 만들고 테스트 전에 네트워크를 차단한다", () => {
    const adapter = source("src/lib/execution/vercel-sandbox-port.ts");

    expect(adapter).toMatch(/Sandbox\.create\(/);
    expect(adapter).toMatch(/resources:\s*\{\s*vcpus:\s*1\s*\}/);
    expect(adapter).toMatch(/persistent:\s*false/);
    expect(adapter).toMatch(/timeout:\s*120_000/);
    expect(adapter).toMatch(/networkPolicy:\s*\{\s*allow:\s*\["registry\.npmjs\.org"\]\s*\}/);
    expect(adapter).toMatch(/updateNetworkPolicy\("deny-all"/);
    expect(adapter).toMatch(/finally\s*\{[\s\S]*sandbox\.stop\(/);
  });

  it("인증·소유권 확인 뒤 start()로 durable workflow를 큐에 넣는다", () => {
    const route = source("src/app/api/runs/[runId]/execute/route.ts");

    expect(route).toMatch(/requireLearnerAccess\(/);
    expect(route).toMatch(/getOwnedRun\(/);
    expect(route).toMatch(/start\(executePersistentRunWorkflow/);
    expect(route).toMatch(/workflowRunId:\s*workflowRun\.runId/);
  });
});
