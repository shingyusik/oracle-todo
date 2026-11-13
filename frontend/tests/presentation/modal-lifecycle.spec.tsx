import "@testing-library/jest-dom/vitest";
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useModalIsolation } from "@/features/workbench/ui/modal-lifecycle";

function Dialog({ label }: { label: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useModalIsolation(ref, true, "body");
  return <div ref={ref} role="dialog" aria-label={label} />;
}

describe("useModalIsolation", () => {
  it("restores the page behind two dialogs that close in the same commit", () => {
    const page = document.createElement("main");
    document.body.append(page);
    document.body.style.overflow = "";
    const view = render(<><Dialog label="outer" /><Dialog label="inner" /></>);
    expect(page).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");

    view.unmount();
    expect(page).not.toHaveAttribute("inert");
    expect(page).not.toHaveAttribute("aria-hidden");
    expect(document.body.style.overflow).toBe("");
    page.remove();
  });

  it("keeps the page locked until the last of two overlapping dialogs closes", () => {
    const page = document.createElement("main");
    document.body.append(page);
    const first = render(<Dialog label="first" />);
    const second = render(<Dialog label="second" />);
    first.unmount();
    expect(page).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    second.unmount();
    expect(page).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    page.remove();
  });
});
