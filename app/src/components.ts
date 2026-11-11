import { icons } from "./icons";
import { h } from "./ui";

/**
 * Segmented control. The selected pill snaps to its option (no slide: on small
 * toggles a glide reads as lag) and gives a small pop. Arrow keys move the selection
 * (roving tabindex). `kind` picks the semantics: "tabs" for switching views,
 * "radio" for picking an option.
 */
export class Segmented<T extends string> {
  el: HTMLElement;
  private indicator: HTMLElement;
  private buttons = new Map<T, HTMLButtonElement>();
  private value: T;

  constructor(
    label: string,
    options: { value: T; label: string; hint?: string; swatches?: string[] }[],
    value: T,
    onChange: (v: T) => void,
    opts: { kind?: "tabs" | "radio"; variant?: "nav" | "lens" | "plain"; size?: "sm" | "md" } = {},
  ) {
    const kind = opts.kind ?? "radio";
    this.value = value;
    this.el = h("div", {
      class: `seg seg--${opts.variant ?? "plain"} seg--${opts.size ?? "md"}`,
      role: kind === "tabs" ? "tablist" : "radiogroup",
      "aria-label": label,
    });
    this.indicator = h("span", { class: "seg__indicator", "aria-hidden": "true" });
    this.el.append(this.indicator);
    for (const o of options) {
      const b = h("button", {
        type: "button",
        class: "seg__btn",
        role: kind === "tabs" ? "tab" : "radio",
        ...(o.hint ? { title: o.hint } : {}),
      });
      if (o.swatches) {
        const sw = h("span", { class: "seg__swatches", "aria-hidden": "true" });
        for (const c of o.swatches) sw.append(h("i", { style: `background:var(${c})` }));
        b.append(sw);
      }
      b.append(h("span", {}, o.label));
      b.addEventListener("click", () => {
        this.set(o.value);
        onChange(o.value);
      });
      b.addEventListener("keydown", (ev) => {
        const keys = [...this.buttons.keys()];
        const i = keys.indexOf(o.value);
        const next = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
        if (!next) return;
        ev.preventDefault();
        const v = keys[(i + next + keys.length) % keys.length];
        this.set(v);
        this.buttons.get(v)!.focus();
        onChange(v);
      });
      this.buttons.set(o.value, b);
      this.el.append(b);
    }
    new ResizeObserver(() => this.place(false)).observe(this.el);
    this.set(value, false);
  }

  set(v: T, animate = true) {
    this.value = v;
    for (const [k, b] of this.buttons) {
      const on = k === v;
      b.setAttribute(b.getAttribute("role") === "tab" ? "aria-selected" : "aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    this.place(animate);
  }

  private place(animate: boolean) {
    const b = this.buttons.get(this.value);
    if (!b || !b.offsetWidth) return;
    const moved = this.indicator.style.left !== `${b.offsetLeft}px`;
    this.indicator.style.left = `${b.offsetLeft}px`;
    this.indicator.style.width = `${b.offsetWidth}px`;
    this.indicator.style.height = `${b.offsetHeight}px`;
    this.indicator.style.top = `${b.offsetTop}px`;
    if (animate && moved) {
      // Restart the pop on the newly selected pill.
      this.indicator.classList.remove("is-pop");
      void this.indicator.offsetWidth;
      this.indicator.classList.add("is-pop");
    }
  }
}

/** On/off switch (role="switch"). */
export function toggleSwitch(label: string, on: boolean, onChange: (v: boolean) => void, hint?: string): HTMLButtonElement {
  const b = h("button", { type: "button", class: "switch", role: "switch", "aria-checked": String(on), ...(hint ? { title: hint } : {}) },
    h("span", { class: "switch__track", "aria-hidden": "true" }, h("span", { class: "switch__thumb" })),
    h("span", { class: "switch__label" }, label));
  b.addEventListener("click", () => {
    const v = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(v));
    onChange(v);
  });
  return b;
}

/**
 * A native <select> dressed as an inline chip, for sentence-style filters.
 * Native keeps it accessible and gives phones their own picker.
 */
export function chipSelect(label: string, value: string, options: [string, string][], onChange: (v: string) => void, opts: { defaultValue?: string; tone?: "a" | "b" } = {}): HTMLElement {
  const sel = h("select", { "aria-label": label });
  for (const [v, t] of options) {
    const o = h("option", { value: v }, t);
    if (v === value) o.selected = true;
    sel.append(o);
  }
  const wrap = h("span", { class: `chip-select${opts.tone ? ` chip-select--${opts.tone}` : ""}` });
  const sync = () => wrap.classList.toggle("is-set", opts.defaultValue !== undefined && sel.value !== opts.defaultValue);
  sel.addEventListener("change", () => {
    sync();
    onChange(sel.value);
  });
  const chev = h("span", { class: "chip-select__chev", "aria-hidden": "true" });
  chev.innerHTML = icons.chevron;
  wrap.append(sel, chev);
  sync();
  return wrap;
}

/** Round or square icon button with an accessible name. */
export function iconButton(name: string, icon: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = h("button", { type: "button", class: `icon-btn ${cls}`.trim(), "aria-label": name, title: name });
  b.innerHTML = icon;
  b.addEventListener("click", onClick);
  return b;
}
