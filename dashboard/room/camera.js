// Camera control for Room View (placeholder for future pan/zoom)
'use strict';

var RoomCamera = (function() {
  var offsetX = 0;
  var offsetY = 0;
  var zoom = 1;

  function reset() {
    offsetX = 0;
    offsetY = 0;
    zoom = 1;
  }

  function getTransform() {
    return { x: offsetX, y: offsetY, zoom: zoom };
  }

  return {
    reset: reset,
    getTransform: getTransform
  };
})();
