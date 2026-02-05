import { AudioInstanceType } from './types';

export function cloudinaryImageUrl(text: string, live = false): string {
  const url_non_live = 'nndti4oybhdzggf8epvh';
  const url_live = 'rhz6yy4btbqicjqhsy7a';
  return `https://res.cloudinary.com/adrianf/image/upload/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${text}/${live ? url_live : url_non_live}`;
}

export function audioInstance(htmlElement: HTMLAudioElement): AudioInstanceType {
  const sourceElement = htmlElement.querySelector('source');
  const initialSrc = sourceElement ? sourceElement.src : '';
  let isPlaying = false;

  const instance: AudioInstanceType = {
    src: initialSrc,
    play: () => {
      if (!isPlaying) {
        console.log('Play audio', { htmlSrc: htmlElement.src, instanceSrc: instance.src });
        
        htmlElement.src = instance.src;
        isPlaying = true;
        
        htmlElement.play().catch((error) => {
          if (error.name !== 'AbortError') {
            console.error('Error playing audio:', error);
          }
          isPlaying = false;
        });
      }
    },
    stop: () => {
      if (isPlaying) {
        console.log('Stop audio', { htmlSrc: htmlElement.src, instanceSrc: instance.src });
        htmlElement.pause();
        htmlElement.src = '';
        isPlaying = false;
      }
    },
  };

  return instance;
}
