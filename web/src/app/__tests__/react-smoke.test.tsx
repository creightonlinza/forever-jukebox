import { describe, expect, it } from "vitest";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";

describe("react tooling", () => {
  it("renders in jsdom via the tsx environment glob", () => {
    render(
      <StrictMode>
        <div data-testid="smoke">hello</div>
      </StrictMode>,
    );
    expect(screen.getByTestId("smoke").textContent).toBe("hello");
  });
});
