/**
 * bind.js — Tiny template renderer with DOM morphing.
 *
 * html`...`  — tagged template (identity fn so IDE / Tailwind IntelliSense sees classes).
 * mount(el, templateFn, actions) — reactive DOM morph + event delegation via data-action.
 */

import { effect } from './signals.js';

/**
 * Tagged template — identity function.
 * Exists solely so IDEs treat the literal as HTML and apply IntelliSense.
 */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += String(vals[i] ?? '') + strings[i + 1];
  return out;
}

// ── Lightweight DOM morph ──────────────────────────────────────────────────

/**
 * Reconcile `existing` element's children with those parsed from `newHtml`.
 * Elements matched by `id` (or position) are patched in-place instead of
 * replaced, preserving DOM identity (important for Playwright stability &
 * focus/selection state).
 */
function morph(existing, newHtml) {
  const tpl = document.createElement('template');
  tpl.innerHTML = newHtml;
  morphChildren(existing, tpl.content);
}

function morphChildren(parent, incoming) {
  const oldKids = [...parent.childNodes];
  const newKids = [...incoming.childNodes];

  // Build id→element map for the *incoming* nodes
  const newById = new Map();
  for (const n of newKids) if (n.id) newById.set(n.id, n);

  // Build id→element map for existing nodes
  const oldById = new Map();
  for (const n of oldKids) if (n.id) oldById.set(n.id, n);

  let oi = 0;

  for (let ni = 0; ni < newKids.length; ni++) {
    const inc = newKids[ni];

    // Try to find a matching existing node (by id, then by position)
    let match = inc.id ? oldById.get(inc.id) : null;
    if (!match && oi < oldKids.length) match = oldKids[oi];

    if (match && canMorph(match, inc)) {
      // Ensure the matched node is in the right position
      if (match !== parent.childNodes[ni]) {
        parent.insertBefore(match, parent.childNodes[ni] || null);
      }
      morphNode(match, inc);
      if (match === oldKids[oi]) oi++;
    } else {
      parent.insertBefore(inc.cloneNode(true), parent.childNodes[ni] || null);
    }
  }

  // Remove leftover old nodes
  while (parent.childNodes.length > newKids.length) {
    parent.removeChild(parent.lastChild);
  }
}

function canMorph(a, b) {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName;
}

function morphNode(existing, incoming) {
  if (existing.nodeType === Node.TEXT_NODE || existing.nodeType === Node.COMMENT_NODE) {
    if (existing.nodeValue !== incoming.nodeValue) {
      existing.nodeValue = incoming.nodeValue;
    }
    return;
  }
  if (existing.nodeType !== Node.ELEMENT_NODE) return;

  // Sync attributes
  const oldAttrs = existing.attributes;
  const newAttrs = incoming.attributes;

  // Update / add attributes
  for (let i = 0; i < newAttrs.length; i++) {
    const { name, value } = newAttrs[i];
    if (existing.getAttribute(name) !== value) {
      existing.setAttribute(name, value);
    }
  }
  // Remove stale attributes
  for (let i = oldAttrs.length - 1; i >= 0; i--) {
    if (!incoming.hasAttribute(oldAttrs[i].name)) {
      existing.removeAttribute(oldAttrs[i].name);
    }
  }

  // Recurse into children
  morphChildren(existing, incoming);
}

// ── Mount ──────────────────────────────────────────────────────────────────

/**
 * Mount a reactive template into a container element.
 *
 * @param {HTMLElement} el           Container element
 * @param {() => string} templateFn  Returns HTML string (reads signals → auto-tracked)
 * @param {Object} [actions]         Map of action names → handler(event, targetElement)
 */
export function mount(el, templateFn, actions = {}) {
  // Event delegation — single click listener on the container
  el.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || !el.contains(target)) return;
    const name = target.dataset.action;
    if (actions[name]) actions[name](e, target);
  });

  // Reactive render — uses DOM morphing to preserve element identity.
  // First render is innerHTML for speed; subsequent renders morph in-place.
  let first = true;

  effect(() => {
    const markup = templateFn();          // read signals → auto-tracked
    if (first) {
      el.innerHTML = markup;              // first paint — fast
      first = false;
    } else {
      morph(el, markup);                  // patch in-place
    }
  });
}
