/*
 * Angry Birds Chrome - modern browser audio compatibility
 *
 * The original game uses a very old Web Audio API implementation
 * (createBufferSource/createGainNode/noteOn). Modern Chrome can reject
 * the real AudioContext during page startup because it is not created
 * from a user gesture.
 *
 * This compatibility layer keeps the game's old API shape but implements
 * playback with HTML5 Audio instead. Audio files are also redirected from
 * /fowl/audio/ to the restored /cors/fowl/audio/ directory.
 */

(function () {
  'use strict';

  function fixAudioUrl(url) {
    if (typeof url !== 'string') {
      return url;
    }

    try {
      var parsed = new URL(url, document.baseURI);

      if (parsed.origin === window.location.origin) {
        parsed.pathname = parsed.pathname.replace(
          /\/fowl\/audio\//,
          '/cors/fowl/audio/'
        );
      }

      return parsed.href;
    } catch (ignore) {
      return url;
    }
  }

  /*
   * The game's sound loader uses XMLHttpRequest + arraybuffer, then
   * AudioContext.createBuffer(). Redirect only those audio requests.
   */
  if (window.XMLHttpRequest && XMLHttpRequest.prototype.open) {
    var originalXhrOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
      return originalXhrOpen.call(
        this,
        method,
        fixAudioUrl(url),
        async,
        user,
        password
      );
    };
  }

  /*
   * Minimal compatibility implementation for the obsolete Web Audio API
   * used by this particular build of Angry Birds Chrome.
   *
   * It intentionally does NOT construct a native AudioContext, so Chrome
   * cannot reject it during page startup.
   */
  function AngryBirdsAudioContext() {
    this.currentTime = 0;
    this.destination = {};
    this.state = 'running';
  }

  AngryBirdsAudioContext.prototype.createBuffer = function (arrayBuffer) {
    var blob;
    var url;

    if (!(arrayBuffer instanceof ArrayBuffer)) {
      throw new TypeError('Angry Birds audio buffer must be an ArrayBuffer');
    }

    blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    url = URL.createObjectURL(blob);

    return {
      _url: url,
      duration: 0
    };
  };

  AngryBirdsAudioContext.prototype.createBufferSource = function () {
    return new AngryBirdsBufferSource(this);
  };

  AngryBirdsAudioContext.prototype.createGainNode = function () {
    return new AngryBirdsGainNode();
  };

  AngryBirdsAudioContext.prototype.createGain = function () {
    return this.createGainNode();
  };

  AngryBirdsAudioContext.prototype.resume = function () {
    this.state = 'running';
    return Promise.resolve();
  };

  AngryBirdsAudioContext.prototype.suspend = function () {
    this.state = 'suspended';
    return Promise.resolve();
  };

  AngryBirdsAudioContext.prototype.close = function () {
    this.state = 'closed';
    return Promise.resolve();
  };

  function AngryBirdsGainNode() {
    this.gain = {
      value: 1
    };
    this._volume = 1;
    this.destination = null;
  }

  AngryBirdsGainNode.prototype.connect = function (destination) {
    this.destination = destination;
    return destination;
  };

  AngryBirdsGainNode.prototype.disconnect = function () {};

  function AngryBirdsBufferSource(context) {
    this.context = context;
    this.buffer = null;
    this.loop = false;
    this._audio = null;
    this._gain = 1;
  }

  AngryBirdsBufferSource.prototype.connect = function (node) {
    if (node && node.gain && typeof node.gain.value === 'number') {
      this._gain = node.gain.value;
    }

    return node;
  };

  AngryBirdsBufferSource.prototype.disconnect = function () {};

  AngryBirdsBufferSource.prototype._play = function (when) {
    var audio;
    var result;

    if (!this.buffer || !this.buffer._url) {
      return;
    }

    if (this._audio) {
      try {
        this._audio.pause();
      } catch (ignore) {}
    }

    audio = new Audio();
    audio.preload = 'auto';
    audio.src = this.buffer._url;
    audio.loop = !!this.loop;
    audio.volume = Math.max(0, Math.min(1, this._gain));
    this._audio = audio;

    audio.addEventListener('loadedmetadata', function () {
      if (isFinite(audio.duration) && audio.duration > 0) {
        // Keep the emulated AudioBuffer duration useful to the old game.
        this.buffer.duration = audio.duration;
      }
    }.bind(this), { once: true });

    result = audio.play();

    if (result && result.catch) {
      result.catch(function () {
        /*
         * A sound may have been requested before the first user gesture.
         * Keep this source queued so the gesture handler can start it.
         */
        if (!userHasInteracted && pendingSources.indexOf(this) === -1) {
          pendingSources.push(this);
        }
      }.bind(this));
    }
  };

  /*
   * The original build calls noteOn(). Newer code sometimes calls start().
   */
  AngryBirdsBufferSource.prototype.noteOn = function (when) {
    this._play(when || 0);
  };

  AngryBirdsBufferSource.prototype.start = function (when) {
    this._play(when || 0);
  };

  AngryBirdsBufferSource.prototype.noteOff = function () {
    this.stop();
  };

  AngryBirdsBufferSource.prototype.stop = function () {
    if (this._audio) {
      try {
        this._audio.pause();
        this._audio.currentTime = 0;
      } catch (ignore) {}
      this._audio = null;
    }
  };

  /*
   * Replace the real constructors only for this page/game. The rest of the
   * site does not need a native AudioContext.
   */
  window.AudioContext = AngryBirdsAudioContext;
  window.webkitAudioContext = AngryBirdsAudioContext;

  /*
   * Mark the page as interacted with. For already-created HTML5 audio
   * elements, retry playback once after the gesture.
   */
  var userHasInteracted = false;
  var pendingSources = [];

  function unlockAudio() {
    var i;
    var result;

    userHasInteracted = true;

    /*
     * Start any game sounds/music that tried to begin before Chrome allowed
     * audio playback.
     */
    for (i = pendingSources.length - 1; i >= 0; i--) {
      try {
        if (pendingSources[i] && pendingSources[i]._audio) {
          result = pendingSources[i]._audio.play();

          if (result && result.catch) {
            result.catch(function () {});
          }
        }
      } catch (ignore) {}

      pendingSources.splice(i, 1);
    }
  }

  ['pointerdown', 'mousedown', 'keydown', 'touchstart'].forEach(function (eventName) {
    document.addEventListener(eventName, unlockAudio, false);
  });

  window.angryBirdsAudioHasUserGesture = function () {
    return userHasInteracted;
  };
})();
