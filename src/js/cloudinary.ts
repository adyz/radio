/** Cloudinary status/poster images + their offline pre-cache. */

export function cloudinaryImageUrl(text: string, live = false) {
  const url_non_live = 'nndti4oybhdzggf8epvh';
  const url_live = 'rhz6yy4btbqicjqhsy7a';
  const encoded = encodeURIComponent(text);
  return `https://res.cloudinary.com/adrianf/image/upload/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${encoded}/${live ? url_live : url_non_live}`;
}

// Pre-cache status images + station name images into Cache API for offline use
export function precacheStatusImages(texts: string[]): void {
  if (!('caches' in window)) return;
  caches.open('radio-images-v3').then(cache => {
    texts.forEach(text => {
      const url = cloudinaryImageUrl(text);
      cache.match(url)
        .then(hit => {
          if (!hit) {
            return fetch(url, { mode: 'no-cors' }).then(res => {
              if (res.ok || res.type === 'opaque') return cache.put(url, res);
            });
          }
        })
        .catch(() => { /* offline or CORS — ignore, SW will cache on next online visit */ });
    });
  }).catch(() => { /* cache API unavailable */ });
}
