import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  type Cluster,
  type SharedState,
  currentDaemon,
  focusDaemon,
  getState,
  pull,
  resetStore,
  setPersistence,
  setState,
  startDaemon,
} from "./store.ts";

function cluster(name: string): Cluster {
  return { id: name, name, color: "#3b82f6", projects: [`host:x:/${name}`] };
}

/** A daemon that answers with its own id and remembers every write it is sent. */
function fakeDaemon(serverId: string, stored: SharedState | null) {
  const writes: SharedState[] = [];
  return {
    writes,
    get stored() {
      return stored;
    },
    sync: {
      read: async () => ({ serverId, state: stored }),
      write: async (next: SharedState) => {
        stored = next;
        writes.push(next);
      },
    },
  };
}

/** Lets the reads started by `startDaemon` settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => resetStore());

test("an empty daemon stays empty while another connected daemon has clusters", async () => {
  const memory = new Map<string, string>();
  setPersistence({ read: (key) => memory.get(key) ?? null, write: (key, value) => void memory.set(key, value) });

  const mine = fakeDaemon("mine", { clusters: [cluster("work")], revision: 7 });
  const theirs = fakeDaemon("theirs", null);
  const a = startDaemon(mine.sync, { pollMs: 0 });
  const b = startDaemon(theirs.sync, { pollMs: 0 });
  await settle();

  // Several rounds: the empty daemon must not inherit the other one's clusters at any point.
  for (let i = 0; i < 3; i += 1) {
    await pull(a);
    await pull(b);
  }

  assert.deepEqual(
    getState(a).clusters.map((c) => c.name),
    ["work"],
  );
  assert.deepEqual(getState(b).clusters, []);
  assert.deepEqual(theirs.writes, [], "the empty daemon was written to");
  assert.equal(theirs.stored, null, "the empty daemon's file gained clusters");

  // Each daemon caches under its own key, so neither can read the other's copy.
  assert.ok(memory.has("paseo-clusters:v1:mine"));
  assert.equal(memory.get("paseo-clusters:v1:theirs"), undefined);
});

test("the sidebar shows the clusters of the daemon being viewed", async () => {
  setPersistence(null);
  const mine = fakeDaemon("mine", { clusters: [cluster("work")], revision: 1 });
  const theirs = fakeDaemon("theirs", { clusters: [cluster("client")], revision: 1 });
  const a = startDaemon(mine.sync, { pollMs: 0 });
  const b = startDaemon(theirs.sync, { pollMs: 0 });
  await settle();

  focusDaemon(a);
  assert.deepEqual(
    getState(currentDaemon()).clusters.map((c) => c.name),
    ["work"],
  );
  focusDaemon(b);
  assert.deepEqual(
    getState(currentDaemon()).clusters.map((c) => c.name),
    ["client"],
  );
});

test("an edit reaches only the daemon it was made on", async () => {
  setPersistence(null);
  const mine = fakeDaemon("mine", { clusters: [], revision: 1 });
  const theirs = fakeDaemon("theirs", null);
  const a = startDaemon(mine.sync, { pollMs: 0 });
  const b = startDaemon(theirs.sync, { pollMs: 0 });
  await settle();

  setState(a, { ...getState(a), clusters: [cluster("work")] });
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(mine.writes.length, 1);
  assert.deepEqual(
    mine.writes[0].clusters.map((c) => c.name),
    ["work"],
  );
  assert.deepEqual(theirs.writes, []);
  assert.deepEqual(getState(b).clusters, []);
});

test("a daemon that goes quiet leaves nothing behind for the next one", async () => {
  const memory = new Map<string, string>();
  setPersistence({ read: (key) => memory.get(key) ?? null, write: (key, value) => void memory.set(key, value) });

  const mine = fakeDaemon("mine", { clusters: [cluster("work")], revision: 2 });
  const a = startDaemon(mine.sync, { pollMs: 0 });
  await settle();
  assert.equal(getState(a).clusters.length, 1);
  resetStore();

  // A different daemon connecting later starts from its own (absent) cache, not from the last one.
  setPersistence({ read: (key) => memory.get(key) ?? null, write: (key, value) => void memory.set(key, value) });
  const theirs = fakeDaemon("theirs", null);
  const b = startDaemon(theirs.sync, { pollMs: 0 });
  await settle();
  assert.deepEqual(getState(b).clusters, []);
  assert.deepEqual(theirs.writes, []);
});
