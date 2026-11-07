import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.gen.css' // every styling value — generated from styles.json
import './theme.css' // structure only: selectors, properties, no literals

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
