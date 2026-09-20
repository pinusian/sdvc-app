import { describe, expect, it, vi } from "vitest";
import {
  cancelActiveWorkForUser,
  cleanupStream,
  registerActiveWork,
} from "@/lib/execution/active-work";

describe("[T020] 활성 작업 중단", () => {
  it("같은 수강생의 활성 작업만 모두 중단한다", () => {
    const first = new AbortController();
    const second = new AbortController();
    const other = new AbortController();
    registerActiveWork("learner-1", first);
    registerActiveWork("learner-1", second);
    const unregisterOther = registerActiveWork("learner-2", other);

    expect(cancelActiveWorkForUser("learner-1")).toBe(2);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
    unregisterOther();
  });

  it("정상 종료된 스트림은 활성 작업 등록을 해제할 수 있다", async () => {
    const controller = new AbortController();
    const unregister = registerActiveWork("learner-3", controller);
    const cleanup = vi.fn(unregister);
    const stream = cleanupStream(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode("완료"));
          streamController.close();
        },
      }),
      cleanup,
    );

    expect(await new Response(stream).text()).toBe("완료");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(cancelActiveWorkForUser("learner-3")).toBe(0);
  });
});
