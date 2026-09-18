// Scene definitions for bioGame.
// Each scene describes the visual theme, collectible item, avatar, and audio assets.

export const SCENES = {
  ocean: {
    id:        'ocean',
    label:     'Ocean',
    avatarSrc: 'fishy.png',

    bg: {
      gradTop: '#071830',
      gradMid: '#0a2a48',
      gradBot: '#0d3858',
      blobR: 100, blobG: 210, blobB: 255,
    },

    item: {
      shape:        'star',
      color:        '#ffbe30',
      glowColor:    '#ffd060',
      collectColor: '#ffd060',
      missColor:    '#888',
    },

    sounds: {
      ambience: 'sounds/soft.wav',
      noise:    'sounds/wind.wav',
      collect:  ['sounds/collect1.wav', 'sounds/collect2.wav', 'sounds/collect3.wav', 'sounds/collect4.wav'],
    },
  },

  jungle: {
    id:        'jungle',
    label:     'Jungle',
    avatarSrc: 'images/monkey.png',

    bg: {
      gradTop: '#081208',
      gradMid: '#0e2210',
      gradBot: '#163018',
      blobR: 90, blobG: 190, blobB: 60,
    },

    item: {
      shape:        'fruit',
      color:        '#e05828',
      glowColor:    '#ff7040',
      collectColor: '#ff8c50',
      missColor:    '#666',
    },

    sounds: {
      ambience: 'sounds/rainforest.wav',
      noise:    'sounds/wind.wav',
      collect:  ['sounds/collect1.wav', 'sounds/collect2.wav', 'sounds/collect3.wav', 'sounds/collect4.wav'],
    },
  },
};

/**
 * Resolve a scene id to a scene definition.
 * @param {string} id  'ocean' | 'jungle'
 */
export function resolveScene(id) {
  return SCENES[id] ?? SCENES.ocean;
}
