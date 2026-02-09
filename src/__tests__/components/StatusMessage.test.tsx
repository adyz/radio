import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusMessage } from '../../components/StatusMessage';
import type { PlayerStatus } from '../../types';

describe('StatusMessage', () => {
  it('afișează mesajul de loading cu numele stației', () => {
    const status: PlayerStatus = { state: 'loading', stationIndex: 0 };
    render(<StatusMessage status={status} />);

    expect(screen.getByText(/Se încarcă Kiss FM/)).toBeDefined();
  });

  it('afișează mesajul de eroare', () => {
    const status: PlayerStatus = { state: 'error', stationIndex: 0 };
    render(<StatusMessage status={status} />);

    expect(screen.getByText(/Eroare la încărcarea postului radio/)).toBeDefined();
  });

  it('nu afișează nimic când idle', () => {
    const status: PlayerStatus = { state: 'idle' };
    const { container } = render(<StatusMessage status={status} />);

    expect(container.innerHTML).toBe('');
  });

  it('nu afișează nimic când playing', () => {
    const status: PlayerStatus = { state: 'playing', stationIndex: 0 };
    const { container } = render(<StatusMessage status={status} />);

    expect(container.innerHTML).toBe('');
  });

  it('afișează numele stației corecte la loading', () => {
    const status: PlayerStatus = { state: 'loading', stationIndex: 3 };
    render(<StatusMessage status={status} />);

    expect(screen.getByText(/Se încarcă Magic FM/)).toBeDefined();
  });
});
