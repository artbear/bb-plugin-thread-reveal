import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountHeaderButtons, revealRow } from './header-button.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const header = (id) => `<div data-split-pane-id="${id}"><header><div data-testid="app-page-header-content-row"><div><div><div><p>${id}</p></div><span>Menu</span></div></div><div data-thread-header-workflow-actions></div></div></header></div>`;

function setup(t, html) {
  const dom = new JSDOM(html);
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = dom.window.MutationObserver;
  const controller = new dom.window.AbortController();
  t.after(() => {
    controller.abort();
    globalThis.MutationObserver = previous;
    dom.window.close();
  });
  return { doc: dom.window.document, controller, dom };
}

test('places the button immediately after each title, resolves its own pane and survives redraws', async (t) => {
  const { doc, controller } = setup(t, header('one') + header('two'));
  const calls = [];
  let revision = 1;
  const buttons = mountHeaderButtons(doc, controller.signal,
    (node) => `${node.closest('[data-split-pane-id]').dataset.splitPaneId}-${revision}`,
    (id) => calls.push(id));
  assert.equal(doc.querySelectorAll('[data-thread-reveal-button]').length, 2);
  for (const title of doc.querySelectorAll('p')) {
    assert(title.parentElement.nextElementSibling.matches('[data-thread-reveal-button]'));
    title.parentElement.nextElementSibling.click();
  }
  assert.deepEqual(calls, ['one-1', 'two-1']);
  revision = 2;
  const detached = doc.querySelector('[data-thread-reveal-button]');
  doc.querySelector('[data-split-pane-id="one"]').outerHTML = header('one');
  await settle();
  buttons.reconcile();
  assert.equal(doc.querySelectorAll('[data-thread-reveal-button]').length, 2);
  doc.querySelector('[data-thread-reveal-button]').click();
  assert.equal(calls.at(-1), 'one-2');
  controller.abort();
  detached.click();
  doc.body.insertAdjacentHTML('beforeend', header('three'));
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(doc.querySelectorAll('[data-thread-reveal-button]').length, 0);
});

test('expands a parent through the native disclosure when unread grouping holds it closed', async (t) => {
  const { doc, controller } = setup(t,
    '<div data-sidebar-rename-row><a href="#parent" data-sidebar-thread-id="parent">Parent</a><button data-sidebar-rename-anchor aria-expanded="false">Expand</button></div>');
  let scrolled = false;
  doc.querySelector('button').onclick = () => {
    doc.querySelector('button').setAttribute('aria-expanded', 'true');
    doc.body.insertAdjacentHTML('beforeend', '<a href="#target" data-sidebar-thread-id="target">Target</a>');
    doc.querySelector('[data-sidebar-thread-id="target"]').scrollIntoView = () => { scrolled = true; };
  };
  const row = await revealRow(doc, ['target', 'parent'], controller.signal);
  assert.equal(row?.dataset.sidebarThreadId, 'target');
  assert.equal(doc.activeElement, row);
  assert.equal(scrolled, true);
});

test('realizes a virtualized row before focusing it', async (t) => {
  const { doc, controller } = setup(t, '<div data-sidebar-windowed-nav="other:p target:p"></div>');
  doc.querySelector('div').scrollIntoView = () => {
    doc.querySelector('div').removeAttribute('data-sidebar-windowed-nav');
    doc.body.insertAdjacentHTML('beforeend', '<a href="#target" data-sidebar-thread-id="target">Target</a>');
    doc.querySelector('a').scrollIntoView = () => {};
  };
  assert.equal((await revealRow(doc, ['target'], controller.signal))?.dataset.sidebarThreadId, 'target');
});

test('does not confuse a closed actions menu with a collapsed ancestor', async (t) => {
  const { doc, controller } = setup(t,
    '<div data-sidebar-rename-row><a href="#root" data-sidebar-thread-id="root">Root</a><button data-sidebar-rename-anchor aria-expanded="true">Collapse</button><button data-thread-actions-trigger aria-expanded="false">Menu</button></div>' +
    '<div data-sidebar-rename-row><a href="#parent" data-sidebar-thread-id="parent">Parent</a><button data-sidebar-rename-anchor aria-expanded="false">Expand</button></div>');
  doc.querySelector('[data-thread-actions-trigger]').onclick = () => assert.fail('The menu must stay closed');
  doc.querySelector('[data-sidebar-thread-id="parent"]').parentElement.querySelector('button').onclick = () => {
    doc.body.insertAdjacentHTML('beforeend', '<a href="#target" data-sidebar-thread-id="target">Target</a>');
    doc.querySelector('[data-sidebar-thread-id="target"]').scrollIntoView = () => {};
  };
  assert.equal((await revealRow(doc, ['target', 'parent', 'root'], controller.signal))?.dataset.sidebarThreadId, 'target');
});

test('cancels pending positioning when the plugin is unloaded', async (t) => {
  const { doc, controller } = setup(t, '');
  const result = revealRow(doc, ['missing'], controller.signal);
  controller.abort();
  assert.equal(await result, null);
});

test('waits for the mobile drawer to open before positioning and focusing', async (t) => {
  const { doc, controller } = setup(t,
    '<div data-sidebar="panel" data-state="closed" inert><a href="#target" data-sidebar-thread-id="target">Target</a></div>');
  const panel = doc.querySelector('div');
  doc.querySelector('a').scrollIntoView = () => assert.equal(panel.dataset.state, 'open');
  const result = revealRow(doc, ['target'], controller.signal);
  panel.dataset.state = 'open';
  panel.removeAttribute('inert');
  assert.equal(doc.activeElement, doc.body);
  const row = await result;
  assert.equal(doc.activeElement, row);
});
