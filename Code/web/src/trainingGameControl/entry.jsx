import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { TapGamePage } from '../shared/ui/TapGamePage.jsx';
import { TrainingGameControl } from './trainingGameControl.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TapGamePage GameClass={TrainingGameControl} />
  </StrictMode>,
);
