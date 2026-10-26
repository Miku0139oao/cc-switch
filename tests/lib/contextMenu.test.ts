import { afterEach, describe, expect, it } from "vitest";
import { initializeContextMenuGuard } from "@/lib/contextMenu";

let dispose: (() => void) | undefined;

function dispatchContextMenu(target: Element): boolean {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("context menu guard", () => {
  it("suppresses WebView menus on ordinary chrome", () => {
    dispose = initializeContextMenuGuard();
    document.body.innerHTML = "<div><span id='label'>Provider</span></div>";
    expect(dispatchContextMenu(document.getElementById("label")!)).toBe(true);
  });

  it("keeps native menus on editable and copyable content", () => {
    dispose = initializeContextMenuGuard();
    document.body.innerHTML = `
      <input id="input" />
      <textarea id="textarea"></textarea>
      <div id="editable" contenteditable="true"></div>
      <pre id="pre"></pre>
      <code id="code"></code>
      <div class="selectable" id="selectable"><span id="child">copy</span></div>
    `;
    for (const id of ["input", "textarea", "editable", "pre", "code", "child"]) {
      expect(dispatchContextMenu(document.getElementById(id)!)).toBe(false);
    }
  });

  it("keeps the menu when text is selected", () => {
    dispose = initializeContextMenuGuard();
    document.body.innerHTML = "<div id='text'>selected</div>";
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("text")!);
    window.getSelection()?.addRange(range);
    expect(dispatchContextMenu(document.getElementById("text")!)).toBe(false);
  });
});
