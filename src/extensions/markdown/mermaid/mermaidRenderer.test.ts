import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Window } from "happy-dom";
import { installDomEnvironment } from "../../../test/domEnvironment";

let testWindow: Window;

before(() => {
  testWindow = installDomEnvironment();
});

after(async () => {
  await testWindow.close();
});

describe("renderMermaid", () => {
  test("语法错误不会向页面 body 泄漏 Mermaid 临时错误图", async () => {
    const { renderMermaid } = await import("./mermaidRenderer");
    const bodyBeforeRender = document.body.innerHTML;

    await assert.rejects(renderMermaid("invalid-mermaid", "graph TD\n  A -->"));

    assert.equal(document.body.innerHTML, bodyBeforeRender);
    assert.doesNotMatch(document.body.textContent ?? "", /Syntax error in text/u);
  });
});
