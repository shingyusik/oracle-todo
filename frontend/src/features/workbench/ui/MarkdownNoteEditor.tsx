import * as React from "react";
import { Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownNoteEditorProps = {
  value: string;
  onChange: (value: string) => void;
};

export function MarkdownNoteEditor({ value, onChange }: MarkdownNoteEditorProps): React.JSX.Element {
  const [isEditing, setIsEditing] = React.useState(false);

  if (isEditing) {
    return (
      <textarea
        autoFocus
        className="markdown-note-input"
        aria-label="Markdown note"
        value={value}
        onBlur={() => setIsEditing(false)}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  function beginEditing() {
    setIsEditing(true);
  }

  return (
    <div className="markdown-note-rendered">
      <div className="markdown-note-surface" onClick={beginEditing}>
        {value ? (
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
            {value}
          </ReactMarkdown>
        ) : (
          <p className="markdown-note-placeholder">Write a note with Markdown…</p>
        )}
      </div>
      <button
        type="button"
        className="markdown-note-edit-button"
        aria-label="Edit Markdown note"
        onClick={beginEditing}
      >
        <Pencil aria-hidden="true" size={16} />
      </button>
    </div>
  );
}
