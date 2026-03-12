/**
 * bind.js — One-shot template renderer + event delegation.
 *
 * html`...`  — tagged template (identity fn so IDE / Tailwind IntelliSense sees classes).
 * mount(el, markup, actions) — one-time innerHTML + click delegation via data-action.
 *
 * Reactivity is handled OUTSIDE mount by individual effect() calls that
 * directly patch the DOM (toggle .hidden, set .src, etc.).  This keeps
 * elements permanently in the tree — no morph, no innerHTML churn, no
 * element-detachment issues with automated tests or MutationObserver.
 */

/**
 * Tagged template — identity function.
 * Exists solely so IDEs treat the literal as HTML and apply IntelliSense.
 */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += String(vals[i] ?? '') + strings[i + 1];
  return out;
}

/**
 * Mount a static template into a container and wire up event delegation.
 *
 * @param {HTMLElement} el        Container element
 * @param {string}      markup    HTML string (rendered once)
 * @param {Object}      [actions] Map of action names → handler(event, targetElement)
 */
export function mount(el, markup, actions = {}) {
  el.innerHTML = markup;

  el.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || !el.contains(target)) return;
    const name = target.dataset.action;
    if (actions[name]) actions[name](e, target);
  });
}
