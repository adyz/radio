import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StationSelector } from '../../components/StationSelector';
import { STATIONS } from '../../data/stations';

describe('StationSelector', () => {
  afterEach(cleanup);

  const defaultProps = {
    selectedIndex: 0,
    onSelect: vi.fn(),
    isOpen: true,
    onToggle: vi.fn(),
    onClose: vi.fn(),
  };

  it('afișează toate stațiile când e deschis', () => {
    render(<StationSelector {...defaultProps} />);

    STATIONS.forEach((station) => {
      expect(screen.getByText(station.name)).toBeDefined();
    });
  });

  it('nu afișează lista când e închis', () => {
    render(<StationSelector {...defaultProps} isOpen={false} />);

    expect(screen.queryByText('Kiss FM')).toBeNull();
  });

  it('apelează onSelect și onToggle la click pe stație', () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(<StationSelector {...defaultProps} onSelect={onSelect} onToggle={onToggle} />);

    fireEvent.click(screen.getByText('Europa FM'));

    expect(onSelect).toHaveBeenCalledWith(1);
    expect(onToggle).toHaveBeenCalled();
  });

  it('marchează stația selectată cu clasa bg-Red', () => {
    render(<StationSelector {...defaultProps} selectedIndex={2} />);

    const digiFmButton = screen.getByText('Digi FM');
    expect(digiFmButton.className).toContain('bg-Red');
  });

  it('celelalte stații nu au clasa bg-Red directă', () => {
    render(<StationSelector {...defaultProps} selectedIndex={0} />);

    const europaButton = screen.getByText('Europa FM');
    // Check the button doesn't have the standalone bg-Red class (not hover:bg-Red/20)
    const classes = europaButton.className.split(' ');
    expect(classes).not.toContain('bg-Red');
  });
});
