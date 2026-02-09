const CLOUDINARY_BASE = 'https://res.cloudinary.com/adrianf/image/upload' as const;
const IMAGE_ID_DEFAULT = 'nndti4oybhdzggf8epvh' as const;
const IMAGE_ID_LIVE = 'rhz6yy4btbqicjqhsy7a' as const;

export function cloudinaryImageUrl(text: string, live = false): string {
  const imageId = live ? IMAGE_ID_LIVE : IMAGE_ID_DEFAULT;
  return `${CLOUDINARY_BASE}/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${text}/${imageId}`;
}
