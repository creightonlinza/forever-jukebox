import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isEditableTarget } from "./editableTarget";

class MockElement {
  tagName: string;
  isContentEditable: boolean;

  constructor(tagName: string, isContentEditable = false) {
    this.tagName = tagName;
    this.isContentEditable = isContentEditable;
  }
}

describe("isEditableTarget", () => {
  const originalHTMLElement = (globalThis as any).HTMLElement;

  beforeEach(() => {
    (globalThis as any).HTMLElement = MockElement;
  });

  afterEach(() => {
    (globalThis as any).HTMLElement = originalHTMLElement;
  });

  it("detects editable targets", () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(new MockElement("DIV") as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(new MockElement("INPUT") as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(new MockElement("SPAN", true) as unknown as EventTarget)).toBe(true);
  });
});
