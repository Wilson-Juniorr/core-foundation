import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const user = {
  id: "10000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "piloto@example.invalid",
  app_metadata: {},
  user_metadata: {},
};
const contact = {
  id: "10000000-0000-4000-8000-000000000002",
  user_id: user.id,
  name: "Cliente Piloto",
  phone: "+5511000000000",
  email: null,
  source: null,
  notes: null,
  is_archived: false,
  created_at: "2026-11-12T12:00:00Z",
  updated_at: "2026-11-12T12:00:00Z",
};
const sale = {
  id: "10000000-0000-4000-8000-000000000003",
  user_id: user.id,
  contact_id: contact.id,
  title: "Plano família",
  status: "won",
  pipeline_stage_id: "10000000-0000-4000-8000-000000000004",
  post_sale_version: 0,
  post_sale_stage: null,
  post_sale_due_on: null,
  post_sale_effective_on: null,
  post_sale_note: null,
  created_at: contact.created_at,
  updated_at: contact.updated_at,
  estimated_value: 1000,
  notes: null,
  contacts: { id: contact.id, name: contact.name },
  pipeline_stages: { name: "Fechamento" },
  next_action_at: null,
  next_action_description: null,
};
let timeline = [];
let patchCount = 0;
const exp = Math.floor(Date.now() / 1000) + 1800;
const encode = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp, role: user.role, aud: user.aud })}.eA`;
const session = {
  access_token: token,
  refresh_token: "local-test",
  token_type: "bearer",
  expires_at: exp,
  expires_in: 1800,
  user,
};

// This fixture serves only synthetic CRM data, with no provider or production credentials.
const db = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:14997");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer",
  );
  res.setHeader("access-control-expose-headers", "content-range");
  res.setHeader("content-type", "application/json");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === "/auth/v1/user") {
    res.end(JSON.stringify(user));
    return;
  }
  const table = url.pathname.split("/").at(-1);
  let rows = [];
  if (table === "contacts") rows = [contact];
  if (table === "opportunities") {
    if (req.method === "PATCH") {
      assert.equal(url.searchParams.get("user_id"), `eq.${user.id}`);
      assert.equal(url.searchParams.get("contact_id"), `eq.${contact.id}`);
      assert.equal(url.searchParams.get("status"), "eq.won");
      const body = JSON.parse(
        await new Promise((resolve) => {
          let buf = "";
          req.on("data", (chunk) => {
            buf += chunk;
          });
          req.on("end", () => resolve(buf));
        }),
      );
      if (url.searchParams.get("post_sale_version") === `eq.${sale.post_sale_version}`) {
        Object.assign(sale, body);
        patchCount++;
      }
    }
    rows = url.searchParams.has("post_sale_due_on") && !sale.post_sale_due_on ? [] : [sale];
  }
  if (table === "timeline_events") {
    if (req.method === "POST") {
      timeline = [
        {
          id: "event-1",
          event_type: "post_sale_updated",
          created_at: contact.created_at,
          opportunity_id: sale.id,
          metadata: {},
        },
      ];
    }
    rows = timeline;
  }
  if (table === "whatsapp_connections") rows = [{ id: "whatsapp-test", status: "disconnected" }];
  if (table === "user_settings")
    rows = [
      { user_id: user.id, automation_paused: false, test_mode: true, require_approval_all: true },
    ];
  if (req.headers.prefer?.includes("count=exact"))
    res.setHeader("content-range", rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0");
  if (req.headers.accept?.includes("application/vnd.pgrst.object+json")) {
    res.end(JSON.stringify(rows[0] ?? null));
  } else {
    res.end(JSON.stringify(rows));
  }
});
await new Promise((resolve) => db.listen(14997, "127.0.0.1", resolve));

const root = "http://127.0.0.1:14996";
const mockSupabase = "http://127.0.0.1:14997";
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    "14996",
    "--strictPort",
  ],
  {
    env: {
      ...process.env,
      VITE_SUPABASE_URL: mockSupabase,
      VITE_SUPABASE_PUBLISHABLE_KEY: "local-test",
      VITE_SUPABASE_PROJECT_ID: "local-test",
      SUPABASE_URL: mockSupabase,
      SUPABASE_PUBLISHABLE_KEY: "local-test",
      SUPABASE_SERVICE_ROLE_KEY: "local-test",
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
const profile = await mkdtemp(join(tmpdir(), "pilot-chromium-"));
let browser;
let socket;
try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try {
      ready = (await fetch(`${root}/auth`)).ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(ready, "The local Vite server did not start");
  browser = spawn(
    process.env.CHROME_BIN || "google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--remote-debugging-port=14998",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  let launchError;
  browser.on("error", (error) => {
    launchError = error;
  });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    if (launchError) throw launchError;
    try {
      target = (await (await fetch("http://127.0.0.1:14998/json/list")).json()).find(
        (tab) => tab.type === "page",
      );
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(target, "Chromium did not start");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let seq = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === "Runtime.exceptionThrown")
      errors.push(response.params.exceptionDetails?.exception?.description);
    if (!pending.has(response.id)) return;
    const { resolve, reject } = pending.get(response.id);
    pending.delete(response.id);
    if (response.error) reject(new Error(response.error.message));
    else resolve(response.result);
  });
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const answer = await command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description);
    return answer.result.value;
  };
  async function waitFor(expression) {
    for (let i = 0; i < 120; i++) {
      if (await js(expression)) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(
      `Timed out for ${expression}. Browser: ${await js("document.body.innerText.slice(0, 1800)")}\n${errors.join("\n")}`,
    );
  }
  async function clickElement(expression) {
    const point = await js(`(() => {
      const element = ${expression};
      if (!element) return null;
      element.scrollIntoView({ block: "center" });
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    assert.ok(point, `Element was not found: ${expression}`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await command("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...point });
    }
  }
  const click = (selector) => clickElement(`document.querySelector(${JSON.stringify(selector)})`);
  const button = (label) =>
    clickElement(
      `[...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)})`,
    );
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Page.addScriptToEvaluateOnNewDocument", {
    source: `if (location.origin === ${JSON.stringify(root)}) localStorage.setItem("sb-127-auth-token", ${JSON.stringify(JSON.stringify(session))});`,
  });
  await command("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command("Page.navigate", { url: `${root}/clientes/${contact.id}` });
  await waitFor("document.body.innerText.includes('Plano família')");
  assert.equal(
    await js("document.querySelector('[role=tab][aria-selected=true]').textContent"),
    "Resumo",
  );
  assert.equal(await js("document.querySelectorAll('aside nav a').length"), 6);
  await button("Mais ferramentas");
  assert.equal(await js("document.querySelectorAll('aside nav a').length"), 11);
  await button("Mais ferramentas");
  await waitFor("document.body.innerText.includes('WhatsApp desconectado')");
  await waitFor("document.body.innerText.includes('Modo teste ativo')");
  await button("Pós-venda");
  await waitFor("document.body.innerText.includes('Iniciar pós-venda')");
  await button("Iniciar pós-venda");
  await waitFor("document.body.innerText.includes('Mesmo sem histórico do WhatsApp')");
  await js(`(() => {
    const input = document.querySelector('input[type=date]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '2024-01-15');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const notes = document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(notes, 'Aguardando retorno da operadora.');
    notes.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await button("Salvar pós-venda");
  await waitFor("document.body.innerText.includes('Conferir emissão em 15/01/2024')");
  assert.equal(patchCount, 1);
  assert.equal(sale.post_sale_note, "Aguardando retorno da operadora.");
  await button("Histórico");
  await waitFor("document.body.innerText.includes('Nenhuma conversa está vinculada')");
  await waitFor("document.body.innerText.includes('Pós-venda atualizado')");
  await click('aside a[href="/atencao"]');
  await waitFor("document.body.innerText.includes('Pós-vendas com prazo')");
  assert.ok(await js("document.body.innerText.includes('Cliente Piloto')"));
  await click('a[href*="aba=pos-venda"]');
  await waitFor("document.body.innerText.includes('Conferir emissão em 15/01/2024')");
  await command("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor("window.innerWidth === 375");
  assert.equal(await js("document.documentElement.scrollWidth"), 375);
  const mobileTrigger = 'button[aria-label="Abrir navegação"]';
  await waitFor(
    `document.querySelector(${JSON.stringify(mobileTrigger)})?.getBoundingClientRect().width > 0`,
  );
  await click(mobileTrigger);
  await waitFor(
    `document.querySelector('button[aria-label="Fechar navegação"]')?.getAttribute("aria-expanded") === "true"`,
  );
  await click('header nav a[href="/atencao"]');
  await waitFor("document.body.innerText.includes('Pós-vendas com prazo')");
  assert.equal(await js("document.documentElement.scrollWidth"), 375);
  console.log(
    "Chrome smoke passed: desktop and 375px, navigation, live warnings, no WhatsApp history, post-sale save, timeline, due reminder, deep link.",
  );
} finally {
  socket?.close();
  if (browser?.pid && browser.exitCode === null && browser.signalCode === null) {
    const exited = once(browser, "exit");
    browser.kill();
    await exited;
  }
  vite.kill();
  await new Promise((resolve) => db.close(resolve));
  await rm(profile, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
}
