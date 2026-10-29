export const BUTTON_LABEL = "Показать тред в списке";
const BUTTON = "data-thread-reveal-button";
const HEADERS = '[data-thread-header-workflow-actions]';

export function mountHeaderButtons(
  doc: Document,
  signal: AbortSignal,
  resolveThreadId: (header: HTMLElement) => string | null,
  reveal: (threadId: string) => void,
): { reconcile: () => void; dispose: () => void } {
  const buttons = new Map<HTMLElement, HTMLButtonElement>();
  const reconcile = () => {
    if (signal.aborted) return;
    for (const [header, button] of buttons) {
      if (!header.isConnected || !resolveThreadId(header)) {
        button.remove();
        buttons.delete(header);
      }
    }
    for (const actions of doc.querySelectorAll<HTMLElement>(HEADERS)) {
      const header = actions.closest("header");
      if (!header || !resolveThreadId(header)) continue;
      const title = header.querySelector('[data-testid="app-page-header-content-row"] p')?.parentElement;
      if (!title) continue;
      let button = buttons.get(header);
      if (!button) {
        button = doc.createElement("button");
        button.type = "button";
        button.className = "bb-thread-reveal-button";
        button.setAttribute(BUTTON, "");
        button.setAttribute("aria-label", BUTTON_LABEL);
        button.title = BUTTON_LABEL;
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.8");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M9 5h11M9 12h11M9 19h11M2 9l3 3-3 3");
        svg.append(path);
        button.append(svg);
        button.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal });
        button.addEventListener("dblclick", (event) => event.stopPropagation(), { signal });
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const threadId = resolveThreadId(header);
          if (threadId) reveal(threadId);
        }, { signal });
        buttons.set(header, button);
      }
      if (title.nextElementSibling !== button) title.after(button);
    }
  };
  const observer = new MutationObserver(reconcile);
  const dispose = () => {
    observer.disconnect();
    for (const button of buttons.values()) button.remove();
    buttons.clear();
    signal.removeEventListener("abort", dispose);
  };
  if (!signal.aborted) {
    observer.observe(doc.body, { childList: true, subtree: true });
    signal.addEventListener("abort", dispose, { once: true });
    reconcile();
  }
  return { reconcile, dispose };
}

export function revealRow(
  doc: Document,
  threadIds: readonly string[],
  signal: AbortSignal,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    const finish = (row: HTMLElement | null) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(row);
    };
    const abort = () => finish(null);
    const check = () => {
      if (signal.aborted) return finish(null);
      const rows = Array.from(doc.querySelectorAll<HTMLElement>("a[data-sidebar-thread-id]"));
      const row = rows.find((element) => element.dataset.sidebarThreadId === threadIds[0]);
      if (row && !row.closest('[inert], [data-sidebar="panel"][data-state="closed"]')) {
        row.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        row.focus({ preventScroll: true });
        return finish(row);
      }
      for (const id of threadIds.slice(1).reverse()) {
        const ancestor = rows.find((element) => element.dataset.sidebarThreadId === id);
        const toggle = ancestor?.closest("[data-sidebar-rename-row]")
          ?.querySelector<HTMLButtonElement>('button[data-sidebar-rename-anchor][aria-expanded="false"]');
        if (toggle && !toggle.disabled) {
          toggle.click();
          break;
        }
      }
      const placeholder = Array.from(doc.querySelectorAll<HTMLElement>("[data-sidebar-windowed-nav]"))
        .find((element) => element.dataset.sidebarWindowedNav?.split(" ")
          .some((entry) => threadIds.includes(entry.split(":")[0])));
      placeholder?.scrollIntoView({ block: "center", behavior: "instant" });
      if (Date.now() - started >= 3000) return finish(null);
      timer = setTimeout(check, 50);
    };
    signal.addEventListener("abort", abort, { once: true });
    check();
  });
}
