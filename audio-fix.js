/*
 * Angry Birds Chrome - modern browser audio compatibility
 *
 * The original game requests audio from /fowl/audio/..., while this
 * restoration stores the audio files in /cors/fowl/audio/....
 *
 * This file:
 *   1. Redirects same-origin audio XHR requests to the actual audio folder.
 *   2. Redirects HTML5 <audio> src assignments the same way.
 *   3. Tracks AudioContext instances and resumes them after a user gesture.
 *   4. Retries paused HTML5 audio after a user gesture.
 */

(function () {
  'use strict';

  function fixAudioUrl(url) {
    if (typeof url !== 'string') {
      return url;
    }

    try {
      var parsed = new URL(url, document.baseURI);

      // Only redirect this site's own game audio.
      if (parsed.origin === window.location.origin) {
        parsed.pathname = parsed.pathname.replace(
          /\/fowl\/audio\//,
          '/cors/fowl/audio/'
        );
      }

      return parsed.href;
    } catch (ignore) {
      // Fall back to the original URL if it is not a normal URL string.
      return url;
    }
  }

  // Angry Birds Chrome's Web Audio loader uses XMLHttpRequest with
  // responseType = "arraybuffer" before calling decode/createBuffer.
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

  // The game can fall back to its HTML5 audio backend, which assigns
  // an audio element's .src directly.
  if (window.HTMLMediaElement) {
    var mediaDescriptor = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'src'
    );

    if (mediaDescriptor && mediaDescriptor.set && mediaDescriptor.get) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: mediaDescriptor.configurable,
        enumerable: mediaDescriptor.enumerable,
        get: mediaDescriptor.get,
        set: function (value) {
          mediaDescriptor.set.call(this, fixAudioUrl(value));
        }
      });
    }
  }

  // Chrome may leave Web Audio contexts suspended until the page receives
  // a user gesture. Track contexts created by the old game.
  var NativeAudioContext =
    window.AudioContext || window.webkitAudioContext;
  var audioContexts = [];

  if (NativeAudioContext) {
    var TrackedAudioContext = function () {
      var context = new NativeAudioContext();
      audioContexts.push(context);
      return context;
    };

    TrackedAudioContext.prototype = NativeAudioContext.prototype;

    try {
      window.AudioContext = TrackedAudioContext;
    } catch (ignore) {}

    try {
      window.webkitAudioContext = TrackedAudioContext;
    } catch (ignore) {}
  }

  function unlockAudio() {
    var i;
    var context;
    var result;
    var audios;
    var j;

    for (i = 0; i < audioContexts.length; i++) {
      context = audioContexts[i];

      if (context && context.state === 'suspended' && context.resume) {
        try {
          result = context.resume();
          if (result && result.catch) {
            result.catch(function () {});
          }
        } catch (ignore) {}
      }
    }

    // Also retry any HTML5 audio elements whose initial play() was blocked.
    audios = document.getElementsByTagName('audio');

    for (j = 0; j < audios.length; j++) {
      if (!audios[j].paused) {
        continue;
      }

      try {
        result = audios[j].play();
        if (result && result.catch) {
          result.catch(function () {});
        }
      } catch (ignore) {}
    }
  }

  ['pointerdown', 'mousedown', 'keydown', 'touchstart'].forEach(function (eventName) {
    document.addEventListener(eventName, unlockAudio, false);
  });
})();
