"use client";

import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function parseTagInput(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
}

export function formatTags(tags: readonly string[] | null | undefined): string {
  return (tags ?? []).join(", ");
}

export function TagsInput({
  label,
  value,
  tagOptions,
  onCommit,
  propagateEscape = false,
  portalDropdown = false,
  disabled = false,
}: {
  label: string;
  value: readonly string[] | null | undefined;
  tagOptions: readonly string[];
  onCommit: (value: string[]) => void;
  propagateEscape?: boolean;
  portalDropdown?: boolean;
  disabled?: boolean;
}): React.ReactNode {
  const currentTags = React.useMemo(() => parseTagInput(formatTags(value)), [value]);
  const availableTags = React.useMemo(
    () => tagOptions.filter((tag) => !currentTags.includes(tag)),
    [currentTags, tagOptions],
  );
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const listboxId = React.useId();
  const [dropdownStyle, setDropdownStyle] = React.useState<React.CSSProperties>();
  const normalizedDraft = draft.trim().toLowerCase();
  const filteredTags = availableTags.filter((tag) =>
    tag.toLowerCase().includes(normalizedDraft),
  );

  React.useEffect(() => {
    setDraft("");
  }, [currentTags]);

  React.useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  React.useLayoutEffect(() => {
    if (!open || !portalDropdown) return;

    const updatePosition = () => {
      if (triggerRef.current && dropdownRef.current) {
        setDropdownStyle(dropdownPosition(triggerRef.current, dropdownRef.current));
      }
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, portalDropdown]);

  function commitTags(tags: string[]) {
    const normalizedTags = parseTagInput(formatTags(tags));
    if (formatTags(normalizedTags) !== formatTags(value)) {
      onCommit(normalizedTags);
    }
  }

  function commitDraft() {
    const draftTags = parseTagInput(draft);
    setDraft("");
    if (draftTags.length > 0) {
      commitTags([...currentTags, ...draftTags]);
    }
  }

  function closeDropdown() {
    commitDraft();
    setOpen(false);
  }

  React.useEffect(() => {
    if (!open || !portalDropdown) return;

    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (triggerRef.current?.contains(event.target) || dropdownRef.current?.contains(event.target)) {
        return;
      }
      closeDropdown();
    };

    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open, portalDropdown, currentTags, draft]);

  const dropdown = (
    <div
      ref={dropdownRef}
      className="tag-dropdown"
      style={portalDropdown ? { ...dropdownStyle, zIndex: 110 } : undefined}
      onClick={stopEvent}
    >
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-controls={listboxId}
        aria-expanded="true"
        aria-autocomplete="list"
        placeholder="Search for an option..."
        value={draft}
        onKeyDown={(event) => {
          if (event.key === "Escape" && propagateEscape) {
            return;
          }
          stopEvent(event);
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
          }
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            commitDraft();
          }
        }}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div
        id={listboxId}
        className="tag-option-list"
        role="listbox"
        aria-label={`${label} options`}
      >
        {filteredTags.map((tag) => (
          <button
            key={tag}
            type="button"
            role="option"
            aria-selected="false"
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              stopEvent(event);
              commitTags([...currentTags, tag]);
              setDraft("");
            }}
          >
            <span className="tag-chip">{tag}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div
      className="tag-combobox"
      onBlur={(event) => {
        if (portalDropdown) return;
        if (!event.currentTarget.contains(event.relatedTarget)) {
          closeDropdown();
        }
      }}
    >
      <div className="tag-input">
        {currentTags.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag} tag`}
              onClick={(event) => {
                stopEvent(event);
                commitTags(currentTags.filter((currentTag) => currentTag !== tag));
              }}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </span>
        ))}
        <button
          ref={triggerRef}
          type="button"
          className="tag-input-trigger"
          aria-label={label}
          aria-haspopup="listbox"
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          disabled={disabled}
          onClick={(event) => {
            stopEvent(event);
            setOpen(true);
          }}
        >Add</button>
      </div>
      {open ? (portalDropdown ? createPortal(dropdown, document.body) : dropdown) : null}
    </div>
  );
}

function stopEvent(event: React.SyntheticEvent<HTMLElement>) {
  event.stopPropagation();
}

function dropdownPosition(trigger: HTMLElement, dropdown: HTMLElement): React.CSSProperties {
  const viewportMargin = 16;
  const offset = 4;
  const triggerRect = trigger.getBoundingClientRect();
  const dropdownRect = dropdown.getBoundingClientRect();
  const width = Math.min(
    dropdownRect.width || 320,
    Math.max(0, window.innerWidth - viewportMargin * 2),
  );
  const dropdownHeight = dropdownRect.height || dropdown.scrollHeight || 0;
  const belowSpace = Math.max(0, window.innerHeight - viewportMargin - triggerRect.bottom - offset);
  const aboveSpace = Math.max(0, triggerRect.top - viewportMargin - offset);
  const placeAbove = belowSpace < dropdownHeight && aboveSpace > belowSpace;
  const availableHeight = placeAbove ? aboveSpace : belowSpace;
  const renderedHeight = Math.min(dropdownHeight, Math.max(1, availableHeight || dropdownHeight));
  const maxLeft = Math.max(viewportMargin, window.innerWidth - viewportMargin - width);
  const left = clamp(triggerRect.left, viewportMargin, maxLeft);
  const rawTop = placeAbove
    ? triggerRect.top - offset - renderedHeight
    : triggerRect.bottom + offset;
  const maxTop = Math.max(viewportMargin, window.innerHeight - viewportMargin - renderedHeight);
  const top = clamp(rawTop, viewportMargin, maxTop);

  return {
    position: "fixed",
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.max(0, Math.round(availableHeight))}px`,
    overflowY: "auto",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
