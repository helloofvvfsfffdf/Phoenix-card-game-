(function(root){
  'use strict';
  var shapes={
    bonus:'<circle cx="50" cy="50" r="32"/><circle cx="50" cy="50" r="25"/><path d="M50 28v44M63 36H44a8 8 0 0 0 0 16h12a8 8 0 0 1 0 16H37"/>',
    knife:'<path d="M67 12L38 52l10 10 37-36-18-14ZM41 58L22 80l-5-5 20-23M28 52l28 22M24 73l8 7"/>',
    hunter:'<path d="M24 19q48 31 0 62M24 19v62M18 50h64l-12-9M82 50l-12 9M42 29l8-12 8 12M50 17v15"/>',
    zombie:'<path d="M24 51a28 28 0 1 1 52 0l-8 10v18H32V61Z"/><path d="M34 73h32M42 65v14M50 65v14M58 65v14M46 57l4-8 4 8"/><circle cx="38" cy="42" r="7"/><circle cx="62" cy="42" r="7"/>',
    steal:'<path d="M17 51h65M30 38L17 51l13 13M56 20q26 0 26 22M41 80q-24 0-24-20"/><circle cx="54" cy="51" r="16"/><path d="M54 41v20"/>',
    judge:'<path d="M50 16v62M26 82h48M23 29h54M29 29L16 54h26ZM71 29L58 54h26Z"/><circle cx="50" cy="20" r="5"/><path d="M16 54q13 13 26 0M58 54q13 13 26 0"/>',
    reveal:'<path d="M9 50q41-51 82 0Q50 101 9 50Z"/><circle cx="50" cy="50" r="17"/><circle cx="50" cy="50" r="6"/><path d="M50 12v10M50 78v10"/>',
    skipall:'<path d="M20 36a33 33 0 1 1 0 29M20 36V18M20 36h18M36 39l17 12-17 12ZM58 39v24M68 39v24"/>',
    phoenix:'<path d="M50 76L40 54 15 44 5 16l29 15L46 46 50 29 54 46l12-15 29-15-10 28-25 10ZM50 76l-13 14 13-6 13 6ZM50 29l-5-10 12 2-7 8"/><path d="M13 26l26 19M20 38l22 12M87 26L61 45M80 38L58 50M50 49v27"/>',
    trick:'<path d="M13 22l34 8v35q-17 23-34-4ZM53 30l34-8v39q-17 27-34 4Z"/><path d="M21 39l15 4M64 43l15-4M22 54q8 12 16 0M63 59q8-12 16 0"/>',
    stealturn:'<circle cx="50" cy="50" r="31"/><path d="M50 28v23l18 10M50 14v8M50 78v8M14 50h8M78 50h8M21 18h19M21 18v19M21 18q-15 18-12 35"/>',
    curse:'<path d="M50 10L84 30v40L50 90 16 70V30ZM50 23L73 64H27ZM50 40v16M50 64v2M16 30l68 40M84 30L16 70"/>',
    ghost:'<path d="M25 79V43a25 25 0 0 1 50 0v36L62 70 50 83 38 70Z"/><path d="M37 42v9M63 42v9M44 60q6 4 12 0M15 32l-5-7M85 32l5-7"/>',
    alvin:'<ellipse cx="50" cy="64" rx="23" ry="18"/><ellipse cx="23" cy="40" rx="9" ry="12" transform="rotate(-25 23 40)"/><ellipse cx="41" cy="27" rx="9" ry="12"/><ellipse cx="61" cy="27" rx="9" ry="12"/><ellipse cx="79" cy="40" rx="9" ry="12" transform="rotate(25 79 40)"/>',
    dice:'<rect x="20" y="20" width="60" height="60" rx="8"/><circle cx="35" cy="35" r="5"/><circle cx="65" cy="65" r="5"/><circle cx="35" cy="65" r="5"/><circle cx="65" cy="35" r="5"/><circle cx="50" cy="50" r="5"/>',
    rps:'<path d="M30 20v60M70 20v60M20 40h20M60 60h20"/><circle cx="30" cy="15" r="8"/><circle cx="70" cy="85" r="8"/>',
    betrayal:'<path d="M20 30q30 20 0 40M80 30q-30 20 0 40"/><circle cx="35" cy="50" r="8"/><circle cx="65" cy="50" r="8"/>',
    speed:'<path d="M20 50h60M70 35l15 15-15 15"/><circle cx="25" cy="50" r="10"/>',
    wheel:'<circle cx="50" cy="50" r="40"/><path d="M50 10v80M10 50h80M22 22l56 56M22 78l56-56"/><circle cx="50" cy="50" r="8"/>',
    linkedfate:'<path d="M25 30q25 20 0 40M75 30q-25 20 0 40"/><path d="M40 50h20"/><circle cx="30" cy="50" r="12"/><circle cx="70" cy="50" r="12"/>',
    impostor:'<path d="M30 20q20 30 0 60M70 20q-20 30 0 60"/><circle cx="50" cy="50" r="15"/><path d="M40 45h20M45 55h10"/>',
    swapper:'<path d="M25 40q25-20 50 0M25 60q25 20 50 0"/><path d="M40 30l-15 10 15 10M60 70l15-10-15-10"/>'
  };
  root.PhoenixCardCinematicArt={icon:function(id){return '<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+(shapes[id]||'')+'</svg>';}};
}(typeof globalThis!=='undefined'?globalThis:this));
