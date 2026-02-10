import { useState, useEffect, useRef } from 'react';
import { STATIONS } from '../data/stations';

interface StationSelectorProps {
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onClose: () => void;
}

export function StationSelector({ selectedIndex, onSelect, isOpen, onToggle, onClose }: StationSelectorProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && selectedRef.current) {
      selectedRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent): void => {
      const target = e.target as Node;
      if (contentRef.current && !contentRef.current.contains(target)) {
        onClose();
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen, onClose]);

  return (
    <div className="relative z-20 top-0 left-[11%] w-[78%]">
      <button
        className="position absolute top-22 right-[50%] -mr-19 text-SuperLighterBrown bg-StaticWhite border-[.5px] boder-Broder py-2 rounded-lg scale-75"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" shapeRendering="geometricPrecision" viewBox="0 0 24 24" height="24" width="24" style={{ color: 'currentcolor' }}>
          <path d="M17 8.517L12 3 7 8.517m0 6.963l5 5.517 5-5.517"></path>
        </svg>
      </button>

      {isOpen && (
        <div
          ref={contentRef}
          className="flex overflow-auto flex-col absolute top-0 left-0 w-full h-82 shadow-2xl border border-Border bg-White overscroll-contain rounded-3xl [scrollbar-width:thin]"
        >
          {STATIONS.map((station, index) => (
            <button
              key={station.name}
              ref={index === selectedIndex ? selectedRef : null}
              className={`w-full text-Brown py-4 text-md hover:bg-Red/20 active:bg-Red/20 border-0 border-b border-Border/50 ${
                index === selectedIndex ? 'bg-Red' : ''
              }`}
              onClick={() => {
                onSelect(index);
                onToggle();
              }}
            >
              {station.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
