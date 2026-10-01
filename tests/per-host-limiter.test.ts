import { describe, it, expect } from "vitest";
import { __test__ } from "@/lib/scraper/http";

const { MAX_PER_HOST, acquireHostSlot, getHostSemaphore, withHostSlot } = __test__;

describe("per-host concurrency limiter (P2.2)", () => {
  it("limits concurrent slots per host to MAX_PER_HOST", async () => {
    // Use a unique host per test to get a fresh semaphore.
    const host = `test-limit-${Date.now()}.example.com`;

    // Acquire MAX_PER_HOST slots — they should all succeed immediately.
    const releases: Array<() => void> = [];
    for (let i = 0; i < MAX_PER_HOST; i++) {
      const release = await acquireHostSlot(host);
      releases.push(release);
    }

    // Verify the semaphore shows the expected active count.
    const sem = getHostSemaphore(host);
    expect(sem.active).toBe(MAX_PER_HOST);
    expect(sem.queue).toHaveLength(0);

    // Acquiring one more slot should NOT resolve immediately.
    // We use a race: acquire + a timeout to verify it stays pending.
    let extraSlotAcquired = false;
    const extraPromise = acquireHostSlot(host).then((release) => {
      extraSlotAcquired = true;
      release();
    });

    // Yield to microtasks — if the extra slot was acquired, the flag flips.
    await new Promise((r) => setTimeout(r, 20));
    expect(extraSlotAcquired).toBe(false);
    expect(sem.queue).toHaveLength(1);

    // Release one slot — the queued request should now resolve.
    releases[0]();
    await extraPromise;
    expect(extraSlotAcquired).toBe(true);

    // Clean up remaining slots.
    for (let i = 1; i < releases.length; i++) releases[i]();
  });

  it("isolates per host — concurrent slots on different hosts don't block", async () => {
    const host1 = `test-isolate-1-${Date.now()}.example.com`;
    const host2 = `test-isolate-2-${Date.now()}.example.com`;

    // Fill both hosts to MAX_PER_HOST
    const releases1: Array<() => void> = [];
    const releases2: Array<() => void> = [];
    for (let i = 0; i < MAX_PER_HOST; i++) {
      releases1.push(await acquireHostSlot(host1));
      releases2.push(await acquireHostSlot(host2));
    }

    // Trying to acquire on host1 should block.
    let blocked1Resolved = false;
    const blocked1 = acquireHostSlot(host1).then((r) => { blocked1Resolved = true; r(); });

    // Trying to acquire on host2 should ALSO block (because it's also full).
    let blocked2Resolved = false;
    const blocked2 = acquireHostSlot(host2).then((r) => { blocked2Resolved = true; r(); });

    await new Promise((r) => setTimeout(r, 20));
    expect(blocked1Resolved).toBe(false);
    expect(blocked2Resolved).toBe(false);

    // Release one slot on host1 — only blocked1 should resolve.
    releases1[0]();
    await new Promise((r) => setTimeout(r, 20));
    expect(blocked1Resolved).toBe(true);
    expect(blocked2Resolved).toBe(false);

    // Release one slot on host2 — blocked2 should resolve now.
    releases2[0]();
    await new Promise((r) => setTimeout(r, 20));
    expect(blocked2Resolved).toBe(true);

    // Cleanup
    for (let i = 1; i < releases1.length; i++) releases1[i]();
    for (let i = 1; i < releases2.length; i++) releases2[i]();
  });

  it("withHostSlot executes fn and releases the slot", async () => {
    const host = `test-wrapper-${Date.now()}.example.com`;
    const result = await withHostSlot(host, async () => {
      return "ok";
    });
    expect(result).toBe("ok");
    // After completion, the slot should be released (active=0)
    const sem = getHostSemaphore(host);
    expect(sem.active).toBe(0);
  });

  it("withHostSlot releases the slot even if fn throws", async () => {
    const host = `test-throw-${Date.now()}.example.com`;
    await expect(
      withHostSlot(host, async () => { throw new Error("boom"); })
    ).rejects.toThrow("boom");
    // Slot must still be released.
    const sem = getHostSemaphore(host);
    expect(sem.active).toBe(0);
  });
});
