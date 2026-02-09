import { describe, it, expect, beforeEach } from 'vitest';
import { getElement } from '../lib/dom';

describe('getElement', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="testDiv">Hello</div>
      <button id="testButton">Click</button>
      <audio id="testAudio"></audio>
    `;
  });

  it('returnează elementul cu id-ul dat', () => {
    const el = getElement('testDiv');
    expect(el).toBeInstanceOf(HTMLElement);
    expect(el.id).toBe('testDiv');
  });

  it('returnează tipul corect cu generic', () => {
    const btn = getElement<HTMLButtonElement>('testButton');
    expect(btn).toBeInstanceOf(HTMLButtonElement);
  });

  it('aruncă eroare dacă elementul nu există', () => {
    expect(() => getElement('inexistent')).toThrow(
      'Required DOM element #inexistent not found',
    );
  });
});
