import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { GamePage } from '../shared/ui/GamePage.jsx';
import { TrainingGame } from './trainingGame.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <GamePage GameClass={TrainingGame} />
  </StrictMode>,
);
