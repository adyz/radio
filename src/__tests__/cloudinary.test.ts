import { describe, it, expect } from 'vitest';
import { cloudinaryImageUrl } from '../lib/cloudinary';

describe('cloudinaryImageUrl', () => {
  const BASE = 'https://res.cloudinary.com/adrianf/image/upload';
  const DEFAULT_ID = 'nndti4oybhdzggf8epvh';
  const LIVE_ID = 'rhz6yy4btbqicjqhsy7a';

  it('generează URL cu imaginea default când live=false', () => {
    const url = cloudinaryImageUrl('Kiss FM');
    expect(url).toContain(DEFAULT_ID);
    expect(url).not.toContain(LIVE_ID);
  });

  it('generează URL cu imaginea live când live=true', () => {
    const url = cloudinaryImageUrl('Kiss FM', true);
    expect(url).toContain(LIVE_ID);
    expect(url).not.toContain(DEFAULT_ID);
  });

  it('include textul în URL', () => {
    const url = cloudinaryImageUrl('Europa FM');
    expect(url).toContain('l_text:arial_90:Europa FM');
  });

  it('include parametrii Cloudinary corecți', () => {
    const url = cloudinaryImageUrl('Test');
    expect(url).toContain('c_scale,h_480,w_480');
    expect(url).toContain('g_south_west,x_50,y_70');
  });

  it('default live este false', () => {
    const withDefault = cloudinaryImageUrl('X');
    const withExplicitFalse = cloudinaryImageUrl('X', false);
    expect(withDefault).toBe(withExplicitFalse);
  });

  it('URL-ul pornește cu baza Cloudinary', () => {
    const url = cloudinaryImageUrl('Test');
    expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/adrianf\/image\/upload/);
  });
});
