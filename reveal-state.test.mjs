import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExpansion, preferencesSchema } from './reveal-state.ts';
import { experimental_scanPublicSdkOnly } from '@get-bb/plugin-sdk/testing';

function prefs(overrides = {}) {
  return {
    organizationMode: 'project', threadLifecycles: ['active'], hiddenGroups: [],
    collapsedProjects: [], collapsedSections: [], collapsedThreadSections: [],
    collapsedMachines: [], collapsedEnvironments: [], collapsedThreads: [],
    ...overrides,
  };
}
function thread(overrides = {}) {
  return {
    id: 'target', projectId: 'project', parentThreadId: null, sectionId: null,
    environmentId: 'env', hostId: 'host', isPinned: false, isArchived: false, isHidden: false,
    ...overrides,
  };
}

test('reveals a child under its root project and preserves unrelated groups, filters and sorting', () => {
  const preferences = prefs({
    collapsedProjects: ['other-project', 'root-project'],
    collapsedThreads: ['parent', 'other-thread', 'target'],
    collapsedEnvironments: ['env', 'parent-env', 'other-env'],
    collapsedThreadSections: ['root-project::section', 'other-project::section'],
    groupByReadStatus: true, chronologicalSort: 'alpha', sortDirection: 'ascending',
    sectionOrder: ['project:other-project', 'project:root-project'],
  });
  const before = structuredClone(preferences);
  const result = planExpansion(preferences, [
    thread({ parentThreadId: 'parent' }),
    thread({ id: 'parent', projectId: 'root-project', environmentId: 'parent-env', sectionId: 'section' }),
  ], 'personal');
  const after = { ...preferences, ...Object.fromEntries(result.map(({ key, value }) => [key, value])) };
  assert.deepEqual(preferences, before);
  assert.deepEqual(after, {
    ...before, collapsedProjects: ['other-project'], collapsedThreads: ['other-thread', 'target'],
    collapsedEnvironments: ['other-env'], collapsedThreadSections: ['other-project::section'],
  });
});

test('handles chronological sections and the personal-project Threads group', () => {
  assert.deepEqual(planExpansion(prefs({
    organizationMode: 'chronological',
    collapsedThreadSections: ['chronological::section', 'project::section'],
  }), [thread({ sectionId: 'section' })], 'personal'), [
    { key: 'collapsedThreadSections', value: ['project::section'] },
  ]);
  assert.deepEqual(planExpansion(prefs({ collapsedSections: ['threads', 'pinned'] }),
    [thread({ projectId: 'personal' })], 'personal'), [
    { key: 'collapsedSections', value: ['pinned'] },
  ]);
});

test('pinned ancestors reveal only the Pinned group and the required thread path', () => {
  assert.deepEqual(planExpansion(prefs({
    collapsedSections: ['pinned', 'threads'], collapsedProjects: ['project'],
  }), [thread({ parentThreadId: 'parent' }), thread({ id: 'parent', isPinned: true })], 'personal'), [
    { key: 'collapsedSections', value: ['threads'] },
  ]);
});

test('expands the selected machine including unassigned threads', () => {
  for (const hostId of ['host', null]) {
    const key = hostId ?? 'no-machine';
    assert.deepEqual(planExpansion(prefs({
      organizationMode: 'machine', collapsedMachines: [key, 'other'], collapsedProjects: ['project'],
    }), [thread({ hostId })], 'personal'), [{ key: 'collapsedMachines', value: ['other'] }]);
  }
});

test('keeps lifecycle and visibility filters intact when they exclude the thread', () => {
  for (const [preferences, target] of [
    [prefs(), thread({ isArchived: true })],
    [prefs({ threadLifecycles: ['archived'] }), thread()],
    [prefs({ hiddenGroups: ['project:project'] }), thread()],
    [prefs(), thread({ isHidden: true })],
  ]) {
    const before = structuredClone(preferences);
    assert.throws(() => planExpansion(preferences, [target], 'personal'), /скрыт/);
    assert.deepEqual(preferences, before);
  }
  assert.deepEqual(planExpansion(prefs({ threadLifecycles: ['active', 'archived'] }),
    [thread({ isArchived: true })], 'personal'), []);
});

test('validates the external preference contract before any write', () => {
  assert.throws(() => preferencesSchema.parse({ preferences: prefs({ collapsedThreads: 'bad' }) }));
  assert.throws(() => preferencesSchema.parse({ preferences: prefs({ organizationMode: 'unknown' }) }));
});

test('uses public SDK imports and no private BB dependencies', async () => {
  const result = await experimental_scanPublicSdkOnly(process.cwd(), { allow: [/^(jsdom|react|sonner)$/] });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.privateDependencies, []);
});
