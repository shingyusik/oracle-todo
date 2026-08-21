import type {
  PlannerFilterOperator,
  PlannerFilterValue,
} from "@/features/workbench/model/planner-model";
import type { JsonObject } from "@/lib/raven-api";

export function tableFilterValue(
  value: PlannerFilterValue,
  operator: PlannerFilterOperator,
): JsonObject {
  if (operator === "is_empty" || operator === "is_not_empty") return { empty: true };
  if (Array.isArray(value)) return { list: value };
  if (value && typeof value === "object") {
    return "start" in value
      ? { range: { start: value.start, end: value.end } }
      : { relative: { amount: value.amount, unit: value.unit } };
  }
  return { text: value ?? "" };
}
