import { defineContentScript } from 'wxt/sandbox';
import { createShadowRootUi } from 'wxt/client';
import ReactDOM from 'react-dom/client';
import React from 'react';
import App from '../components/App';
import '../assets/tailwind.css';

export default defineContentScript({
  matches: ['*://*.polymarket.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'polymarket-btc-terminal',
      position: 'overlay',
      zIndex: 9999,
      onMount: (container) => {
        const root = ReactDOM.createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove: (root) => {
        if (root) {
          root.unmount();
        }
      },
    });

    ui.mount();
  },
});
