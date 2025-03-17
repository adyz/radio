
document.addEventListener("touchstart", function () { }, true);


const radioSelect = document.getElementById('radioSelect');
const player = document.getElementById('player');
const loadingNoise = document.getElementById('loadingNoise');
const errorNoise = document.getElementById('errorNoise');
const loadingMsg = document.getElementById('loadingMsg');
const errorMsg = document.getElementById('errorMsg');

const prevButton = document.getElementById('prevButton');
const playButton = document.getElementById('playButton');
const pauseButton = document.getElementById('pauseButton');
const nextButton = document.getElementById('nextButton');

const posterImage = document.getElementById('posterImage');

let hasError = false;
let isLoading = false;

let lastPauseTime = null;

function cloudinaryImageUrl(text, live = false) {
  const url_non_live = 'nndti4oybhdzggf8epvh';
  const url_live = 'rhz6yy4btbqicjqhsy7a';
  return `https://res.cloudinary.com/adrianf/image/upload/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${text}/${live ? url_live : url_non_live}`;
}

posterImage.querySelector('img').src = cloudinaryImageUrl('Coji Radio Player');

const updateMediaSession = () => {
  const title = radioSelect.options[radioSelect.selectedIndex].text;
  if ('mediaSession' in navigator) {

    navigator.mediaSession.metadata = new MediaMetadata({
      title: isLoading ? `Se încarcă...${title}` : hasError ? `Eroare la încărcarea ${title}` : title,
      artist: `Coji Radio Player | ${title}`,
      artwork: [{ src: cloudinaryImageUrl(isLoading ? 'Se încarcă...' : hasError ? 'Eroare' : title, title && !isLoading && !hasError ? true : false) }]
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      console.log('prev by media session');
      prevRadio()
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      console.log('next by media session');
      nextRadio()
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      console.log('paused by media session');
      player.pause()
    });
    navigator.mediaSession.setActionHandler('play', () => {
      console.log('played by media session');
      player.play();
    });
  }

  // update poster image
  posterImage.querySelector('img').src = cloudinaryImageUrl(isLoading ? 'Se încarcă...' : hasError ? 'Eroare' : title, title && !isLoading && !hasError ? true : false);

  // update document title
  document.title = `${isLoading ? "⏳" : ''} ${hasError ? '❤️‍🩹' : ''} ${!isLoading && !hasError ? '🔴' : ''} ${isLoading ? `Se incarca ${title}` : hasError ? 'Eroare' : title}`;

  // update loading message
  loadingMsg.innerText = isLoading ? `Se incarca ${title}...` : '';
};

function audioInstance(htmlElement) {
  let initialSrc = htmlElement.querySelector('source').src;
  let isPlaying = false;

  const instance = {};
  instance.src = initialSrc;

  instance.play = () => {
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

      // lower volume for loading and error noises
      if (htmlElement === loadingNoise || htmlElement === errorNoise) {
        htmlElement.volume = 0.3;
      }
    }
  };

  instance.stop = () => {
    if (isPlaying) {
      console.log('Stop audio', { htmlSrc: htmlElement.src, instanceSrc: instance.src });
      htmlElement.pause();
      htmlElement.src = '';
      isPlaying = false;
    }
  };

  return instance;
}


const loadingNoiseInstance = audioInstance(loadingNoise);
const errorNoiseInstance = audioInstance(errorNoise);

const playRadio = (index) => {
  console.log('playRadio', { index: index, value: radioSelect.value });
  radioSelect.selectedIndex = index;

  isLoading = true;
  hasError = false;

  updateMediaSession();

  errorNoiseInstance.stop();
  loadingNoiseInstance.play();

  loadingMsg.classList.remove('invisible');
  errorMsg.classList.add('invisible');

  player.pause();
  player.src = radioSelect.value;
  player.load();

  player.play().then(() => {
    isLoading = false;
    hasError = false;
    loadingMsg.classList.add('invisible');
    errorMsg.classList.add('invisible');

    loadingNoiseInstance.stop();

    updateMediaSession();
  }).catch(error => {

    if (error.name === 'AbortError') {
      return;
    }

    console.log('Error playing radio:', error);

    isLoading = false;
    hasError = true;

    loadingMsg.classList.add('invisible');
    errorMsg.classList.remove('invisible');

    loadingNoiseInstance.stop();
    errorNoiseInstance.play();
    updateMediaSession();
  });
};

radioSelect.addEventListener('change', (e) => {
  if (e.target.value) {
    playRadio(radioSelect.selectedIndex);
  } else {
    player.pause();
    player.src = '';
  }
});

const prevRadio = () => {
  console.log('prevRadio');
  playRadio(radioSelect.selectedIndex > 1 ? radioSelect.selectedIndex - 1 : radioSelect.options.length - 1);
};

const nextRadio = () => {
  console.log('nextRadio');
  playRadio(radioSelect.selectedIndex < radioSelect.options.length - 1 ? radioSelect.selectedIndex + 1 : 1);
};

if (window.electronAPI) {
  window.electronAPI.onMediaControl((command) => {
    console.log("Comandă media primită:", command);


    if (command === "playpause") {
      if (player.paused) {
        player.play();
      } else {
        player.pause();
      }
    } else if (command === "next") {
      // Implementare pentru trecerea la următoarea melodie
      console.log("Next track (nu este implementat)");
      nextRadio();
    } else if (command === "previous") {
      // Implementare pentru melodia anterioară
      console.log("Previous track (nu este implementat)");
      prevRadio();
    }
  });

  // **Monitorizează starea audio și o trimite la Electron**
  document.addEventListener("DOMContentLoaded", () => {
    function updatePlaybackState() {
      window.electronAPI.updatePlaybackState(!player.paused);
    }

    player.addEventListener("play", updatePlaybackState);
    player.addEventListener("pause", updatePlaybackState);
  });

}


// play button logic
// on play, if no radio is selected, play the first one and make it selected
// also hide the play button and show the pause button
// on pause, show the play button and hide the pause button

playButton.addEventListener('click', () => {
  if (player.paused) {
    if (radioSelect.selectedIndex === 0) {
      playRadio(1);
    } else {
      player.play();
    }
  }
});

pauseButton.addEventListener('click', () => {
  player.pause();
});


player.addEventListener('play', (e) => {
  console.log('Event play', e);
  playButton.classList.add('hidden');
  pauseButton.classList.remove('hidden');
  const now = performance.now();
  const timeDiff = now - lastPauseTime;
  if (lastPauseTime && timeDiff > 2000) {
    console.log('Restart radio after pause', { timeDiff, e });
    player.pause();
    player.src = '';
    playRadio(radioSelect.selectedIndex);
  }

  lastPauseTime = null;

});

player.addEventListener('pause', () => {
  console.log('Event pause');
  playButton.classList.remove('hidden');
  pauseButton.classList.add('hidden');
  lastPauseTime = performance.now();
});


// prev and next buttons
prevButton.addEventListener('click', prevRadio);
nextButton.addEventListener('click', nextRadio);


const worker = new Worker("./js/keepAlive.js");
worker.onmessage = () => {
  console.log("Mențin conexiunea activă...");
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./js/sw.js')
    .then(reg => console.log('Service Worker registered!'))
    .catch(err => console.error('Service Worker registration failed:', err));
}