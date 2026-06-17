import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MATERIAL_SYMBOL_ICON_NAMES,
  MATERIAL_SYMBOL_ICON_NAMES_PARAM,
} from "./material-icons";

describe("material icon font subset", () => {
  it("keeps the icon allowlist sorted and unique", () => {
    const sorted = [...MATERIAL_SYMBOL_ICON_NAMES].sort();
    expect(MATERIAL_SYMBOL_ICON_NAMES).toEqual(sorted);
    expect(new Set(MATERIAL_SYMBOL_ICON_NAMES).size).toBe(
      MATERIAL_SYMBOL_ICON_NAMES.length,
    );
  });

  it("uses the allowlist in the Google Fonts request", () => {
    const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const match = html.match(
      /https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined[^"]+/,
    );
    expect(match).not.toBeNull();

    const url = new URL(match![0]);
    expect(url.searchParams.get("icon_names")).toBe(
      MATERIAL_SYMBOL_ICON_NAMES_PARAM,
    );
    expect(url.searchParams.get("display")).toBe("block");
    expect(url.searchParams.get("family")).toBe(
      "Material Symbols Outlined:opsz,wght,FILL,GRAD@20..30,300..350,0..1,0",
    );
  });
});
