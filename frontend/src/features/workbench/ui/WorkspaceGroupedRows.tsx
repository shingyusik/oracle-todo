import React from "react";

import type { WorkspaceViewGroup } from "@/features/workbench/model/workspace-table-views";
import type { WorkspaceItemModel } from "@/features/workbench/model/workbench-model";

export function WorkspaceGroupedRows({
  groups,
  renderRow,
  emptyMessage,
  bodyClassName,
  columnCount,
}: {
  groups: WorkspaceViewGroup[];
  renderRow(item: WorkspaceItemModel): React.ReactNode;
  emptyMessage: string;
  bodyClassName?: string;
  columnCount: number;
}): React.ReactElement {
  if (groups.length === 0) {
    return (
      <tbody className={bodyClassName}>
        <tr className="workspace-table-empty-row">
          <td className="items-message workspace-table-empty-cell" colSpan={columnCount}>
            {emptyMessage}
          </td>
        </tr>
      </tbody>
    );
  }

  if (groups.length === 1 && groups[0]?.key === "all") {
    return <tbody className={bodyClassName}>{groups[0].items.map(renderRow)}</tbody>;
  }

  return (
    <>
      {groups.map((group) => (
        <tbody
          aria-label={`${group.label} group`}
          className={bodyClassName}
          key={group.key}
        >
          <tr className="workspace-group-heading">
            <th scope="rowgroup" colSpan={columnCount}>
              {group.label}
            </th>
          </tr>
          {group.items.map(renderRow)}
        </tbody>
      ))}
    </>
  );
}
