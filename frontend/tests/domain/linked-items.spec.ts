import { describe, expect, it } from "vitest";

import { linkedItemGroups } from "@/features/workbench/model/linked-items";

describe("linkedItemGroups", () => {
  const area = { id: "area-1", type: "area", title: "Health", status: "active" };

  it("groups only direct Area children by supported type", () => {
    const groups = linkedItemGroups(area, [
      { id: "project-1", type: "project", title: "Checkup", status: "active", area_id: "area-1" },
      { id: "task-1", type: "task", title: "Book", status: "active", area_id: "area-1" },
      { id: "task-2", type: "task", title: "Indirect", status: "active", project_id: "project-1" },
    ]);

    expect(groups.map((group) => [group.type, group.items.map((item) => item.id)])).toEqual([
      ["project", ["project-1"]],
      ["task", ["task-1"]],
    ]);
  });

  it("maps project, routine, and goal to their direct relation field", () => {
    expect(linkedItemGroups(
      { id: "project-1", type: "project", title: "Checkup", status: "active" },
      [
        { id: "routine-1", type: "routine", title: "Prepare", status: "active", project_id: "project-1" },
        { id: "task-1", type: "task", title: "Book", status: "active", project_id: "project-1" },
        { id: "event-1", type: "event", title: "Visit", status: "active", project_id: "project-1" },
      ],
    ).map((group) => group.type)).toEqual(["routine", "task", "event"]);

    expect(linkedItemGroups(
      { id: "routine-1", type: "routine", title: "Stretch", status: "active" },
      [{ id: "task-1", type: "task", title: "Do", status: "active", routine_id: "routine-1" }],
    )[0]?.type).toBe("task");

    expect(linkedItemGroups(
      { id: "goal-1", type: "goal", title: "Fitness", status: "active" },
      [{ id: "goal-2", type: "goal", title: "Run", status: "active", parent_id: "goal-1" }],
    )[0]?.type).toBe("goal");
  });

  it("returns no groups for Task and Event", () => {
    expect(linkedItemGroups(
      { id: "task-1", type: "task", title: "Book", status: "active" },
      [{ id: "task-2", type: "task", title: "Child", status: "active", parent_id: "task-1" }],
    )).toEqual([]);
    expect(linkedItemGroups(
      { id: "event-1", type: "event", title: "Visit", status: "active" },
      [{ id: "task-1", type: "task", title: "Follow-up", status: "active", project_id: "event-1" }],
    )).toEqual([]);
  });

  it("excludes a malformed self-referencing child", () => {
    expect(linkedItemGroups(
      { id: "area-1", type: "area", title: "Health", status: "active", area_id: "area-1" },
      [{ id: "area-1", type: "project", title: "Invalid", status: "active", area_id: "area-1" }],
    )).toEqual([]);
  });
});
