import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { GamePage } from '../shared/ui/GamePage.jsx';
import { ChromeDinoGame } from './chromeDinoGame.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GamePage GameClass={ChromeDinoGame} />
  </StrictMode>,
);
