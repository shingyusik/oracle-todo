import type { PlannerGroupCandidate } from "@/features/workbench/model/planner-group-settings";
import { array, nonEmptyString, record, safeInteger, string } from "@/lib/raven-api";

export function mapTableGroups(value: unknown): PlannerGroupCandidate[] {
  const response = record(value, "table groups");
  return array(response.groups, "table groups.groups").map((value) => {
    const group = record(value, "table group");
    const count = safeInteger(group.count, "table group.count");
    if (count < 0) throw new TypeError("invalid table group.count");
    return { key: nonEmptyString(group.key, "table group.key"),
      label: string(group.label, "table group.label"), count };
  });
}
