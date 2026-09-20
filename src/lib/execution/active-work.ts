const activeByUser = new Map<string, Set<AbortController>>();

/** 현재 서버 인스턴스에서 진행 중인 사용자 작업을 등록한다. */
export function registerActiveWork(userId: string, controller: AbortController): () => void {
  const active = activeByUser.get(userId) ?? new Set<AbortController>();
  active.add(controller);
  activeByUser.set(userId, active);

  return () => {
    active.delete(controller);
    if (active.size === 0) activeByUser.delete(userId);
  };
}

/** 등록된 작업을 모두 중단하고 실제 중단 신호를 보낸 개수를 반환한다. */
export function cancelActiveWorkForUser(userId: string): number {
  const active = activeByUser.get(userId);
  if (!active) return 0;

  let cancelled = 0;
  for (const controller of active) {
    if (!controller.signal.aborted) {
      controller.abort();
      cancelled += 1;
    }
  }
  activeByUser.delete(userId);
  return cancelled;
}

/** 스트림 종료·취소 어느 쪽에서도 등록을 해제한다. */
export function cleanupStream<T>(stream: ReadableStream<T>, cleanup: () => void): ReadableStream<T> {
  const reader = stream.getReader();
  let cleaned = false;
  const finish = () => {
    if (cleaned) return;
    cleaned = true;
    cleanup();
  };

  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
}
