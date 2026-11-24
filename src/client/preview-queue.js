export function createPreviewQueue(limit) {
  const queue = [];
  let active = 0;

  function pump() {
    while (active < limit && queue.length) {
      const job = queue.shift();
      if (job.signal.aborted) continue;
      active++;
      void job.run().finally(() => { active--; pump(); });
    }
  }

  return function enqueue(signal, run) {
    const job = { signal, run };
    queue.push(job);
    pump();
    return () => {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
    };
  };
}
