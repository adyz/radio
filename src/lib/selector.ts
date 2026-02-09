import type { PlayerElements } from '../types';
import { STATIONS } from '../data/stations';
import { getSelectedIndex, playRadio } from './player';

export function initSelector(elements: PlayerElements): void {
  const { selectorContent, selectorOpenButton, selectorButtonTemplate, posterImage } = elements;

  STATIONS.forEach((station, index) => {
    const button = selectorButtonTemplate.cloneNode(true) as HTMLButtonElement;
    button.id = '';
    button.classList.remove('hidden');
    button.innerText = station.name;

    button.addEventListener('click', () => {
      playRadio(index);
      selectorContent.classList.add('hidden');
    });

    selectorContent.appendChild(button);
  });

  const toggleSelector = (): void => {
    selectorContent.classList.toggle('hidden');
    const buttons = selectorContent.querySelectorAll('button');
    const selectedIdx = getSelectedIndex();
    buttons.forEach((btn, idx) => {
      if (idx === selectedIdx) {
        btn.classList.add('bg-Red');
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        btn.classList.remove('bg-Red');
      }
    });
  };

  selectorOpenButton.addEventListener('click', toggleSelector);
  posterImage.addEventListener('click', toggleSelector);

  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (
      !selectorContent.contains(target) &&
      !selectorOpenButton.contains(target) &&
      !posterImage.contains(target)
    ) {
      selectorContent.classList.add('hidden');
    }
  });
}
