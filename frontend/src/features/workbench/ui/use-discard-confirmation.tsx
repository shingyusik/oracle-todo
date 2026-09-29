"use client";

import React from "react";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";

export function useDiscardConfirmation(fallbackFocusRef: React.RefObject<HTMLElement>) {
  const dirty = React.useRef(false);
  const [action, setAction] = React.useState<(() => void) | null>(null);
  const onDirtyChange = React.useCallback((value: boolean) => { dirty.current = value; }, []);

  function requestDiscard(nextAction: () => void) {
    if (dirty.current) setAction(() => nextAction);
    else nextAction();
  }

  const discardConfirmation = action ? (
    <DestructiveConfirmationDialog
      inline
      title="Discard unsaved changes?"
      description="Your input will be lost. Cancel to keep editing."
      confirmLabel="Discard"
      fallbackFocusRef={fallbackFocusRef}
      onCancel={() => setAction(null)}
      onConfirm={async () => {
        setAction(null);
        action();
      }}
    />
  ) : null;

  return { onDirtyChange, requestDiscard, discardConfirmation };
}
