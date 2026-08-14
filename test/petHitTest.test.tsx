// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isPetElement } from "../src/renderer/petHitTest";

afterEach(() => { document.body.innerHTML = ""; });

describe("isPetElement", () => {
  it("treats the pet element and its children as the pet", () => {
    document.body.innerHTML = `<main class="app"><div class="pet pet-idle"><img class="pet-img" /></div></main>`;
    expect(isPetElement(document.querySelector(".pet"))).toBe(true);
    expect(isPetElement(document.querySelector(".pet-img"))).toBe(true); // elementFromPoint often hits the img
  });

  it("excludes the bubble, permission card, Allow/Deny buttons and the background", () => {
    document.body.innerHTML = `
      <main class="app">
        <div class="pet-bubble">status</div>
        <div class="permission-card"><button class="allow">Allow</button></div>
        <div class="pet pet-idle"><img /></div>
      </main>`;
    expect(isPetElement(document.querySelector(".pet-bubble"))).toBe(false);
    expect(isPetElement(document.querySelector(".permission-card"))).toBe(false);
    expect(isPetElement(document.querySelector(".allow"))).toBe(false);
    expect(isPetElement(document.querySelector("main.app"))).toBe(false); // transparent background
    expect(isPetElement(null)).toBe(false); // elementFromPoint miss
  });
});
