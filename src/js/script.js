
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
  console.log('prevRadio', radioSelect.selectedIndex);
  playRadio(radioSelect.selectedIndex === 0 ? radioSelect.options.length - 1 : radioSelect.selectedIndex - 1);
};

const nextRadio = () => {
  console.log('nextRadio', radioSelect.selectedIndex);  
  playRadio(radioSelect.selectedIndex === radioSelect.options.length - 1 ? 0 : radioSelect.selectedIndex + 1);
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
      playRadio(0);
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


function updateThemeColor() {
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const themeColor = isDarkMode ? '#434238' : '#fffdef'; // Negru pentru dark mode, alb pentru light mode

  let metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
  }
  metaThemeColor.setAttribute('content', themeColor);
}

// Inițializăm la încărcarea paginii
updateThemeColor();

// Ascultăm schimbările în preferințele sistemului
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColor);


// new selector
const new_selector_open_button = document.getElementById('new_selector__button');
const new_selector_content = document.getElementById('new_selector__content');
const new_selector_button_example = document.getElementById('new_selector__button_example');


// populate the new selector with the radios
const radios = radioSelect.querySelectorAll('option');
radios.forEach((radio, index) => {
  // create a new button like the example that is in the dom
  const new_button = new_selector_button_example.cloneNode(true);
  new_button.id = '';
  new_button.classList.remove('hidden');
  new_button.innerText = radio.text;
  
  // play the radio on click
  new_button.addEventListener('click', () => {
    playRadio(index);
    new_selector_content.classList.add('hidden');
  });

  // append the new button to the new selector
  new_selector_content.appendChild(new_button);

  // if it's selected, add the selected class
  // this is by the radioSelect.selectedIndex
  if (radioSelect.selectedIndex && radioSelect.selectedIndex === index) {
    
    new_button.classList.add('bg-Red');

    // remove the selected class from previous selected
    const previous_selected = new_selector_content.querySelector('.bg-Red');
    
    if (previous_selected) {
      previous_selected.classList.remove('bg-Red');
    }

  }


});

// on click open the new selector
[new_selector_open_button, posterImage].map(el => el.addEventListener('click', () => {
  new_selector_content.classList.toggle('hidden');

  //  loop to find the new selected radio and add the selected class
  const new_selector_buttons = new_selector_content.querySelectorAll('button');
  new_selector_buttons.forEach((button, index) => {
    if (radioSelect.selectedIndex === index) {
      button.classList.add('bg-Red');
      button.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      button.classList.remove('bg-Red');
    }
  });
}
));


// on click anywhere outside the new selector, close it
document.addEventListener('click', (e) => {
  if (!new_selector_content.contains(e.target) && !new_selector_open_button.contains(e.target) && !posterImage.contains(e.target)) {
    new_selector_content.classList.add('hidden');
  }
});

