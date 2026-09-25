import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Select } from "./Select";

it("keeps the selected value and accessible name without native menu styling", () => {
  const onChange = vi.fn();
  const html = renderToStaticMarkup(createElement(Select, { label: "Provider", value: "a", onChange,
    options: [{ value: "a", label: "Selected provider" }, { value: "b", label: "Disabled provider", disabled: true }] }));
  expect(html).toContain('role="combobox"');
  expect(html).toContain('aria-label="Provider"');
  expect(html).toContain("Selected provider");
  expect(html).toContain("la-dropdown-trigger");
  expect(onChange).not.toHaveBeenCalled();
});

it("represents an explicit empty default without auto-selecting another model", () => {
  const html = renderToStaticMarkup(createElement(Select, { label: "Model", value: "", onChange: vi.fn(),
    options: [{ value: "", label: "CLI default" }, { value: "model-a", label: "Model A" }] }));
  expect(html).toContain("CLI default");
  expect(html).not.toContain(">Model A</");
});

it("disables empty inventories and keeps unavailable selections visible", () => {
  const empty = renderToStaticMarkup(createElement(Select, { label: "Provider", value: "", onChange: vi.fn(), options: [], placeholder: "No providers found" }));
  expect(empty).toContain('disabled=""');
  expect(empty).toContain("No providers found");
  const unavailable = renderToStaticMarkup(createElement(Select, { label: "Model", value: "old", onChange: vi.fn(), disabled: true,
    options: [{ value: "old", label: "Saved model", disabled: true, detail: "Unavailable" }] }));
  expect(unavailable).toContain("Saved model");
  expect(unavailable).toContain('disabled=""');
});
