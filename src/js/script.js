
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

function cloudinaryImageUrl(text, live = false) {
  const url_non_live = 'nndti4oybhdzggf8epvh';
  const url_live = 'rhz6yy4btbqicjqhsy7a';
  return `https://res.cloudinary.com/adrianf/image/upload/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${text}/${live ? url_live : url_non_live}`;
}

posterImage.querySelector('img').src = cloudinaryImageUrl('Coji Radio Player');

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


// --- State Machine ---

const PAUSE_RELOAD_THRESHOLD_MS = 2000;

const machine = {
  state: 'idle',
  lastPauseTime: null,

  transitions: {
    idle: {
      PLAY: 'loading',
      NEXT: 'loading',
      PREV: 'loading',
    },
    loading: {
      LOADED: 'playing',
      FAIL: 'error',
      PLAY: 'loading',
      NEXT: 'loading',
      PREV: 'loading',
    },
    playing: {
      PAUSE: 'paused',
      NEXT: 'loading',
      PREV: 'loading',
    },
    paused: {
      PLAY: function (ctx) {
        const timeDiff = performance.now() - ctx.lastPauseTime;
        return timeDiff > PAUSE_RELOAD_THRESHOLD_MS ? 'loading' : 'playing';
      },
      NEXT: 'loading',
      PREV: 'loading',
    },
    error: {
      PLAY: 'loading',
      NEXT: 'loading',
      PREV: 'loading',
    },
  },

  send(event, data = {}) {
    const stateTransitions = this.transitions[this.state];
    if (!stateTransitions || !(event in stateTransitions)) {
      console.log(`[StateMachine] No transition: ${this.state} + ${event}`);
      return;
    }

    const target = stateTransitions[event];
    const from = this.state;
    const to = typeof target === 'function' ? target(this) : target;

    console.log(`[StateMachine] ${from} + ${event} → ${to}`, data);
    this.state = to;
    this.onEnter(to, event, data, from);
  },

  onEnter(state, event, data, from) {
    switch (state) {
      case 'loading': this.enterLoading(data); break;
      case 'playing': this.enterPlaying(from); break;
      case 'paused':  this.enterPaused(); break;
      case 'error':   this.enterError(); break;
    }
  },

  enterLoading(data) {
    const index = data.index ?? radioSelect.selectedIndex;
    radioSelect.selectedIndex = index;

    console.log('playRadio', { index, value: radioSelect.value });

    errorNoiseInstance.stop();
    loadingNoiseInstance.play();

    [playButton, pauseButton].forEach(b => b.classList.add('opacity-50', 'cursor-not-allowed'));
    loadingMsg.classList.remove('invisible');
    errorMsg.classList.add('invisible');

    updateMediaSession();

    player.pause();
    player.src = radioSelect.value;
    player.load();

    player.play().then(() => {
      machine.send('LOADED');
    }).catch(error => {
      if (error.name === 'AbortError') return;
      console.log('Error playing radio:', error);
      machine.send('FAIL');
    });
  },

  enterPlaying(from) {
    if (from === 'paused') {
      player.play();
    }

    loadingNoiseInstance.stop();
    errorNoiseInstance.stop();

    [playButton, pauseButton].forEach(b => b.classList.remove('opacity-50', 'cursor-not-allowed'));
    playButton.classList.add('hidden');
    pauseButton.classList.remove('hidden');
    loadingMsg.classList.add('invisible');
    errorMsg.classList.add('invisible');

    this.lastPauseTime = null;
    updateMediaSession();
  },

  enterPaused() {
    this.lastPauseTime = performance.now();
    player.pause();

    playButton.classList.remove('hidden');
    pauseButton.classList.add('hidden');
  },

  enterError() {
    loadingNoiseInstance.stop();
    errorNoiseInstance.play();

    [playButton, pauseButton].forEach(b => b.classList.remove('opacity-50', 'cursor-not-allowed'));
    loadingMsg.classList.add('invisible');
    errorMsg.classList.remove('invisible');

    updateMediaSession();
  },
};


// --- Update Media Session ---

const updateMediaSession = () => {
  const title = radioSelect.options[radioSelect.selectedIndex].text;
  const isLoading = machine.state === 'loading';
  const hasError = machine.state === 'error';
  const isLive = !isLoading && !hasError && !!title;

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: isLoading ? `Se încarcă...${title}` : hasError ? `Eroare la încărcarea ${title}` : title,
      artist: `Coji Radio Player | ${title}`,
      artwork: [{ src: cloudinaryImageUrl(isLoading ? 'Se încarcă...' : hasError ? 'Eroare' : title, isLive) }]
    });

    navigator.mediaSession.setActionHandler('previoustrack', () => {
      console.log('prev by media session');
      sendPrev();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      console.log('next by media session');
      sendNext();
    });

    if (!isLoading && !hasError) {
      navigator.mediaSession.setActionHandler('pause', () => {
        console.log('paused by media session');
        machine.send('PAUSE');
      });
      navigator.mediaSession.setActionHandler('play', () => {
        console.log('played by media session');
        machine.send('PLAY', { index: radioSelect.selectedIndex });
      });
    }
  }

  // update poster image
  posterImage.querySelector('img').src = cloudinaryImageUrl(isLoading ? 'Se încarcă...' : hasError ? 'Eroare' : title, isLive);

  // update document title
  document.title = `${isLoading ? "⏳" : ''} ${hasError ? '❤️‍🩹' : ''} ${!isLoading && !hasError ? '🔴' : ''} ${isLoading ? `Se incarca ${title}` : hasError ? 'Eroare' : title}`;

  // update loading message
  loadingMsg.innerText = isLoading ? `Se incarca ${title}...` : '';
};


// --- Actions ---

const sendPrev = () => {
  console.log('prevRadio', radioSelect.selectedIndex);
  const index = radioSelect.selectedIndex === 0 ? radioSelect.options.length - 1 : radioSelect.selectedIndex - 1;
  machine.send('PREV', { index });
};

const sendNext = () => {
  console.log('nextRadio', radioSelect.selectedIndex);
  const index = radioSelect.selectedIndex === radioSelect.options.length - 1 ? 0 : radioSelect.selectedIndex + 1;
  machine.send('NEXT', { index });
};


// --- Event Listeners ---

radioSelect.addEventListener('change', (e) => {
  if (e.target.value) {
    machine.send('PLAY', { index: radioSelect.selectedIndex });
  } else {
    player.pause();
    player.src = '';
  }
});

playButton.addEventListener('click', () => {
  machine.send('PLAY', { index: radioSelect.selectedIndex });
});

pauseButton.addEventListener('click', () => {
  machine.send('PAUSE');
});

prevButton.addEventListener('click', sendPrev);
nextButton.addEventListener('click', sendNext);

if (window.electronAPI) {
  window.electronAPI.onMediaControl((command) => {
    console.log("Comandă media primită:", command);

    if (command === "playpause") {
      if (machine.state === 'playing') {
        machine.send('PAUSE');
      } else {
        machine.send('PLAY', { index: radioSelect.selectedIndex });
      }
    } else if (command === "next") {
      console.log("Next track");
      sendNext();
    } else if (command === "previous") {
      console.log("Previous track");
      sendPrev();
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    function updatePlaybackState() {
      window.electronAPI.updatePlaybackState(machine.state === 'playing');
    }

    player.addEventListener("play", updatePlaybackState);
    player.addEventListener("pause", updatePlaybackState);
  });
}


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
    machine.send('PLAY', { index });
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

