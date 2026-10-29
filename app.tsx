import { useLayoutEffect } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useSdk,
  useSidebarSplitLayout,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { z } from "zod";
import { mountHeaderButtons, revealRow } from "./header-button";
import { planExpansion, preferencesSchema, type RevealThread } from "./reveal-state";
import "./app.css";

function useContext() {
  return {
    ...useBbContext(),
    sdk: useSdk(),
    sidebar: experimental_useSidebarThreads(),
    layout: useSidebarSplitLayout(),
    navigate: useBbNavigate(),
  };
}
type Context = ReturnType<typeof useContext>;
let context: Context | null = null;
let reconcile: (() => void) | null = null;
let invoke: ((threadId: string) => void) | null = null;

function ContextBridge() {
  const current = useContext();
  useLayoutEffect(() => {
    context = current;
    reconcile?.();
    return () => { if (context === current) context = null; };
  });
  return null;
}

async function loadChain(current: Context, threadId: string, signal: AbortSignal): Promise<RevealThread[]> {
  const byId = new Map(current.sidebar.threads.map((thread) => [thread.id, thread]));
  const chain: RevealThread[] = [];
  const seen = new Set<string>();
  let id: string | null = threadId;
  while (id !== null && !seen.has(id)) {
    signal.throwIfAborted();
    seen.add(id);
    const cached = byId.get(id);
    let thread: RevealThread;
    if (cached) {
      thread = {
        ...cached,
        environmentId: cached.environment?.id ?? null,
        hostId: cached.host?.id ?? null,
      };
    } else {
      const result = await current.sdk.threads.get({ threadId: id, include: "environment", signal });
      const value = result;
      const environment = "environment" in result ? result.environment : null;
      thread = {
        id: value.id, projectId: value.projectId, parentThreadId: value.parentThreadId,
        sectionId: value.sectionId, environmentId: value.environmentId,
        hostId: environment?.hostId ?? null,
        isPinned: value.pinnedAt !== null, isArchived: value.archivedAt !== null,
        isHidden: value.visibility === "hidden",
      };
    }
    chain.push(thread);
    id = thread.parentThreadId;
  }
  return chain;
}

async function reveal(doc: Document, current: Context, threadId: string, signal: AbortSignal): Promise<void> {
  if (current.threadId === null) current.navigate.toThread(threadId, { split: true });
  const trigger = doc.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]');
  if (trigger?.getAttribute("aria-expanded") === "false") trigger.click();
  const [response, chain] = await Promise.all([
    current.sdk.plugins.callRpc({
      pluginId: "thread-list", method: "listPreferences", input: null,
      outputSchema: preferencesSchema, signal,
    }),
    loadChain(current, threadId, signal),
  ]);
  signal.throwIfAborted();
  const personalProjectId = current.sidebar.projects.find((project) => project.isPersonal)?.id ?? null;
  const changes = planExpansion(response.preferences, chain, personalProjectId);
  for (const change of changes) {
    signal.throwIfAborted();
    await current.sdk.plugins.callRpc({
      pluginId: "thread-list", method: "setPreference", input: change,
      outputSchema: z.object({ key: z.string(), value: z.array(z.string()) }), signal,
    });
  }
  const row = await revealRow(doc, chain.map((thread) => thread.id), signal);
  signal.throwIfAborted();
  if (!row) throw new Error("Не удалось показать тред в текущем списке. Фильтры и группировка сохранены.");
  row.setAttribute("data-thread-reveal-highlight", "");
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "context", component: ContextBridge });
  app.commands.register({
    id: "reveal-current-thread",
    title: "Показать текущий тред в списке",
    defaultShortcut: { key: "l", mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => { if (threadId) invoke?.(threadId); },
  });
  app.contentScripts.register({
    id: "reveal-thread",
    mount: ({ signal }) => {
      let operation: AbortController | null = null;
      let highlightTimer: ReturnType<typeof setTimeout>;
      const clearHighlight = () => {
        clearTimeout(highlightTimer);
        document.querySelectorAll("[data-thread-reveal-highlight]").forEach((element) => element.removeAttribute("data-thread-reveal-highlight"));
      };
      const run = (threadId: string) => {
        if (!context || signal.aborted) return;
        operation?.abort();
        operation = new AbortController();
        const activeSignal = operation.signal;
        clearHighlight();
        void reveal(document, context, threadId, activeSignal).then(() => {
          highlightTimer = setTimeout(clearHighlight, 1800);
        }, (error: unknown) => {
          if (!activeSignal.aborted) toast.error(error instanceof Error ? error.message : "Не удалось показать тред в списке.");
        });
      };
      const buttons = mountHeaderButtons(document, signal, (header) => {
        const paneId = header.closest<HTMLElement>("[data-split-pane-id]")?.dataset.splitPaneId;
        return paneId && context?.layout
          ? context?.layout?.panes.find((pane) => pane.paneId === paneId)?.threadId ?? null
          : context?.threadId ?? null;
      }, run);
      reconcile = buttons.reconcile;
      invoke = run;
      const dispose = () => {
        operation?.abort();
        clearHighlight();
        buttons.dispose();
        if (invoke === run) invoke = null;
        if (reconcile === buttons.reconcile) reconcile = null;
        signal.removeEventListener("abort", dispose);
      };
      signal.addEventListener("abort", dispose, { once: true });
      return dispose;
    },
  });
});
