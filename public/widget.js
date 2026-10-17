/*!
 * Grey chat widget — <script src="https://…/widget.js" data-widget="<widget id>" async></script>
 * Vanilla, no build. Renders a bubble + panel in a Shadow DOM, streams answers over SSE and
 * shows citations as title/page labels. The API origin comes from this script's own URL.
 */
(function () {
  "use strict";

  var script = document.currentScript || document.querySelector('script[data-widget][src*="widget.js"]');
  if (!script) return;
  var widgetId = script.getAttribute("data-widget");
  var registry = (window.__greyWidgets = window.__greyWidgets || {});
  if (!widgetId || registry[widgetId]) return;
  registry[widgetId] = true;

  var scriptUrl = new URL(script.src, window.location.href);
  var api = scriptUrl.origin + scriptUrl.pathname.replace(/\/widget\.js$/, "") + "/api/widget/" + encodeURIComponent(widgetId);
  var storeKey = "grey:" + widgetId + ":";

  function load(name) {
    try { return window.localStorage.getItem(storeKey + name); } catch (e) { return null; }
  }
  function save(name, value) {
    try {
      if (value) window.localStorage.setItem(storeKey + name, value);
      else window.localStorage.removeItem(storeKey + name);
    } catch (e) { /* storage blocked: keep the value in memory only */ }
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  var visitorId = load("visitor") || uuid();
  save("visitor", visitorId);
  var conversationId = load("conversation");

  var ICON_CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  var ICON_RESET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

  var CSS =
    ":host{all:initial}*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}" +
    ".root{position:fixed;bottom:20px;z-index:2147483000;--bg:#fff;--fg:#18181b;--muted:#71717a;--line:#e4e4e7;--soft:#f4f4f5}" +
    "@media (prefers-color-scheme:dark){.root{--bg:#18181b;--fg:#fafafa;--muted:#a1a1aa;--line:#3f3f46;--soft:#27272a}}" +
    ".root.right{right:20px}.root.left{left:20px}" +
    "svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
    "button{cursor:pointer;border:0;background:none;color:inherit;padding:0;display:inline-flex;align-items:center;justify-content:center}" +
    "button:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    ".bubble{width:52px;height:52px;border-radius:999px;background:var(--accent);color:var(--on-accent);box-shadow:0 8px 24px rgba(0,0,0,.18)}" +
    ".bubble svg{width:22px;height:22px}" +
    ".panel{position:absolute;bottom:66px;width:min(380px,calc(100vw - 40px));height:min(560px,calc(100vh - 110px));display:none;flex-direction:column;" +
    "background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.2)}" +
    ".right .panel{right:0}.left .panel{left:0}.open .panel{display:flex}" +
    ".head{display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--accent);color:var(--on-accent)}" +
    ".head .title{flex:1;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".head button{width:28px;height:28px;border-radius:8px;opacity:.85}.head button:hover{opacity:1;background:rgba(255,255,255,.12)}" +
    ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}" +
    ".msg{max-width:85%;padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
    ".bot{align-self:flex-start;background:var(--soft)}.me{align-self:flex-end;background:var(--accent);color:var(--on-accent)}" +
    ".err{align-self:flex-start;color:#dc2626;font-size:13px}" +
    ".cites{display:flex;flex-wrap:wrap;gap:6px;margin-top:-4px;max-width:85%}" +
    ".cite{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:2px 8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".typing{color:var(--muted)}" +
    "form{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;border-top:1px solid var(--line)}" +
    "textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:14px;line-height:1.4;max-height:120px;background:var(--bg);color:var(--fg)}" +
    ".send{width:36px;height:36px;border-radius:10px;background:var(--accent);color:var(--on-accent)}.send:disabled{opacity:.5;cursor:default}" +
    ".foot{padding:6px;text-align:center;font-size:10px;color:var(--muted);border-top:1px solid var(--line)}";

  // Light accents get dark text (hex only; other color syntaxes keep white).
  function onAccent(color) {
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color || "");
    if (!m) return "#fafafa";
    var hex = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    var n = parseInt(hex, 16);
    var lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? "#18181b" : "#fafafa";
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function citationLabel(c) {
    var where = [];
    if (c.page !== null && c.page !== undefined) where.push("p. " + c.page);
    if (c.startMs !== null && c.startMs !== undefined) {
      var s = Math.floor(c.startMs / 1000);
      where.push(Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"));
    }
    return "[" + c.index + "] " + (c.title || "Source") + (where.length ? " — " + where.join(" · ") : "");
  }

  function mount(config) {
    var host = document.createElement("div");
    host.setAttribute("data-grey-widget", widgetId);
    var shadow = host.attachShadow({ mode: "open" });
    var accent = config.accent || "#18181b";
    shadow.innerHTML = "<style>" + CSS + "</style>";

    var root = el("div", "root " + (config.position === "left" ? "left" : "right"));
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--on-accent", onAccent(accent));

    var panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", config.title || "Chat");
    var head = el("div", "head");
    head.appendChild(el("div", "title", config.title || "Chat with us"));
    var reset = el("button");
    reset.innerHTML = ICON_RESET;
    reset.setAttribute("aria-label", "Start a new conversation");
    reset.title = "New conversation";
    var close = el("button");
    close.innerHTML = ICON_X;
    close.setAttribute("aria-label", "Close chat");
    head.appendChild(reset);
    head.appendChild(close);

    var log = el("div", "log");
    log.setAttribute("aria-live", "polite");
    var form = el("form");
    var input = el("textarea");
    input.rows = 1;
    input.maxLength = 2000;
    input.placeholder = config.placeholder || "Type your question…";
    input.setAttribute("aria-label", "Message");
    var send = el("button", "send");
    send.type = "submit";
    send.innerHTML = ICON_SEND;
    send.setAttribute("aria-label", "Send");
    form.appendChild(input);
    form.appendChild(send);

    panel.appendChild(head);
    panel.appendChild(log);
    panel.appendChild(form);
    if (!config.whiteLabel) panel.appendChild(el("div", "foot", "Powered by Grey"));

    var bubble = el("button", "bubble");
    bubble.innerHTML = ICON_CHAT;
    bubble.setAttribute("aria-label", "Open chat");
    bubble.setAttribute("aria-expanded", "false");

    root.appendChild(panel);
    root.appendChild(bubble);
    shadow.appendChild(root);
    document.body.appendChild(host);

    var busy = false;
    function greet() {
      log.textContent = "";
      if (config.greeting) log.appendChild(el("div", "msg bot", config.greeting));
    }
    function scroll() { log.scrollTop = log.scrollHeight; }
    function toggle(open) {
      root.classList.toggle("open", open);
      bubble.setAttribute("aria-expanded", String(open));
      bubble.innerHTML = open ? ICON_X : ICON_CHAT;
      bubble.setAttribute("aria-label", open ? "Close chat" : "Open chat");
      if (open) setTimeout(function () { input.focus(); }, 0);
    }
    function showCitations(list) {
      if (!list || !list.length) return;
      var row = el("div", "cites");
      list.forEach(function (c) {
        var chip = el("span", "cite", citationLabel(c));
        chip.title = chip.textContent;
        row.appendChild(chip);
      });
      log.appendChild(row);
      scroll();
    }

    // Reads the SSE body: meta / delta / done / error events.
    function readStream(res, bubbleEl) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var started = false;
      function handle(event, data) {
        if (event === "meta" && data.conversationId) {
          conversationId = data.conversationId;
          save("conversation", conversationId);
        } else if (event === "delta") {
          if (!started) { bubbleEl.textContent = ""; bubbleEl.classList.remove("typing"); started = true; }
          bubbleEl.textContent += data.text || "";
          scroll();
        } else if (event === "done") {
          if (!started) { bubbleEl.classList.remove("typing"); }
          showCitations(data.citations);
        } else if (event === "error") {
          if (!started) bubbleEl.remove();
          log.appendChild(el("div", "err", data.message || "Something went wrong."));
          scroll();
        }
      }
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });
          var frames = buffer.split("\n\n");
          buffer = frames.pop();
          frames.forEach(function (frame) {
            var event = "message";
            var data = "";
            frame.split("\n").forEach(function (line) {
              if (line.indexOf("event:") === 0) event = line.slice(6).trim();
              else if (line.indexOf("data:") === 0) data += line.slice(5).trim();
            });
            if (!data) return;
            try { handle(event, JSON.parse(data)); } catch (e) { /* ignore malformed frames */ }
          });
          return pump();
        });
      }
      return pump();
    }

    function ask(message, retried) {
      var reply = el("div", "msg bot typing", "…");
      log.appendChild(reply);
      scroll();
      return fetch(api + "/chat", {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message, visitorId: visitorId, conversationId: conversationId || null }),
      }).then(function (res) {
        if (res.ok && res.body) return readStream(res, reply);
        return res.json().catch(function () { return {}; }).then(function (body) {
          reply.remove();
          if (res.status === 409 && body.error === "conversation_limit" && !retried) {
            conversationId = null;
            save("conversation", null);
            return ask(message, true);
          }
          var text = res.status === 429 ? "You're sending messages too quickly. Please wait a moment." : body.message || "Something went wrong.";
          log.appendChild(el("div", "err", text));
          scroll();
        });
      }).catch(function () {
        reply.remove();
        log.appendChild(el("div", "err", "Couldn't reach the assistant. Check your connection and try again."));
        scroll();
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var message = input.value.trim();
      if (!message || busy) return;
      busy = true;
      send.disabled = true;
      input.value = "";
      log.appendChild(el("div", "msg me", message));
      scroll();
      ask(message, false).then(function () {
        busy = false;
        send.disabled = false;
        input.focus();
      });
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && root.classList.contains("open")) toggle(false);
    });
    bubble.addEventListener("click", function () { toggle(!root.classList.contains("open")); });
    close.addEventListener("click", function () { toggle(false); });
    reset.addEventListener("click", function () {
      if (busy) return;
      conversationId = null;
      save("conversation", null);
      greet();
    });
    greet();
  }

  function start() {
    fetch(api + "/config", { mode: "cors", credentials: "omit" })
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(mount)
      .catch(function (error) {
        if (window.console) console.warn("[grey-widget] not shown:", error && error.message);
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
