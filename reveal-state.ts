import { z } from "zod";

const ids = z.array(z.string());
export const preferencesSchema = z.object({
  preferences: z.object({
    organizationMode: z.enum(["project", "chronological", "machine"]),
    threadLifecycles: z.array(z.enum(["active", "archived"])),
    hiddenGroups: ids,
    collapsedProjects: ids,
    collapsedSections: ids,
    collapsedThreadSections: ids,
    collapsedMachines: ids,
    collapsedEnvironments: ids,
    collapsedThreads: ids,
  }),
});

export type Preferences = z.infer<typeof preferencesSchema>["preferences"];
export type CollapseKey = {
  [K in keyof Preferences]: K extends `collapsed${string}` ? K : never;
}[keyof Preferences];

export interface RevealThread {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  sectionId: string | null;
  environmentId: string | null;
  hostId: string | null;
  isPinned: boolean;
  isArchived: boolean;
  isHidden: boolean;
}

export function planExpansion(
  preferences: Preferences,
  chain: readonly RevealThread[],
  personalProjectId: string | null,
): { key: CollapseKey; value: string[] }[] {
  const target = chain[0];
  const root = chain.at(-1);
  if (!target || !root) throw new Error("Не удалось определить тред.");
  const pinned = chain.some((thread) => thread.isPinned);
  const mode = preferences.organizationMode;
  const group = pinned
    ? "pinned"
    : mode === "machine"
      ? `machine:${target.hostId ?? "no-machine"}`
      : mode === "project" && root.projectId !== personalProjectId
        ? `project:${root.projectId}`
        : mode === "chronological" && root.sectionId
          ? `section:${root.sectionId}`
          : "threads";
  const lifecycle = target.isArchived ? "archived" : "active";
  if (
    target.isHidden ||
    !preferences.threadLifecycles.includes(lifecycle) ||
    preferences.hiddenGroups.includes(group)
  ) {
    throw new Error("Тред скрыт текущими фильтрами или настройками видимости списка. Настройки сохранены.");
  }
  const remove: Record<CollapseKey, Set<string>> = {
    collapsedThreads: new Set(chain.slice(1).map((thread) => thread.id)),
    collapsedEnvironments: new Set(chain.flatMap((thread) => thread.environmentId ? [thread.environmentId] : [])),
    collapsedProjects: new Set(),
    collapsedMachines: new Set(),
    collapsedSections: new Set(),
    collapsedThreadSections: new Set(),
  };
  if (group === "pinned" || group === "threads") remove.collapsedSections.add(group);
  else if (mode === "machine") remove.collapsedMachines.add(target.hostId ?? "no-machine");
  else if (mode === "project") remove.collapsedProjects.add(root.projectId);
  if (!pinned && mode !== "machine" && root.sectionId) {
    remove.collapsedThreadSections.add(`${mode === "chronological" ? "chronological" : root.projectId}::${root.sectionId}`);
  }
  const changes: { key: CollapseKey; value: string[] }[] = [];
  for (const key of Object.keys(remove) as CollapseKey[]) {
    const value = preferences[key].filter((id) => !remove[key].has(id));
    if (value.length !== preferences[key].length) changes.push({ key, value });
  }
  return changes;
}
