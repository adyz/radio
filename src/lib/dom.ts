export function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required DOM element #${id} not found`);
  }
  return element as T;
}
