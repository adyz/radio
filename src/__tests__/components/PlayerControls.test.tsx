import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerControls } from '../../components/PlayerControls';

describe('PlayerControls', () => {
  const defaultProps = {
    state: 'idle',
    isAudioPlaying: false,
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
  };

  it('afișează butonul de play când nu rulează audio', () => {
    const { container } = render(<PlayerControls {...defaultProps} isAudioPlaying={false} />);
    // Play button has the triangle path
    const playPath = container.querySelector('path[d*="51.8684"]');
    expect(playPath).not.toBeNull();
  });

  it('afișează butonul de pause când rulează audio', () => {
    const { container } = render(<PlayerControls {...defaultProps} isAudioPlaying={true} />);
    // Pause button has the two vertical lines
    const pausePath = container.querySelector('path[d="M51 38L51 96"]');
    expect(pausePath).not.toBeNull();
  });

  it('dezactivează doar play/pause în starea loading, prev/next rămân active', () => {
    const { container } = render(<PlayerControls {...defaultProps} state="loading" />);
    const buttons = container.querySelectorAll('button');
    // buttons[0] = prev, buttons[1] = play/pause, buttons[2] = next
    expect(buttons[0]!.disabled).toBe(false);
    expect(buttons[1]!.disabled).toBe(true);
    expect(buttons[1]!.className).toContain('opacity-50');
    expect(buttons[2]!.disabled).toBe(false);
  });

  it('butoanele sunt active în starea playing', () => {
    const { container } = render(<PlayerControls {...defaultProps} state="playing" />);
    const buttons = container.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.disabled).toBe(false);
    });
  });

  it('apelează onPlay la click pe butonul play', () => {
    const onPlay = vi.fn();
    const { container } = render(<PlayerControls {...defaultProps} onPlay={onPlay} />);
    // The play/pause button is the middle one (index 1)
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[1]!);
    expect(onPlay).toHaveBeenCalled();
  });

  it('apelează onPrev la click pe butonul prev', () => {
    const onPrev = vi.fn();
    const { container } = render(<PlayerControls {...defaultProps} onPrev={onPrev} />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]!);
    expect(onPrev).toHaveBeenCalled();
  });

  it('apelează onNext la click pe butonul next', () => {
    const onNext = vi.fn();
    const { container } = render(<PlayerControls {...defaultProps} onNext={onNext} />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[2]!);
    expect(onNext).toHaveBeenCalled();
  });
});
