// Scene definition for bioGame (also reused by beltTrainingGame): visual
// theme, collectible item, avatar, and audio assets. There is only one scene,
// the ocean; `id` is still written to the CSVs (session_start event).

export const SCENE = {
  id:        'ocean',
  avatarSrc: 'fishy.png',

  bg: {
    gradTop: '#071830',
    gradMid: '#0a2a48',
    gradBot: '#0d3858',
    blobR: 100, blobG: 210, blobB: 255,
  },

  item: {   // a star; its glow is drawn in the item's own colour
    color:        '#ffbe30',
    collectColor: '#ffd060',
    missColor:    '#888',
  },

  sounds: {
    ambience: 'sounds/soft.wav',
    noise:    'sounds/wind.wav',
    collect:  ['sounds/collect1.wav', 'sounds/collect2.wav', 'sounds/collect3.wav', 'sounds/collect4.wav'],
  },
};
