import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownNoteEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function MarkdownNoteEditor({ value, onChange }: MarkdownNoteEditorProps): React.JSX.Element {
  const [editingLine, setEditingLine] = React.useState<number | null>(null);
  const lines = value.split("\n");

  function updateLine(index: number, nextLine: string) {
    onChange(
      lines.map((line, lineIndex) => (lineIndex === index ? nextLine : line)).join("\n"),
    );
  }

  function insertLineAfter(index: number) {
    const nextLines = [...lines];
    nextLines.splice(index + 1, 0, "");
    onChange(nextLines.join("\n"));
    setEditingLine(index + 1);
  }

  return (
    <div className="markdown-note-rendered">
      {lines.map((line, index) =>
        editingLine === index ? (
          <textarea
            key={index}
            autoFocus
            rows={1}
            className="markdown-note-input"
            aria-label={`Markdown note line ${index + 1}`}
            value={line}
            onBlur={() => setEditingLine(null)}
            onChange={(event) => updateLine(index, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                insertLineAfter(index);
              }
            }}
          />
        ) : (
          <div
            key={index}
            className={`markdown-note-surface markdown-note-line${
              /^- \[[xX]\](?:\s|$)/.test(line) ? " markdown-note-line--checked" : ""
            }`}
            role="button"
            tabIndex={0}
            onClick={() => setEditingLine(index)}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                setEditingLine(index);
              }
            }}
          >
            {(() => {
              const markerOnlyTask = /^- \[([ xX])\]$/.exec(line);
              if (markerOnlyTask) {
                return (
                  <input
                    type="checkbox"
                    checked={markerOnlyTask[1].toLowerCase() === "x"}
                    disabled
                  />
                );
              }
              if (!line) {
                return (
                  <p className="markdown-note-placeholder">Write a note with Markdown…</p>
                );
              }
              return (
                <ReactMarkdown
                  skipHtml
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a({ node: _node, onClick, ...props }) {
                      return (
                        <a
                          {...props}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(event) => {
                            event.stopPropagation();
                            onClick?.(event);
                          }}
                        />
                      );
                    },
                  }}
                >
                  {line}
                </ReactMarkdown>
              );
            })()}
          </div>
        ),
      )}
    </div>
  );
}
