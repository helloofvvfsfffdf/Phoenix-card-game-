/*
 * Phoenix - gallery-net.js
 * ---------------------------------------------------------------------------
 * The gallery's transport: a lazy WebSocket to the same server as multiplayer,
 * carrying nothing but the three gallery messages.
 *
 * WHY IT DOES NOT BORROW THE MULTIPLAYER SOCKET
 * ---------------------------------------------
 * js/online-client.js keeps its socket private and its own messages onmessage
 * handler ignores anything that is not `state` or `error`. Sharing it would mean
 * editing a working, heavily-exercised file to forward gallery traffic - which is
 * the kind of coupling that turns "added a gallery" into "broke the lobby".
 *
 * A gallery visitor may never touch multiplayer at all, so a small independent
 * transport is the honest shape: it connects on first use, and the rest of the
 * game never learns it exists. The cost is one extra socket per gallery visitor,
 * which for a private gallery shared with a few friends is not worth optimising
 * against a risk of entanglement.
 *
 * It is deliberately dumb. It does not decide who is the owner - the SERVER does,
 * and sends gallery_open back either way - it only remembers which verb the visitor
 * last used so the UI can label itself correctly.
 */
(function () {
  'use strict';

  let socket = null;
  let lastVerb = 'gallery_join';

  const galleryHandlers = [];
  const errorHandlers = [];

  function ready(callback) {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';

    socket = new WebSocket(protocol + '//' + location.host);

    socket.onopen = callback;

    socket.onerror = () => {
      tell('Could not reach the gallery server.');
    };

    socket.onclose = () => {
      socket = null;
      tell('Disconnected from the gallery server.');
    };

    socket.onmessage = event => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (!message || !message.type) return;

      // Errors the server raises for a gallery request are answered at the
      // doorway. Anything else here belongs to the lobby, which has its own
      // socket, so it is not ours and is ignored.
      if (message.type === 'error') {
        tell(message.message);
        return;
      }

      if (message.type.indexOf('gallery_') === 0) {
        galleryHandlers.forEach(function (handler) {
          handler(message, lastVerb === 'gallery_create');
        });
      }
    };
  }

  function tell(text) {
    errorHandlers.forEach(function (handler) { handler(text); });
  }

  /**
   * Sends one gallery request, connecting first if needed.
   *
   * `verb` is remembered only so the reply can be labelled owner or guest. The
   * server decides whether the request was allowed; this has no say in it.
   */
  function send(message) {
    lastVerb = message.type;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }

    ready(function () {
      socket.send(JSON.stringify(message));
    });
  }

  window.PhoenixNet = {
    send: send,
    onGallery: function (handler) { galleryHandlers.push(handler); },
    onGalleryError: function (handler) { errorHandlers.push(handler); },
    setGalleryOwner: function (isOwner) { lastVerb = isOwner ? 'gallery_create' : 'gallery_join'; }
  };
})();