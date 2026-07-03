/**
 * Custom station selector — an accessible listbox (open/close, focus,
 * keyboard navigation, ARIA) built from the hidden native <select>.
 * Station selection is reported through the onSelect callback.
 */

import { el, radioSelect, posterImage } from './dom';

export function initStationSelector({ onSelect }: { onSelect(index: number): void }): void {
  const new_selector_open_button = el<HTMLButtonElement>('new_selector__button');
  const new_selector_content = el<HTMLElement>('new_selector__content');
  const new_selector_button_example = el<HTMLButtonElement>('new_selector__button_example');
  const new_selector_parent = el<HTMLElement>('new_selector__parent');

  const radios = radioSelect.querySelectorAll('option');
  const selectorOptionButtons: HTMLButtonElement[] = [];
  let selectorFocusedIndex = radioSelect.selectedIndex;
  let selectorReturnFocusElement: HTMLElement = new_selector_open_button;
  const selectorTriggerButtons: HTMLElement[] = [new_selector_open_button, posterImage];

  function isSelectorOpen() {
    return !new_selector_content.classList.contains('hidden');
  }

  function syncSelectorSelection() {
    selectorOptionButtons.forEach((button, index) => {
      const isSelected = radioSelect.selectedIndex === index;
      const isFocused = selectorFocusedIndex === index;
      button.classList.toggle('bg-Red', isSelected);
      button.setAttribute('aria-selected', String(isSelected));
      button.tabIndex = isSelectorOpen() && isFocused ? 0 : -1;
    });
  }

  function focusOption(index: number) {
    if (!selectorOptionButtons.length) return;

    const lastIndex = selectorOptionButtons.length - 1;
    const nextIndex = Math.max(0, Math.min(index, lastIndex));

    selectorFocusedIndex = nextIndex;
    syncSelectorSelection();

    const button = selectorOptionButtons[selectorFocusedIndex];

    button.focus({
      preventScroll: true,
    });

    button.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }

  function setSelectorExpanded(isExpanded: boolean) {
    selectorTriggerButtons.forEach(el => {
      el.setAttribute('aria-expanded', String(isExpanded));
    });
  }

  function getCurrentSelectorIndex() {
    const index = radioSelect.selectedIndex;
    return index >= 0 && index < selectorOptionButtons.length ? index : 0;
  }

  function openSelector({ focusSelected = false, trigger = document.activeElement }: { focusSelected?: boolean; trigger?: Element | null } = {}) {
    if (trigger instanceof HTMLElement && selectorTriggerButtons.includes(trigger)) {
      selectorReturnFocusElement = trigger;
    }
    selectorFocusedIndex = getCurrentSelectorIndex();
    new_selector_content.classList.remove('hidden');
    setSelectorExpanded(true);
    syncSelectorSelection();
    if (focusSelected) {
      focusOption(selectorFocusedIndex);
    } else {
      selectorOptionButtons[selectorFocusedIndex]?.scrollIntoView({
        behavior: "auto",
        block: "nearest",
        inline: "nearest",
      });
    }
  }

  function closeSelector({ returnFocus = false, blurHiddenFocus = false }: { returnFocus?: boolean; blurHiddenFocus?: boolean } = {}) {
    const activeElement = document.activeElement;
    const shouldBlurHiddenFocus = blurHiddenFocus && activeElement instanceof HTMLElement && new_selector_parent.contains(activeElement);
    new_selector_content.classList.add('hidden');
    setSelectorExpanded(false);
    syncSelectorSelection();
    if (returnFocus) selectorReturnFocusElement.focus();
    else if (shouldBlurHiddenFocus) activeElement.blur();
  }

  function toggleSelector(trigger: Element) {
    if (isSelectorOpen()) closeSelector();
    else openSelector({ focusSelected: true, trigger });
  }

  function selectOption(index: number) {
    onSelect(index);
    selectorFocusedIndex = index;
    syncSelectorSelection();
    closeSelector({ returnFocus: true });
  }

  radios.forEach((radio, index) => {
    const new_button = new_selector_button_example.cloneNode(true) as HTMLButtonElement;
    new_button.id = `new_selector__option_${index}`;
    new_button.setAttribute('role', 'option');
    new_button.setAttribute('aria-selected', 'false');
    new_button.tabIndex = -1;
    new_button.classList.remove('hidden');
    new_button.innerText = radio.text;

    new_button.addEventListener('click', () => {
      selectOption(index);
    });

    new_selector_content.appendChild(new_button);
    selectorOptionButtons.push(new_button);
  });
  syncSelectorSelection();

  selectorTriggerButtons.forEach(el => el.addEventListener('click', () => toggleSelector(el)));

  function handleSelectorTriggerKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' && isSelectorOpen()) {
      e.preventDefault();
      focusOption(selectorFocusedIndex + 1);
      return;
    }

    if (e.key === 'ArrowUp' && isSelectorOpen()) {
      e.preventDefault();
      focusOption(selectorFocusedIndex - 1);
      return;
    }

    if (!['Enter', ' '].includes(e.key)) return;
    e.preventDefault();
    openSelector({ focusSelected: true, trigger: e.currentTarget as Element });
  }

  selectorTriggerButtons.forEach(el => el.addEventListener('keydown', handleSelectorTriggerKeydown));

  new_selector_content.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusOption(selectorFocusedIndex + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusOption(selectorFocusedIndex - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusOption(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusOption(selectorOptionButtons.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectOption(selectorFocusedIndex);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      closeSelector({ returnFocus: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSelector({ returnFocus: true });
    }
  });

  new_selector_parent.addEventListener('focusout', (e) => {
    if (!new_selector_parent.contains(e.relatedTarget as Node | null)) closeSelector();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !isSelectorOpen()) return;
    e.preventDefault();
    closeSelector({ returnFocus: true });
  });

  document.addEventListener('click', (e) => {
    const target = e.target as Node | null;
    if (!new_selector_content.contains(target) && !selectorTriggerButtons.some(el => el.contains(target))) {
      closeSelector({ blurHiddenFocus: true });
    }
  });
}
